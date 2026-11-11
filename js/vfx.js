/* ============================================================
   vfx.js — Efectos baratos: pétalos de sakura, trail de dash, shake

   Interfaz pública:
     VFX.init(scene)          — guarda la escena (una vez)
     VFX.setPetals(n)         — reconstruye el Points de pétalos (1 draw call)
     VFX.update(dt, t)        — deriva de pétalos + fade del trail
     VFX.dashTrail(pos, dir)  — estela aditiva de 6 sprites (0.25 s)
     VFX.addShake(amount)     — acumula sacudida de cámara (tope 0.6)
     VFX.applyShake(cam, dt)  — offset decayente; llamar tras updateCamera
     VFX.clearTransient()     — limpia trail y shake al salir de partida

   Todo son Points/Sprites con depthWrite=false: sin luces ni sombras.
   ============================================================ */
import * as THREE from 'three';

let sceneRef = null;
let petals = null;
let petalVel = null;
let petalPhase = null;
let shake = 0;
const trail = [];

function petalTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(16, 16, 2, 16, 16, 15);
  grad.addColorStop(0, 'rgba(255,214,224,1)');
  grad.addColorStop(0.6, 'rgba(247,180,196,0.85)');
  grad.addColorStop(1, 'rgba(247,180,196,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(16, 16, 14, 9, Math.PI / 5, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let sharedPetalTex = null;

function buildPetals(count) {
  if (petals) {
    sceneRef.remove(petals);
    petals.geometry.dispose();
    petals.material.dispose();
    petals = null;
  }
  if (!sceneRef || count <= 0) return;
  if (!sharedPetalTex) sharedPetalTex = petalTexture();
  const positions = new Float32Array(count * 3);
  petalVel = new Float32Array(count);
  petalPhase = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 40;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = Math.random() * 12;
    positions[i * 3 + 2] = Math.sin(a) * r;
    petalVel[i] = 0.5 + Math.random() * 0.7;
    petalPhase[i] = Math.random() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    map: sharedPetalTex,
    color: 0xffffff,
    size: 0.24,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    sizeAttenuation: true,
  });
  petals = new THREE.Points(geo, mat);
  petals.frustumCulled = false;
  sceneRef.add(petals);
}

function trailTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
  grad.addColorStop(0, 'rgba(255,236,180,0.9)');
  grad.addColorStop(1, 'rgba(255,180,90,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let sharedTrailTex = null;

const VFX = {
  init(scene) {
    sceneRef = scene;
  },
  setPetals(count) {
    buildPetals(count);
  },
  update(dt, t) {
    if (!(dt > 0)) return;
    if (petals) {
      const attr = petals.geometry.getAttribute('position');
      const n = attr.count;
      for (let i = 0; i < n; i += 1) {
        let y = attr.getY(i) - petalVel[i] * dt;
        if (y < 0.05) y = 12;
        const ph = petalPhase[i];
        attr.setXYZ(
          i,
          attr.getX(i) + Math.sin(t * 0.9 + ph) * 0.55 * dt,
          y,
          attr.getZ(i) + Math.cos(t * 0.7 + ph * 1.3) * 0.55 * dt
        );
      }
      attr.needsUpdate = true;
    }
    for (let i = trail.length - 1; i >= 0; i -= 1) {
      const s = trail[i];
      s.age += dt;
      const p = s.age / s.life;
      if (p >= 1) {
        sceneRef.remove(s.sprite);
        s.sprite.material.dispose();
        trail.splice(i, 1);
        continue;
      }
      s.sprite.material.opacity = 0.7 * (1 - p);
      s.sprite.scale.setScalar(s.size * (1 + p * 0.8));
    }
  },
  dashTrail(pos, dir) {
    if (!sceneRef) return;
    if (!sharedTrailTex) sharedTrailTex = trailTexture();
    for (let i = 0; i < 6; i += 1) {
      const mat = new THREE.SpriteMaterial({
        map: sharedTrailTex,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(mat);
      const back = (i / 6) * 1.6;
      sprite.position.set(
        pos.x - dir.x * back,
        0.9 + Math.random() * 0.5,
        pos.z - dir.z * back
      );
      const size = 0.7 + Math.random() * 0.4;
      sprite.scale.setScalar(size);
      sceneRef.add(sprite);
      trail.push({ sprite, age: 0, life: 0.25, size });
    }
  },
  addShake(amount) {
    shake = Math.min(0.6, shake + Math.max(0, Number(amount) || 0));
  },
  applyShake(camera, dt) {
    if (!camera || shake <= 0.001) return;
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake * 0.7;
    camera.position.z += (Math.random() - 0.5) * shake;
    shake *= Math.exp(-6 * Math.max(dt, 0.001));
  },
  clearTransient() {
    for (const s of trail) {
      sceneRef && sceneRef.remove(s.sprite);
      s.sprite.material.dispose();
    }
    trail.length = 0;
    shake = 0;
  },
};

export { VFX };
export default VFX;