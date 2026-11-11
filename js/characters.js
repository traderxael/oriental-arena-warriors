/* ============================================================
   characters.js — Instanciación de personajes riggeados (GLB + fallback)

   Interfaz pública:
     Characters.instantiate(id, { height, tint, yaw, fallback })
       -> Promise<{
            root: THREE.Group,
            isFallback: boolean,
            mixer: THREE.AnimationMixer | null,
            handBone: THREE.Object3D | null,
            setLocomotion(mode),   // 'idle' | 'walk' (crossFade 0.2 s)
            playDeath(),           // LoopOnce + clampWhenFinished
            update(dt),
            dispose(),             // stopAllAction + uncacheRoot (nunca toca shared)
          }>
     Characters.upgrade(targetGroup, id, { height, tint, yaw, fallback, isAlive })
       -> Promise<Rig | null>
     Characters.activeMixerCount() -> number

   Garantías:
   - Usa SkeletonUtils.clone para compartir geometría entre todas las instancias.
   - Clones de material cacheados por (id, tint) y marcados `userData.shared = true`.
   - Tracks de posición root-motion en Hips/Root anulados en X/Z al cargar.
   - Si el GLB falta o falla, el fallback procedural permanece 100% intacto.
   ============================================================ */
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Assets } from './assets.js';

const ASSETS = {
  akane: { path: 'assets/characters/akane.glb', height: 1.8, yaw: 0 },
  goro: { path: 'assets/characters/goro.glb', height: 1.8, yaw: 0 },
  ashigaru: { path: 'assets/characters/ashigaru.glb', height: 1.74, yaw: 0 },
  oni: { path: 'assets/characters/oni.glb', height: 2.15, yaw: 0 },
};

const HAND_OVERRIDES = {
  akane: 'RightHand',
  goro: 'RightHand',
  ashigaru: 'RightHand',
  oni: 'RightHand',
};

const GUARD_TILT = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.95, 0, 0.45));

const strippedClips = new WeakSet();
const materialCache = new Map();
const loggedBoneIds = new Set();
let activeMixers = 0;

function stripClipsOnce(animations) {
  if (!Array.isArray(animations)) return [];
  const Logic = typeof window !== 'undefined' ? window.Logic : null;
  for (const clip of animations) {
    if (!clip || strippedClips.has(clip)) continue;
    if (Logic && typeof Logic.stripRootMotion === 'function') {
      Logic.stripRootMotion(clip.tracks);
    }
    strippedClips.add(clip);
  }
  return animations;
}

function classifyClip(name) {
  const Logic = typeof window !== 'undefined' ? window.Logic : null;
  if (Logic && typeof Logic.clipRole === 'function') return Logic.clipRole(name);
  const s = String(name || '');
  if (/dying|death/i.test(s)) return 'death';
  if (/jog|run|walk/i.test(s)) return 'walk';
  if (/idle/i.test(s)) return 'idle';
  return null;
}

function chooseHandBoneName(names, id) {
  const override = HAND_OVERRIDES[id];
  const Logic = typeof window !== 'undefined' ? window.Logic : null;
  if (Logic && typeof Logic.pickHandBone === 'function') {
    return Logic.pickHandBone(names, override);
  }
  if (override && names.indexOf(override) !== -1) return override;
  for (const n of names) {
    if (/hand.*r|r.*hand/i.test(n)) return n;
  }
  return null;
}

function resolveTintedMaterial(id, srcMat, tint) {
  if (!srcMat) return srcMat;
  if (!tint) return srcMat;
  const spec = typeof tint === 'string' ? { key: tint, color: tint } : tint;
  const tintKey = spec.key || [
    spec.color || '',
    spec.emissive || '',
    spec.emissiveIntensity || 0,
    spec.metalness != null ? spec.metalness : '',
    spec.roughness != null ? spec.roughness : '',
  ].join('|');
  const cacheKey = `${id}:${tintKey}:${srcMat.uuid}`;
  if (materialCache.has(cacheKey)) return materialCache.get(cacheKey);

  const m = srcMat.clone();
  m.userData = Object.assign({}, m.userData, { shared: true });
  if (spec.color && m.color) m.color.set(spec.color);
  if (spec.emissive && m.emissive) m.emissive.set(spec.emissive);
  if (typeof spec.emissiveIntensity === 'number') m.emissiveIntensity = spec.emissiveIntensity;
  if (typeof spec.metalness === 'number') m.metalness = spec.metalness;
  if (typeof spec.roughness === 'number') m.roughness = spec.roughness;
  materialCache.set(cacheKey, m);
  return m;
}

