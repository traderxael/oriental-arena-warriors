/* ============================================================
   combat.js — Combate: combos, hitboxes, daño, especiales

   Interfaz pública (global de depuración `window.Combat` desde main.js):
     Combat.tryAttack(player, enemies, now) -> { hits: Enemy[] }
       Clic izquierdo. Cadena combo 1→2→3 dentro de `comboWindow`
       (hero.stats.comboWindow); el 4º golpe vuelve a empezar en 1.
       Hitbox = Logic.inArc con `range` del héroe y arco frontal de
       100° (ARC_RAD). Daño = Logic.comboDamage(damage, comboStep)
       (18/21/25 Akane · 34/39/48 Goro). Golpea a enemigos vivos con
       `takeDamage(n)` (fallback: resta de `hp`). Dispara el evento
       `combat:hit` por cada impacto (partículas/floaters en main.js).
     Combat.trySpecial(player, enemies, now) -> boolean
       Q. Akane «Desenvaine Relámpago»: línea rectilínea de 8 m
       delante, 60 daño a todos los que estén en ella.
       Goro «Tajo Giratorio»: 360° radio 3.5 m, 50 daño + knockback
       de 2.5 m (empujón inmediato en XZ, limitado al radio de la arena).
       Cooldown por héroe (hero.special.cooldown). Devuelve false si
       está en cooldown o el jugador está muerto.
     Combat.updateSpecialHud(player, now) — refresca #hud-special
     Combat.setSpecialHudName(hero)          — nombre del especial en #hud-special
     Combat.spawnDamageFloater(scene, pos, text, opts)
     Combat.updateFloaters(dt)               — subir + desvanecer (≤ 20 vivos)
     Combat.clearFloaters()                  — retirar todos (fin de partida)

   `now` es el reloj de juego en segundos (arenaClock.elapsedTime,
   clampeado a 0.05 por frame en main.js) — el mismo que usa
   attackCooldownUntil de los enemigos (Task 6).

   Módulo ES: importa THREE desde el CDN fijado a 0.160.0.
   ============================================================ */
import * as THREE from 'three';

const ARC_RAD = (100 * Math.PI) / 180; // arco frontal del ataque básico (100°)
const AKANE_LINE_DAMAGE = 60;
const AKANE_LINE_RANGE = 8;            // m de alcance rectilíneo
const AKANE_LINE_HALF_WIDTH = 1.0;     // m a cada lado del eje (línea con grosor)
const GORO_SPIN_DAMAGE = 50;
const GORO_SPIN_RADIUS = 3.5;          // m, 360°
const GORO_KNOCKBACK = 2.5;            // m de empujón inmediato
const FLOATER_CAP = 20;
const FLOATER_LIFE = 0.95;             // s
const FLOATER_RISE = 1.7;              // m/s

/* ---------- Combo / hitbox ---------- */

