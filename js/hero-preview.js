/* ============================================================
   hero-preview.js — Vista previa 3D lazy (256²) para el selector de héroe

   Un único WebGLRenderer sin sombras, fondo transparente (alpha: true),
   creado perezosamente al entrar en #screen-hero y destruido por completo
   al salir (0 contextos ni AnimationMixers residuales durante la partida).
   ============================================================ */
import * as THREE from 'three';
import { Assets } from './assets.js';
import { HEROES } from './heroes.js';
import { Characters } from './characters.js';

const PREVIEW_SIZE = 256;
const ROTATE_SPEED = 0.65; // rad/s

let state = null;
let mountToken = 0;

function disposeCurrentModel(s) {
  if (!s) return;
  s.heroToken += 1;
  if (s.rig) {
    s.rig.dispose();
    s.rig = null;
  }
  if (s.heroGroup) {
    if (s.heroGroup.parent) s.heroGroup.parent.remove(s.heroGroup);
    Assets.disposeObject(s.heroGroup);
    s.heroGroup = null;
  }
}

function loadHeroIntoPreview(s, heroId) {
  if (!s) return;
  disposeCurrentModel(s);
  const hero = HEROES.find((h) => h.id === heroId) || HEROES[0];
  if (!hero) return;

  const myToken = ++s.heroToken;
  const group = hero.builder();
  group.position.set(0, 0, 0);
  group.rotation.y = 0.35;
  s.stage.add(group);
  s.heroGroup = group;

  // Desactivar sombras en el preview (presupuesto ligero)
  group.traverse((n) => {
    if (n.isMesh) {
      n.castShadow = false;
      n.receiveShadow = false;
    }
  });

  Characters.upgrade(group, hero.id, {
    height: 1.8,
    fallback: hero.builder,
    isAlive: () => !!(state === s && s.heroToken === myToken),
  }).then((rig) => {
    if (!rig) return;
    if (state !== s || s.heroToken !== myToken) {
      rig.dispose();
      return;
    }
    s.rig = rig;
    group.traverse((n) => {
      if (n.isMesh) {
        n.castShadow = false;
        n.receiveShadow = false;
      }
    });
  });
}

function mount(container, heroId) {
  if (!container) return false;
  if (state && state.container === container) {
    setHero(heroId);
    return true;
  }
  unmount();

  let renderer;
  const canvas = document.createElement('canvas');
  canvas.id = 'hero-preview-canvas';
  canvas.width = PREVIEW_SIZE;
  canvas.height = PREVIEW_SIZE;
  canvas.setAttribute('aria-hidden', 'true');
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
  } catch (err) {
    console.warn('HeroPreview: WebGL no disponible para el visor 256² (' + (err && err.message ? err.message : err) + ').');
    return false;
  }

  renderer.setPixelRatio(1);
  renderer.setSize(PREVIEW_SIZE, PREVIEW_SIZE, false);
  renderer.shadowMap.enabled = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 20);
  camera.position.set(0, 1.25, 3.55);
  camera.lookAt(0, 0.95, 0);

  const hemi = new THREE.HemisphereLight('#fff4dc', '#3b2b20', 1.15);
  const key = new THREE.DirectionalLight('#ffe4b5', 1.75);
  key.position.set(2.4, 3.6, 3.2);
  const rim = new THREE.DirectionalLight('#ff8260', 0.85);
  rim.position.set(-2.5, 2.0, -2.4);
  scene.add(hemi, key, rim);

  // Pedestal de laca y oro bajo los pies
  const stage = new THREE.Group();
  const discGeo = new THREE.CylinderGeometry(0.76, 0.84, 0.08, 32);
  const discMat = new THREE.MeshStandardMaterial({ color: '#241a15', roughness: 0.45, metalness: 0.25 });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.position.y = -0.04;
  const ringGeo = new THREE.TorusGeometry(0.78, 0.022, 8, 36);
  const ringMat = new THREE.MeshStandardMaterial({ color: '#d4af37', roughness: 0.32, metalness: 0.78 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.002;
  stage.add(disc, ring);
  scene.add(stage);

  container.textContent = '';
  container.appendChild(canvas);

  const myMount = ++mountToken;
  const clock = new THREE.Clock();
  const s = {
    container,
    canvas,
    renderer,
    scene,
    camera,
    stage,
    pedestalDisposables: [discGeo, discMat, ringGeo, ringMat],
    heroGroup: null,
    rig: null,
    heroToken: 0,
    rafId: null,
    mountId: myMount,
  };
  state = s;

  loadHeroIntoPreview(s, heroId);

  function loop() {
    if (state !== s || s.mountId !== myMount) return;
    s.rafId = requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    s.stage.rotation.y += ROTATE_SPEED * dt;
    if (s.rig) s.rig.update(dt);
    s.renderer.render(s.scene, s.camera);
  }
  loop();
  return true;
}

function setHero(heroId) {
  if (!state) return;
  loadHeroIntoPreview(state, heroId);
}

function unmount() {
  if (!state) return;
  const s = state;
  state = null;
  if (s.rafId) cancelAnimationFrame(s.rafId);
  disposeCurrentModel(s);
  for (const d of s.pedestalDisposables) {
    if (d && typeof d.dispose === 'function') d.dispose();
  }
  try {
    s.renderer.dispose();
  } catch (_err) { /* silencioso */ }
  if (s.canvas && s.canvas.parentElement) {
    s.canvas.parentElement.removeChild(s.canvas);
  }
}

function isMounted() {
  return !!state;
}

export const HeroPreview = { mount, setHero, unmount, isMounted };
export default HeroPreview;

if (typeof window !== 'undefined') window.HeroPreview = HeroPreview;