function makeNoopRig(fallbackRoot) {
  let disposed = false;
  return {
    root: fallbackRoot,
    isFallback: true,
    mixer: null,
    handBone: null,
    setLocomotion() {},
    playDeath() {},
    update() {},
    dispose() {
      if (disposed) return;
      disposed = true;
      if (fallbackRoot) Assets.disposeObject(fallbackRoot);
    },
  };
}

function instantiate(id, opts = {}) {
  const def = ASSETS[id];
  const fallback = typeof opts.fallback === 'function' ? opts.fallback : () => new THREE.Group();
  if (!def) {
    return Promise.resolve(makeNoopRig(fallback()));
  }
  const targetHeight = Number(opts.height) > 0 ? Number(opts.height) : def.height;
  const yaw = typeof opts.yaw === 'number' ? opts.yaw : def.yaw;
  const tint = opts.tint || null;

  return Assets.loadGLTF(def.path, fallback).then((res) => {
    if (!res || res.isFallback || !res.scene) {
      return makeNoopRig(res && res.scene ? res.scene : fallback());
    }
    try {
      const clips = stripClipsOnce(res.animations);
      const model = SkeletonUtils.clone(res.scene);
      const boneMap = new Map();
      const boneNames = [];

      model.traverse((node) => {
        if (!node) return;
        if (node.isBone && node.name) {
          boneMap.set(node.name, node);
          boneNames.push(node.name);
        }
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
          if (node.isSkinnedMesh) node.frustumCulled = false;
          if (Array.isArray(node.material)) {
            node.material = node.material.map((m) => resolveTintedMaterial(id, m, tint));
          } else if (node.material) {
            node.material = resolveTintedMaterial(id, node.material, tint);
          }
        }
      });

      if (!loggedBoneIds.has(id) && boneNames.length) {
        loggedBoneIds.add(id);
        console.info(`Characters [${id}] huesos (${boneNames.length}): ${boneNames.join(', ')}`);
      }

      // Normalizar altura objetivo, base en y = 0 y orientación forward = +Z
      model.rotation.y = yaw;
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      if (size.y > 0.001) {
        model.scale.setScalar(targetHeight / size.y);
        model.updateMatrixWorld(true);
        box.setFromObject(model);
      }
      const center = box.getCenter(new THREE.Vector3());
      model.position.set(-center.x, -box.min.y, -center.z);

      const wrap = new THREE.Group();
      wrap.name = `rig:${id}`;
      wrap.add(model);

      const handBoneName = chooseHandBoneName(boneNames, id);
      const handBone = handBoneName ? (boneMap.get(handBoneName) || model.getObjectByName(handBoneName)) : null;

      const mixer = new THREE.AnimationMixer(model);
      activeMixers += 1;

      const actions = { idle: null, walk: null, death: null };
      for (const clip of clips) {
        const role = classifyClip(clip.name);
        if (role && !actions[role]) {
          actions[role] = mixer.clipAction(clip);
        }
      }

      let currentMode = null;
      let dead = false;
      let disposed = false;

      if (actions.idle) {
        currentMode = 'idle';
        actions.idle.play();
      } else if (actions.walk) {
        currentMode = 'walk';
        actions.walk.play();
      }
      mixer.update(0);
      wrap.updateMatrixWorld(true);

      return {
        root: wrap,
        isFallback: false,
        mixer,
        handBone,
        setLocomotion(mode) {
          if (disposed || dead) return;
          const next = mode === 'walk' ? 'walk' : 'idle';
          if (next === currentMode) return;
          const to = actions[next];
          if (!to) return;
          const from = currentMode ? actions[currentMode] : null;
          currentMode = next;
          to.enabled = true;
          to.setEffectiveTimeScale(1);
          to.setEffectiveWeight(1);
          if (from && from !== to) {
            to.reset().play();
            from.crossFadeTo(to, 0.2, false);
          } else {
            to.reset().fadeIn(0.2).play();
          }
        },
        playDeath() {
          if (disposed || dead) return;
          dead = true;
          const d = actions.death;
          if (!d) return;
          d.reset();
          d.setLoop(THREE.LoopOnce, 1);
          d.clampWhenFinished = true;
          d.enabled = true;
          d.setEffectiveTimeScale(1);
          d.setEffectiveWeight(1);
          const from = currentMode ? actions[currentMode] : null;
          if (from && from !== d) {
            d.play();
            from.crossFadeTo(d, 0.15, false);
          } else {
            d.play();
          }
        },
        update(dt) {
          if (disposed || !(dt > 0)) return;
          mixer.update(dt);
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          activeMixers = Math.max(0, activeMixers - 1);
          mixer.stopAllAction();
          mixer.uncacheRoot(model);
        },
      };
    } catch (err) {
      console.warn(`Characters: fallo al instanciar "${id}" (${err && err.message ? err.message : err}). Usando fallback.`);
      return makeNoopRig(fallback());
    }
  });
}