/** Envuelve un ángulo a ±π (mismo criterio que Logic.normalizeAngle). */
function normalizeAngle(angle) {
  let a = Number(angle);
  if (!Number.isFinite(a)) return 0;
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Vector frontal (XZ normalizado) a partir del yaw del jugador. */
function forwardXZ(yaw) {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

/** Distancia y ángulo al objetivo según la convención atan2(x, z) de player.js. */
function targetAngleAndDist(fromPos, toPos) {
  const dx = toPos.x - fromPos.x;
  const dz = toPos.z - fromPos.z;
  return { angle: Math.atan2(dx, dz), dist: Math.hypot(dx, dz), dx, dz };
}

function aliveEnemies(enemies) {
  if (!Array.isArray(enemies)) return [];
  return enemies.filter((e) => e && e.alive !== false && e.group && e.group.visible !== false);
}

/** Aplica el daño a un enemigo; devuelve los puntos efectivos o 0 si estaba muerto. */
function dealDamage(enemy, damage) {
  if (typeof enemy.takeDamage === 'function') {
    enemy.takeDamage(damage);
  } else {
    enemy.hp = Math.max(0, (Number(enemy.hp) || 0) - damage);
    if (enemy.hp <= 0) {
      enemy.alive = false;
      if (enemy.group) enemy.group.visible = false; // coherente con la interfaz Enemy
    }
  }
  const dead = enemy.alive === false || (Number(enemy.hp) || 0) <= 0;
  return { damage, killed: dead };
}

/* Comprobación defensiva de Audio (js/audio.js, binding léxico global).
   Si el audio está bloqueado o el archivo no cargó, el juego sigue igual. */
function sfx(name) {
  try {
    if (typeof Audio !== 'undefined' && Audio && typeof Audio.play === 'function') Audio.play(name);
  } catch (_err) { /* silencioso */ }
}

function emitHit(enemy, damage, killed) {
  sfx('hit');
  if (killed) sfx('enemyDie');
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  const p = enemy.group.position;
  window.dispatchEvent(new CustomEvent('combat:hit', {
    detail: { x: p.x, y: p.y + 1.4, z: p.z, damage, killed },
  }));
}

/**
 * Ataque básico. Avanza la cadena combo en el propio objeto jugador
 * (comboStep / comboExpiresAt) y devuelve { hits: Enemy[] } con los
 * enemigos alcanzados (misma referencia, tras aplicarles el daño).
 */
function tryAttack(player, enemies, now) {
  const result = { hits: [] };
  if (!player || !player.alive || !player.hero) return result;
  const t = Number(now) || 0;
  const stats = player.hero.stats || {};
  const range = Number(stats.range) || 2.6;
  const comboWindow = Number(stats.comboWindow) || 0.55;

  // Cadena 1→2→3 dentro de la ventana; si expiró, reinicia en 1.
  const chained = player.comboExpiresAt != null && t <= player.comboExpiresAt && player.comboStep >= 1;
  player.comboStep = chained ? (player.comboStep % 3) + 1 : 1;
  player.comboExpiresAt = t + comboWindow;

  const damage = Math.round((window.Logic
    ? window.Logic.comboDamage(stats.damage, player.comboStep)
    : Math.round((stats.damage || 0) * [1, 1.15, 1.4][player.comboStep - 1])) * (player.damageMult || 1));

  // Animación placeholder: tajo del pivote de arma (ver tickAttackAnim).
  player.swingStart = t;
  player.swingDuration = 0.3;
  player.swingStep = player.comboStep;
  sfx('slash');

  const facing = player.group.rotation.y;
  const origin = player.group.position;
  for (const enemy of aliveEnemies(enemies)) {
    const { angle, dist } = targetAngleAndDist(origin, enemy.group.position);
    const inRange = window.Logic
      ? window.Logic.inArc(angle, facing, ARC_RAD, dist, range)
      : dist <= range && Math.abs(normalizeAngle(angle - facing)) <= ARC_RAD / 2;
    if (!inRange) continue;
    const { killed } = dealDamage(enemy, damage);
    emitHit(enemy, damage, killed);
    result.hits.push(enemy);
  }
  return result;
}

/**
 * Especial (Q). Devuelve true si se ejecutó, false si está en cooldown/muerto.
 * Akane: línea de 8 m al frente · Goro: giro 360° radio 3.5 m + knockback.
 */
function trySpecial(player, enemies, now) {
  if (!player || !player.alive || !player.hero) return false;
  const t = Number(now) || 0;
  const special = player.hero.special || {};
  const cooldown = Number(special.cooldown) || 8;
  if ((player.specialCooldownUntil || 0) > t) return false; // en cooldown

  const facing = player.group.rotation.y;
  const fwd = forwardXZ(facing);
  const origin = player.group.position;
  const isGoro = player.hero.id === 'goro';

  player.specialCooldownUntil = t + cooldown;
  player.swingStart = t;
  player.swingDuration = 0.45;
  player.swingStep = 3;
  sfx('special');

  for (const enemy of aliveEnemies(enemies)) {
    const pos = enemy.group.position;
    const { dist, dx, dz } = targetAngleAndDist(origin, pos);
    let hit = false;
    if (isGoro) {
      hit = dist <= GORO_SPIN_RADIUS;
    } else {
      // Componente a lo largo y a lo ancho de la línea (rectángulo 8 × 2 m)
      const along = dx * fwd.x + dz * fwd.z;
      const perp = Math.abs(dx * fwd.z - dz * fwd.x);
      hit = along >= 0 && along <= AKANE_LINE_RANGE && perp <= AKANE_LINE_HALF_WIDTH;
    }
    if (!hit) continue;
    const damage = Math.round((isGoro ? GORO_SPIN_DAMAGE : AKANE_LINE_DAMAGE) * (player.damageMult || 1));
    const { killed } = dealDamage(enemy, damage);
    if (isGoro && dist > 1e-4) {
      // Empujón radial desde el jugador, limitado al borde de la arena
      const nx = dx / dist;
      const nz = dz / dist;
      const maxR = Math.max((player.arenaRadius || 38) - 0.7, 1);
      let newX = pos.x + nx * GORO_KNOCKBACK;
      let newZ = pos.z + nz * GORO_KNOCKBACK;
      const r = Math.hypot(newX, newZ);
      if (r > maxR) {
        newX = (newX / r) * maxR;
        newZ = (newZ / r) * maxR;
      }
      pos.x = newX;
      pos.z = newZ;
    }
    emitHit(enemy, damage, killed);
  }
  return true;
}

/* ---------- Animación placeholder de tajo ---------- */

/**
 * Oscila el pivote de arma (`name === 'weapon'`) durante un tajo.
 * Se llama cada frame desde el bucle de juego; reposa al terminar.
 */
function tickAttackAnim(player, now) {
  if (!player || !player.group) return;
  const weapon = player.group.getObjectByName('weapon');
  if (!weapon) return;
  if (player._weaponBaseZ == null) player._weaponBaseZ = weapon.rotation.z;
  const start = player.swingStart;
  const dur = player.swingDuration || 0.3;
  if (start == null) {
    weapon.rotation.z = player._weaponBaseZ;
    return;
  }
  const p = ((Number(now) || 0) - start) / dur;
  if (p >= 1 || p < 0) {
    weapon.rotation.z = player._weaponBaseZ;
    player.swingStart = null;
    return;
  }
  const dir = player.swingStep === 2 ? -1 : 1; // pasos 1 y 3: derecha→izquierda; 2: inverso
  weapon.rotation.z = player._weaponBaseZ + dir * Math.sin(p * Math.PI) * 1.55;
}

/* ---------- HUD del especial (#hud-special) ---------- */

function setSpecialHudName(hero) {
  const el = document.getElementById('hud-special-name');
  if (el) el.textContent = (hero && hero.special && hero.special.name) || 'Especial';
}

function updateSpecialHud(player, now) {
  const cdEl = document.getElementById('hud-special-cd');
  const cooldown = Number(player && player.hero && player.hero.special && player.hero.special.cooldown) || 8;
  const remaining = ((player && player.specialCooldownUntil) || 0) - (Number(now) || 0);
  const chargePct = remaining > 0
    ? Math.max(0, Math.min(100, (1 - remaining / cooldown) * 100))
    : 100;
  const qiFill = document.getElementById('hud-qi-fill');
  if (qiFill) qiFill.style.width = chargePct.toFixed(1) + '%';
  const qiBar = document.getElementById('hud-qi');
  if (qiBar) qiBar.setAttribute('aria-valuenow', String(Math.round(chargePct)));
  if (!cdEl) return;
  if (remaining > 0) {
    cdEl.textContent = remaining.toFixed(1) + ' s';
    cdEl.classList.remove('ready');
    cdEl.classList.add('cooling');
  } else {
    cdEl.textContent = 'Listo';
    cdEl.classList.remove('cooling');
    cdEl.classList.add('ready');
  }
}

/* ---------- Damage floaters (THREE.Sprite + canvas) ---------- */

const floaters = [];
let floaterTextureSeq = 0;

function makeFloaterTexture(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 80;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '800 46px "Noto Serif JP", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 9;
  ctx.strokeStyle = 'rgba(26, 26, 26, 0.9)';
  ctx.strokeText(text, 80, 42);
  ctx.fillStyle = color || '#f3e9d2';
  ctx.fillText(text, 80, 42);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 2;
  return tex;
}

/** Crea un floater en `pos` (se eleva y desvanece). Devuelve el sprite. */
function spawnDamageFloater(scene, pos, text, opts = {}) {
  if (!scene || !pos) return null;
  if (floaters.length >= FLOATER_CAP) {
    const oldest = floaters.shift();
    if (oldest) removeFloater(oldest);
  }
  const killed = !!opts.killed;
  const tex = makeFloaterTexture(String(text), opts.color || (killed ? '#d4af37' : '#f3e9d2'));
  tex.name = 'floater-' + (floaterTextureSeq += 1);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.5, 0.75, 1);
  sprite.position.set(pos.x, (pos.y || 0) + 0.2, pos.z);
  scene.add(sprite);
  floaters.push({ sprite, age: 0, life: FLOATER_LIFE });
  return sprite;
}

function removeFloater(f) {
  const sprite = f.sprite;
  if (sprite && sprite.parent) sprite.parent.remove(sprite);
  if (sprite && sprite.material) {
    if (sprite.material.map) sprite.material.map.dispose();
    sprite.material.dispose();
  }
}

/** Avanza los floaters: suben y se desvanecen; los que mueren se retiran de la escena. */
function updateFloaters(dt) {
  if (!(dt > 0)) return;
  for (let i = floaters.length - 1; i >= 0; i -= 1) {
    const f = floaters[i];
    f.age += dt;
    const p = f.age / f.life;
    if (p >= 1) {
      removeFloater(f);
      floaters.splice(i, 1);
      continue;
    }
    f.sprite.position.y += FLOATER_RISE * dt;
    f.sprite.material.opacity = 1 - p * p;
  }
}

/** Retira todos los floaters (p. ej. al volver al título / fin de partida). */
function clearFloaters() {
  while (floaters.length) removeFloater(floaters.pop());
}

export const Combat = {
  ARC_RAD,
  AKANE_LINE_DAMAGE,
  AKANE_LINE_RANGE,
  GORO_SPIN_DAMAGE,
  GORO_SPIN_RADIUS,
  FLOATER_CAP,
  tryAttack,
  trySpecial,
  tickAttackAnim,
  setSpecialHudName,
  updateSpecialHud,
  spawnDamageFloater,
  updateFloaters,
  clearFloaters,
  /** Sólo para depuración/tests: cuántos floaters vivos hay ahora. */
  floaterCount() { return floaters.length; },
};
export default Combat;
