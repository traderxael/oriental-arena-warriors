/* ============================================================
   player.js — Controlador del jugador

   Interfaz pública:
     createPlayer(heroId, scene, map) -> {
       group,               // THREE.Group ya añadido a `scene`
       update(dt, input, camera),
       dash(),              // impulso + i-frames 0.35 s, cooldown 1.2 s
       hp, maxHp, alive,
       isInvulnerable(),    // true durante los i-frames del dash
       hero,                // definición del héroe (stats, special…)
       arenaRadius,         // radio de la arena (knockback del especial)
       comboStep,           // 0-3: paso actual de la cadena combo (Task 5)
       comboExpiresAt,      // s (reloj de juego) en que expira la cadena
       specialCooldownUntil,// s (reloj de juego) hasta el que el especial está en cooldown
       swingStart,          // s del inicio del tajo (animación placeholder)
       swingDuration,
       swingStep,
     }

   `input` es un objeto de booleanos: { forward, back, left, right }
   (main.js lo construye desde WASD / flechas). El movimiento es
   relativo a la cámara: W avanza en la dirección a la que mira la
   cámara proyectada sobre el suelo.

   Colisión circular: la posición se limita a `map.radius - PLAYER_RADIUS`
   desde el origen (el Coliseo es circular; `bounds` es sólo la caja
   envolvente). Cámara tercera persona detrás del jugador con offset
   (0, 4.2, 6.5) en su espacio local; main.js la actualiza con
   `updateCamera(dt)` — también con clamp para no atravesar el muro.

   Módulo ES: importa THREE desde el CDN fijado a 0.160.0 (import map).
   ============================================================ */
import * as THREE from 'three';
import { HEROES } from './heroes.js';

const PLAYER_RADIUS = 0.7;
const DASH_SPEED = 13;          // m/s durante el impulso
const DASH_TIME = 0.18;         // s de impulso
const DASH_IFRAMES = 0.35;      // s de invulnerabilidad
const DASH_COOLDOWN = 1.2;      // s entre dashes
const UP = new THREE.Vector3(0, 1, 0);

export const CAMERA_OFFSET = new THREE.Vector3(0, 4.2, 6.5);

/** Interpola ángulos por el camino corto. */
function dampAngle(current, target, lambda, dt) {
  let delta = (target - current) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-lambda * dt));
}

/** Devuelve la posición con su radio en XZ limitado a la arena. */
function clampToArena(pos, radius) {
  const max = Math.max((radius || 38) - PLAYER_RADIUS, 1);
  const r = Math.hypot(pos.x, pos.z);
  if (r > max) {
    const s = max / r;
    pos.x *= s;
    pos.z *= s;
  }
  return pos;
}

function createPlayer(heroId, scene, map) {
  let hero = HEROES.find((h) => h.id === heroId);
  if (!hero) {
    console.warn(`createPlayer: héroe desconocido "${heroId}"; se usa "${HEROES[0] && HEROES[0].id}" por defecto.`);
    hero = HEROES[0];
  }
  const arenaRadius = map && typeof map.radius === 'number' ? map.radius : 38;

  const group = hero.builder();
  group.position.set(0, 0, 0);
  group.rotation.y = 0;
  scene.add(group);

  const maxHp = hero.stats.hp;
  const player = {
    group,
    hero,
    arenaRadius,
    hp: maxHp,
    maxHp,
    alive: true,
    // Combate (Task 5): cadena combo, cooldown del especial, animación de tajo
    comboStep: 0,
    comboExpiresAt: -1,
    specialCooldownUntil: 0,
    swingStart: null,
    swingDuration: 0.3,
    swingStep: 0,
    // estado interno
    time: 0,
    dashTime: 0,
    dashCooldown: 0,
    invulnerableUntil: -1,
    moveDir: new THREE.Vector3(0, 0, 1),
    dashDir: new THREE.Vector3(0, 0, 1),
    isInvulnerable() {
      return this.time < this.invulnerableUntil;
    },
    dash() {
      if (!this.alive) return false;
      if (this.dashCooldown > 0) return false;
      this.dashTime = DASH_TIME;
      this.dashCooldown = DASH_COOLDOWN;
      this.invulnerableUntil = this.time + DASH_IFRAMES;
      this.dashDir.copy(this.moveDir);
      if (this.dashDir.lengthSq() < 1e-6) this.dashDir.set(0, 0, 1);
      this.dashDir.y = 0;
      this.dashDir.normalize();
      return true;
    },
    update(dt, input, camera) {
      if (!this.alive) return;
      if (!(dt > 0)) return;
      this.time += dt;
      this.dashCooldown = Math.max(0, this.dashCooldown - dt);

      // Ejes de cámara proyectados al suelo
      const fwd = new THREE.Vector3();
      if (camera) camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();

      const move = new THREE.Vector3();
      if (input) {
        if (input.forward) move.add(fwd);
        if (input.back) move.sub(fwd);
        if (input.right) move.add(right);
        if (input.left) move.sub(right);
      }
      const moving = move.lengthSq() > 1e-6;
      if (moving) {
        move.normalize();
        this.moveDir.copy(move);
      }

      if (this.dashTime > 0) {
        this.dashTime = Math.max(0, this.dashTime - dt);
        group.position.addScaledVector(this.dashDir, DASH_SPEED * dt);
      } else if (moving) {
        group.position.addScaledVector(move, hero.stats.speed * dt);
      }
      clampToArena(group.position, arenaRadius);

      // Rotación hacia la dirección de movimiento (o del dash)
      const facing = this.dashTime > 0 ? this.dashDir : (moving ? move : null);
      if (facing) {
        const target = Math.atan2(facing.x, facing.z);
        group.rotation.y = dampAngle(group.rotation.y, target, 12, dt);
      }
    },
  };

  return player;
}

/**
 * Cámara tercera persona: detrás del jugador (offset CAMERA_OFFSET en su
 * espacio local), con clamp circular para no atravesar el muro del Coliseo.
 * `snap` coloca la cámara directamente (primer frame); si es false, suaviza.
 */
function updateCamera(dt, camera, player, map, snap = false) {
  if (!camera || !player) return;
  const arenaRadius = map && typeof map.radius === 'number' ? map.radius : 38;
  const p = player.group.position;
  const desired = CAMERA_OFFSET.clone().applyAxisAngle(UP, player.group.rotation.y).add(p);
  // Clamp: la cámara no sale de la arena (muro en arenaRadius)
  const camMax = Math.max(arenaRadius - 0.6, 1);
  const camR = Math.hypot(desired.x, desired.z);
  if (camR > camMax) {
    const s = camMax / camR;
    desired.x *= s;
    desired.z *= s;
  }
  if (snap || !(dt > 0)) {
    camera.position.copy(desired);
  } else {
    camera.position.lerp(desired, 1 - Math.exp(-6 * dt));
  }
  camera.lookAt(p.x, p.y + 1.3, p.z);
}

export { createPlayer, updateCamera, clampToArena };
export default createPlayer;
