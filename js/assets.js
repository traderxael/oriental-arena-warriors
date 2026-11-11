/* ============================================================
   assets.js — Carga de GLB con fallback procedural

   Interfaz pública:
     Assets.loadGLB(path, fallbackBuilder, [timeoutMs]) -> Promise<THREE.Group>

   Garantías:
   - NUNCA rechaza: en error del loader o por timeout (8 s por defecto)
     loguea un console.warn descriptivo y resuelve con fallbackBuilder().
   - Si fallbackBuilder lanza o no devuelve un Object3D, también se
     resuelve (con un Group vacío) — el juego jamás ve un rechazo.
   - Los GLB commiteados en assets/ se sirven estáticos desde la raíz;
     no se enlazan hotlinks externos.

   import * as THREE + GLTFLoader (three/addons) fijados a 0.160.0
   vía el import map de index.html.
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const LOAD_TIMEOUT_MS = 8000;

const Assets = {
  /**
   * Carga un GLB. Si falla (red, 404, GLB corrupto, CORS) o expira el
   * timeout, devuelve el builder procedural de fallback.
   * @param {string} path Ruta relativa al GLB (p. ej. 'assets/props/torch.glb')
   * @param {() => THREE.Object3D} fallbackBuilder Builder procedural de respaldo
   * @param {number} [timeoutMs] Timeout en ms (defecto 8000)
   * @returns {Promise<THREE.Group>} El GLB (o el fallback) como Group
   */
  loadGLB(path, fallbackBuilder, timeoutMs = LOAD_TIMEOUT_MS) {
    const buildFallback = () => {
      try {
        const group = fallbackBuilder();
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
    };

    return new Promise((resolve) => {
      let settled = false;
      const finish = (obj, warn) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (warn) console.warn(warn);
        resolve(obj);
      };

      const timer = setTimeout(() => {
        finish(buildFallback(), `Assets: tiempo de espera agotado (${timeoutMs} ms) al cargar "${path}". Usando fallback procedural.`);
      }, timeoutMs);

      const loader = new GLTFLoader();
      loader.load(
        path,
        (gltf) => {
          const model = gltf && gltf.scene ? gltf.scene : new THREE.Group();
          model.name = model.name || path;
          model.traverse((node) => {
            if (node.isMesh) {
              node.castShadow = true;
              node.receiveShadow = true;
            }
          });
          console.info(`Assets: GLB cargado: "${path}".`);
          finish(model, null);
        },
        undefined,
        (error) => {
          const reason = error && (error.message || error.type || error.status)
            ? `${error.message || error.type || error.status}`
            : 'error desconocido';
          finish(buildFallback(), `Assets: no se pudo cargar el GLB "${path}" (${reason}). Usando fallback procedural.`);
        }
      );
    });
  },

  /**
   * Libera geometrías y materiales de un subárbol (útil al reconstruir
   * personajes/enemigos entre partidas para no acumular GPU).
   * @param {THREE.Object3D} root
   */
  disposeObject(root) {
    if (!root || typeof root.traverse !== 'function') return;
    root.traverse((node) => {
      if (!node) return;
      if (node.geometry && typeof node.geometry.dispose === 'function') {
        node.geometry.dispose();
      }
      const mats = Array.isArray(node.material) ? node.material : (node.material ? [node.material] : []);
      for (const mat of mats) {
        if (!mat) continue;
        for (const key of Object.keys(mat)) {
          const value = mat[key];
          if (value && value.isTexture && typeof value.dispose === 'function') value.dispose();
        }
        if (typeof mat.dispose === 'function') mat.dispose();
      }
    });
  },
};

export { Assets };
export default Assets;

// Acceso global de sólo lectura para depuración y scripts clásicos futuros.
if (typeof window !== 'undefined') window.Assets = Assets;
