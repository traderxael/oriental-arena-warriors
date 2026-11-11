/* ============================================================
   assets.js — Carga de GLB/GLTF con caché por ruta y fallback procedural

   Interfaz pública:
     Assets.loadGLTF(path, fallbackBuilder, [timeoutMs])
       -> Promise<{ scene: THREE.Object3D, animations: THREE.AnimationClip[], isFallback: boolean }>
     Assets.loadGLB(path, fallbackBuilder, [timeoutMs])
       -> Promise<THREE.Object3D>
     Assets.disposeObject(root)
     Assets.clearCache()

   Garantías:
   - NUNCA rechaza: en error del loader o por timeout (8 s por defecto)
     loguea un console.warn descriptivo y resuelve con fallbackBuilder().
   - Caché de una sola petición de red por ruta: props repetidos y
     personajes comparten geometrías, materiales base y texturas (marcados
     con `userData.shared = true` para que `disposeObject` nunca destruya
     recursos compartidos).
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const LOAD_TIMEOUT_MS = 8000;
const gltfCache = new Map();

function markSharedSubtree(root) {
  if (!root || typeof root.traverse !== 'function') return;
  root.traverse((node) => {
    if (!node) return;
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
    if (node.geometry) {
      node.geometry.userData = Object.assign({}, node.geometry.userData, { shared: true });
    }
    const mats = Array.isArray(node.material) ? node.material : (node.material ? [node.material] : []);
    for (const mat of mats) {
      if (!mat) continue;
      mat.userData = Object.assign({}, mat.userData, { shared: true });
      for (const key of Object.keys(mat)) {
        const value = mat[key];
        if (value && value.isTexture) {
          value.userData = Object.assign({}, value.userData, { shared: true });
        }
      }
    }
  });
}

function buildSafeFallback(path, fallbackBuilder) {
  try {
    const group = typeof fallbackBuilder === 'function' ? fallbackBuilder() : new THREE.Group();
    if (!group || !group.isObject3D) {
      console.warn(`Assets: el fallback para "${path}" no devolvió un Object3D; se usa un Group vacío.`);
      return new THREE.Group();
    }
    if (!group.name) group.name = `fallback:${path}`;
    return group;
  } catch (err) {
    console.warn(`Assets: el fallback para "${path}" lanzó un error (${err && err.message ? err.message : err}); se usa un Group vacío.`);
    return new THREE.Group();
  }
}

function fetchGLTFOnce(path, timeoutMs) {
  if (gltfCache.has(path)) return gltfCache.get(path);

  const pending = new Promise((resolve) => {
    let settled = false;
    const finish = (payload, warn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (warn) console.warn(warn);
      resolve(payload);
    };

    const timer = setTimeout(() => {
      finish(
        { ok: false, scene: null, animations: [] },
        `Assets: tiempo de espera agotado (${timeoutMs} ms) al cargar "${path}". Usando fallback procedural.`
      );
    }, timeoutMs);

    const loader = new GLTFLoader();
    loader.load(
      path,
      (gltf) => {
        const model = gltf && gltf.scene ? gltf.scene : new THREE.Group();
        model.name = model.name || path;
        markSharedSubtree(model);
        const animations = gltf && Array.isArray(gltf.animations) ? gltf.animations : [];
        console.info(`Assets: GLB cargado: "${path}" (${animations.length} clips).`);
        finish({ ok: true, scene: model, animations }, null);
      },
      undefined,
      (error) => {
        const reason = error && (error.message || error.type || error.status)
          ? `${error.message || error.type || error.status}`
          : 'error desconocido';
        finish(
          { ok: false, scene: null, animations: [] },
          `Assets: no se pudo cargar el GLB "${path}" (${reason}). Usando fallback procedural.`
        );
      }
    );
  });

  gltfCache.set(path, pending);
  return pending;
}

const Assets = {
  /**
   * Carga un GLTF/GLB con su escena plantilla y sus animaciones.
   * Nunca rechaza; si falla o agota el timeout, ejecuta `fallbackBuilder()`
   * y devuelve `{ scene, animations: [], isFallback: true }`.
   */
  loadGLTF(path, fallbackBuilder, timeoutMs = LOAD_TIMEOUT_MS) {
    return fetchGLTFOnce(path, timeoutMs).then((raw) => {
      if (raw && raw.ok && raw.scene) {
        return { scene: raw.scene, animations: raw.animations, isFallback: false };
      }
      return {
        scene: buildSafeFallback(path, fallbackBuilder),
        animations: [],
        isFallback: true,
      };
    });
  },

  /**
   * Wrapper compatible para props/armas: devuelve una instancia clonada del
   * GLB (compartiendo geometría y texturas en GPU) o una instancia nueva
   * del fallback procedural si la carga falló.
   */
  loadGLB(path, fallbackBuilder, timeoutMs = LOAD_TIMEOUT_MS) {
    return Assets.loadGLTF(path, fallbackBuilder, timeoutMs).then((res) => {
      if (res.isFallback) return res.scene;
      return res.scene.clone(true);
    });
  },

  /**
   * Libera geometrías, materiales y texturas NO compartidos de un subárbol.
   * Los recursos de GLB cacheados (`userData.shared === true`) jamás se
   * destruyen aquí para no romper otras instancias ni reintentos.
   */
  disposeObject(root) {
    if (!root || typeof root.traverse !== 'function') return;
    root.traverse((node) => {
      if (!node) return;
      if (node.geometry && !(node.geometry.userData && node.geometry.userData.shared) &&
          typeof node.geometry.dispose === 'function') {
        node.geometry.dispose();
      }
      const mats = Array.isArray(node.material) ? node.material : (node.material ? [node.material] : []);
      for (const mat of mats) {
        if (!mat) continue;
        for (const key of Object.keys(mat)) {
          const value = mat[key];
          if (value && value.isTexture && !(value.userData && value.userData.shared) &&
              typeof value.dispose === 'function') {
            value.dispose();
          }
        }
        if (!(mat.userData && mat.userData.shared) && typeof mat.dispose === 'function') {
          mat.dispose();
        }
      }
    });
  },

  clearCache() {
    gltfCache.clear();
  },
};

export { Assets };
export default Assets;

if (typeof window !== 'undefined') window.Assets = Assets;