/**
 * Hot-swap asíncrono sobre un Group procedural ya presente en escena:
 * conserva el pivote `weapon` existente y lo re-parenta al hueso de la
 * mano derecha del rig (o deja el Group procedural intacto si hay fallback).
 */
function upgrade(targetGroup, id, opts = {}) {
  const isAlive = typeof opts.isAlive === 'function' ? opts.isAlive : null;
  return instantiate(id, opts).then((rig) => {
    if (!rig) return null;
    if (!targetGroup || (isAlive && !isAlive())) {
      rig.dispose();
      return null;
    }
    if (rig.isFallback) {
      // El builder procedural ya está montado en targetGroup (con su arma): no tocarlo.
      rig.dispose();
      return null;
    }
    try {
      const weapon = targetGroup.getObjectByName('weapon');
      const fallbackWeaponPos = weapon ? weapon.position.clone() : null;
      if (weapon && weapon.parent) weapon.parent.remove(weapon);

      // Evaluar pose inicial de la mano con rig.root desacoplado (independiente del giro del personaje)
      rig.root.updateMatrixWorld(true);
      let mount = null;
      if (weapon && rig.handBone) {
        const handQ = new THREE.Quaternion();
        const handS = new THREE.Vector3(1, 1, 1);
        rig.handBone.getWorldQuaternion(handQ);
        rig.handBone.getWorldScale(handS);
        mount = new THREE.Group();
        mount.name = 'weaponMount';
        const invScale = handS.x > 1e-4 ? 1 / handS.x : 1;
        mount.scale.setScalar(invScale);
        mount.quaternion.copy(handQ).invert().multiply(GUARD_TILT);
        weapon.position.set(0, 0, 0);
        mount.add(weapon);
        rig.handBone.add(mount);
      }

      // Liberar únicamente las primitivas procedurales anteriores
      Assets.disposeObject(targetGroup);
      targetGroup.clear();
      targetGroup.add(rig.root);

      if (weapon && !mount) {
        if (fallbackWeaponPos) weapon.position.copy(fallbackWeaponPos);
        targetGroup.add(weapon);
      }
      return rig;
    } catch (err) {
      console.warn(`Characters: fallo en hot-swap de "${id}" (${err && err.message ? err.message : err}).`);
      rig.dispose();
      return null;
    }
  });
}

export const Characters = {
  ASSETS,
  HAND_OVERRIDES,
  instantiate,
  upgrade,
  activeMixerCount() {
    return activeMixers;
  },
};

export default Characters;

if (typeof window !== 'undefined') window.Characters = Characters;
