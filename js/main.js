/* ============================================================
   main.js — Máquina de estados y arranque del juego
   Estados (global `state`):
     TITLE | MODE | HERO | MAP | PLAY | PAUSE | GAMEOVER
   La navegación entre pantallas se hace siempre vía ui.showScreen(id).
   Módulo ES: importa THREE desde el CDN fijado a 0.160.0 (import map
   de index.html). ui.js y logic.js siguen siendo scripts clásicos
   cargados antes que este módulo.
   ============================================================ */
import * as THREE from 'three';
import { Assets } from './assets.js';
import { Maps } from './maps.js';
import { HEROES } from './heroes.js';
import { createPlayer, updateCamera } from './player.js';
import { Combat } from './combat.js';
import { Enemies } from './enemies.js';

// Dummies de prueba (Task 5): sólo con la URL ?debug=dummies. NO es contenido de juego.
const DEBUG_DUMMIES = new URLSearchParams(window.location.search).get('debug') === 'dummies';

// Expone THREE para consola/depuración y para que checkEngine()
// y el resto del código clásico puedan inspeccionar la versión.
window.THREE = THREE;
// Señal al watchdog inline (non-module) de que el motor cargó.
window.__threeOk = true;

var state = 'TITLE';

let selectedHeroId = HEROES[0].id;

// Reloj de juego (segundos), actualizado cada frame en animateArena.
// Los handlers de ratón/teclado lo usan para `now` (combos, cooldowns).
let playTime = 0;
// Enemigos vivos (los crea js/enemies.js)
let enemies = [];
// Estado de la oleada en curso (spawn escalonado + avance automático)
let waveState = { wave: 0, queue: [], spawnTimer: 0, spawnedAll: true, clearTimer: 0, maxAlive: 8 };
const SPAWN_INTERVAL = 0.8;   // s entre apariciones dentro de una oleada
const WAVE_CLEAR_DELAY = 3;   // s de respiro antes de la siguiente oleada
// Ráfagas de partículas activas (evento combat:hit)
const hitBursts = [];

// Teclas de movimiento pulsadas (KeyW/A/S/D + flechas). Se traducen a
// booleanos { forward, back, left, right } para player.update(dt, input, camera).
const keys = new Set();

function readPlayerInput() {
  return {
    forward: keys.has('KeyW') || keys.has('ArrowUp'),
    back: keys.has('KeyS') || keys.has('ArrowDown'),
    left: keys.has('KeyA') || keys.has('ArrowLeft'),
    right: keys.has('KeyD') || keys.has('ArrowRight'),
  };
}

/* ---------- Motor 3D / WebGL: comprobaciones de arranque ---------- */

function showFatalError(detail) {
  // Ya se muestra un error específico: desactivar el watchdog para que no lo sobrescriba.
  if (window.__engineWatchdog) {
    clearTimeout(window.__engineWatchdog);
    window.__engineWatchdog = null;
  }
  const box = document.getElementById('webgl-error');
  const detailEl = document.getElementById('webgl-error-detail');
  if (detailEl && detail) detailEl.textContent = detail;
  if (box) box.classList.remove('hidden');
  const app = document.getElementById('app');
  if (app) app.classList.add('hidden');
}

function checkEngine() {
  // 1) ¿Importó el módulo de Three.js desde la CDN? (si no, este módulo no llega a ejecutarse
  //    y el watchdog inline muestra el error genérico)
  if (!THREE || typeof THREE.REVISION !== 'string') {
    showFatalError('No se pudo cargar el motor 3D desde la red (CDN de Three.js). Revisa tu conexión a internet y recarga la página.');
    return false;
  }
  // 2) ¿Versión desalineada con la fijada en index.html?
  if (THREE.REVISION !== '160') {
    showFatalError('No se pudo cargar el motor 3D: se esperaba Three.js r160 y se cargó r' + THREE.REVISION + '. Recarga la página o avisa al equipo.');
    return false;
  }
  // 3) ¿WebGL disponible en este navegador/equipo?
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      showFatalError('Tu navegador o equipo no soporta WebGL, necesario para renderizar la arena 3D. Prueba con Chrome, Edge o Firefox actualizados y con la aceleración por hardware activada.');
      return false;
    }
  } catch (err) {
    showFatalError('No se pudo inicializar WebGL en este navegador. Prueba con Chrome, Edge o Firefox actualizados.');
    return false;
  }
  return true;
}

function markEngineReady() {
  if (window.__engineWatchdog) {
    clearTimeout(window.__engineWatchdog);
    window.__engineWatchdog = null;
  }
  // Recuperación limpia si el watchdog llegó a mostrar el error por un CDN lento:
  // ocultar el error y volver a mostrar la app cuando el módulo por fin cargó.
  const box = document.getElementById('webgl-error');
  if (box) box.classList.add('hidden');
  const app = document.getElementById('app');
  if (app) app.classList.remove('hidden');
}

/* ---------- Arena 3D: Coliseo (Task 3) ---------- */

let arena = null;        // { scene, camera, renderer, flames, flickerLights, rafId, radius, player }
let arenaClock = null;
let lastHpShown = -1;

function startArena() {
  const canvas = document.getElementById('game-canvas');
  if (!canvas) return;

  if (!arena) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#efd9a7');
    scene.fog = new THREE.Fog('#efd9a7', 90, 240);

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);

    const built = Maps.buildColosseum(scene);
    arena = {
      scene,
      camera,
      renderer,
      flames: built.flames,
      flickerLights: built.flickerLights,
      bounds: built.bounds,
      spawnPoints: built.spawnPoints,
      radius: built.radius,
      rafId: null,
      player: null,
    };
    window.__arena = arena; // depuración
    console.log('Coliseo construido. Radio de colisión: ' + arena.radius + ' — spawn points: ' + arena.spawnPoints.length);

    window.addEventListener('resize', resizeArena);
  }

  resizeArena();
  canvas.classList.remove('hidden');
  const placeholder = document.querySelector('#hud .hud-placeholder');
  if (placeholder) placeholder.classList.add('hidden');

  arenaClock = new THREE.Clock();
  if (arena.rafId) cancelAnimationFrame(arena.rafId);
  animateArena();
}

function stopArena() {
  if (arena && arena.rafId) {
    cancelAnimationFrame(arena.rafId);
    arena.rafId = null;
  }
  removeEnemies();
  Combat.clearFloaters();
  clearHitBursts();
  removePlayer();
  const canvas = document.getElementById('game-canvas');
  if (canvas) canvas.classList.add('hidden');
  const placeholder = document.querySelector('#hud .hud-placeholder');
  if (placeholder) placeholder.classList.remove('hidden');
}

/* ---------- Enemigos ---------- */

/* Libera los recursos propios de todos los enemigos vivos y vacía la lista.
   Los muertos ya fueron retirados (y liberados) por Enemies.updateAll. */
function removeEnemies() {
  for (const enemy of enemies) {
    if (enemy) Enemies.dispose(enemy);
  }
  enemies = [];
  window.__enemies = enemies;
}

/**
 * 3 cubos de prueba: 2 delante (en el arco de ataque) y 1 detrás
 * (para comprobar que NO recibe daño). takeDamage compatible con la
 * interfaz Enemy de Task 6 ({group, hp, maxHp, alive, takeDamage, update}).
 */
function spawnDebugDummies() {
  if (!arena) return;
  const defs = [
    { x: 0.9, z: 1.8 },   // delante-derecha: dentro de alcance, arco y línea (2.01 m)
    { x: -0.8, z: 1.9 },  // delante-izquierda: dentro de alcance, arco y línea (2.06 m)
    { x: 0, z: -1.5 },    // detrás: fuera del arco de 100° (y del especial lineal)
  ];
  for (const d of defs) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 1.5, 0.8),
      new THREE.MeshStandardMaterial({ color: '#7a4a2b', roughness: 0.85 })
    );
    body.position.y = 0.75;
    body.castShadow = true;
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.5, 0.5),
      new THREE.MeshStandardMaterial({ color: '#5d3a22', roughness: 0.85 })
    );
    head.position.y = 1.72;
    head.castShadow = true;
    g.add(body, head);
    g.position.set(d.x, 0, d.z);
    arena.scene.add(g);
    const dummy = {
      group: g,
      hp: 60,
      maxHp: 60,
      type: 'dummy',
      alive: true,
      ownsResources: true, // geometría/materiales creados aquí: se liberan en removeEnemies()
      attackCooldownUntil: 0,
      takeDamage(n) {
        this.hp = Math.max(0, this.hp - Math.max(0, Number(n) || 0));
        if (this.hp <= 0) {
          this.alive = false;
          this.group.visible = false;
        }
      },
      update() { /* sin IA: es un maniquí */ },
    };
    enemies.push(dummy);
  }
  window.__enemies = enemies;
  console.log('Dummies de depuración creados (?debug=dummies): 2 delante + 1 detrás.');
}

/* ---------- Oleadas (spawn escalonado) ---------- */

/**
 * Prepara la oleada `wave`: encola los enemigos de Logic.waveComposition
 * (mezclados) y respeta maxAlive (≤ 25). Los tipos aún no implementados
 * (lancero, brute) se omiten con un aviso claro en consola.
 */
function startWave(wave) {
  const comp = window.Logic
    ? window.Logic.waveComposition(wave)
    : { ronin: 3, bandido: 0, lancero: 0, brute: 0, maxAlive: 8 };
  const queue = [];
  for (const type of Enemies.SUPPORTS) {
    const n = Number(comp[type]) || 0;
    for (let i = 0; i < n; i += 1) queue.push(type);
  }
  const dropped = (Number(comp.lancero) || 0) + (Number(comp.brute) || 0);
  if (dropped > 0) {
    console.info('Oleada ' + wave + ': lancero/brute aún no implementados; se omiten ' + dropped + ' enemigos.');
  }
  // Mezcla aleatoria para que no salgan en bloques por tipo
  for (let i = queue.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = queue[i];
    queue[i] = queue[j];
    queue[j] = tmp;
  }
  waveState = {
    wave,
    queue,
    spawnTimer: 0, // primer enemigo inmediato
    spawnedAll: queue.length === 0,
    clearTimer: 0,
    maxAlive: Math.min(Number(comp.maxAlive) || 8, 25),
  };
  const waveEl = document.getElementById('hud-wave');
  if (waveEl) waveEl.textContent = String(wave);
  console.log('Oleada ' + wave + ': ' + (comp.ronin || 0) + ' ronin, ' + (comp.bandido || 0) +
    ' bandido — maxAlive ' + waveState.maxAlive);
}

/** Saca enemigos de la cola cada 0.8 s respetando maxAlive; avanza de oleada al limpiarla. */
function tickWaveSpawning(dt) {
  if (state !== 'PLAY' || !arena) return;
  const ws = waveState;
  if (ws.queue.length) {
    ws.spawnTimer -= dt;
    if (ws.spawnTimer <= 0) {
      if (enemies.length < ws.maxAlive) {
        const type = ws.queue.shift();
        enemies.push(Enemies.spawn(type, ws.wave, arena, arena.scene));
        window.__enemies = enemies;
        ws.spawnTimer = SPAWN_INTERVAL;
      } else {
        ws.spawnTimer = 0.25; // llena la oleada posible: reintentar pronto
      }
      if (!ws.queue.length) ws.spawnedAll = true;
    }
    return;
  }
  if (ws.spawnedAll && enemies.length === 0) {
    ws.clearTimer += dt;
    if (ws.clearTimer >= WAVE_CLEAR_DELAY) startWave(ws.wave + 1);
  }
}

/* ---------- Vignette de daño ---------- */

let vignetteTimer = null;

/** Flash rojo breve en #vignette-damage al recibir daño. */
function flashDamageVignette() {
  const el = document.getElementById('vignette-damage');
  if (!el) return;
  el.classList.add('on');
  if (vignetteTimer) clearTimeout(vignetteTimer);
  vignetteTimer = setTimeout(() => el.classList.remove('on'), 220);
}

/** Daño de un enemigo (windup completado) → HP del jugador + flash. */
function damagePlayer(damage) {
  const p = arena && arena.player;
  if (!p || !p.alive) return;
  if (typeof p.isInvulnerable === 'function' && p.isInvulnerable()) return; // i-frames del dash
  p.hp = Math.max(0, p.hp - Math.max(0, Number(damage) || 0));
  flashDamageVignette();
  lastHpShown = -1;
  syncHpHud();
  if (p.hp <= 0) {
    p.alive = false;
    // TODO(Task 7): cablear la derrota aquí (ui.showGameOver + stopArena).
    // Por ahora el jugador queda tumbado y la partida sigue sin enemigos atacando.
    console.log('El jugador ha caído en la arena (oleada ' + waveState.wave + ').');
  }
}

/* ---------- Partículas de impacto (evento combat:hit) ---------- */

function spawnHitParticles(x, y, z) {
  if (!arena) return;
  const count = 14;
  const positions = new Float32Array(count * 3);
  const velocities = [];
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    const angle = Math.random() * Math.PI * 2;
    const up = Math.random() * 2.4 + 1.2;
    const speed = Math.random() * 2.6 + 1.6;
    velocities.push(new THREE.Vector3(Math.cos(angle) * speed, up, Math.sin(angle) * speed));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xd4af37,
    size: 0.11,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  arena.scene.add(points);
  hitBursts.push({ points, velocities, age: 0, life: 0.6 });
}

function updateHitParticles(dt) {
  if (!(dt > 0)) return;
  for (let i = hitBursts.length - 1; i >= 0; i -= 1) {
    const burst = hitBursts[i];
    burst.age += dt;
    const p = burst.age / burst.life;
    if (p >= 1) {
      burst.points.parent && burst.points.parent.remove(burst.points);
      burst.points.geometry.dispose();
      burst.points.material.dispose();
      hitBursts.splice(i, 1);
      continue;
    }
    const attr = burst.points.geometry.getAttribute('position');
    for (let j = 0; j < burst.velocities.length; j += 1) {
      const v = burst.velocities[j];
      v.y -= 9.8 * dt;
      attr.setXYZ(
        j,
        attr.getX(j) + v.x * dt,
        Math.max(0.05, attr.getY(j) + v.y * dt),
        attr.getZ(j) + v.z * dt
      );
    }
    attr.needsUpdate = true;
    burst.points.material.opacity = 1 - p;
  }
}

function clearHitBursts() {
  while (hitBursts.length) {
    const burst = hitBursts.pop();
    if (burst.points.parent) burst.points.parent.remove(burst.points);
    burst.points.geometry.dispose();
    burst.points.material.dispose();
  }
}

/* ---------- Jugador ---------- */

function syncHpHud() {
  if (!arena || !arena.player) return;
  const p = arena.player;
  const pct = Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100));
  if (pct === lastHpShown) return;
  lastHpShown = pct;
  const fill = document.getElementById('hud-hp-fill');
  if (fill) {
    fill.style.width = pct + '%';
    const bar = fill.closest('.hp-bar');
    if (bar) bar.setAttribute('aria-valuenow', String(Math.round(pct)));
  }
}

function spawnPlayer() {
  if (!arena) return;
  removeEnemies();
  removePlayer();
  Combat.clearFloaters();
  clearHitBursts();
  arena.player = createPlayer(selectedHeroId, arena.scene, arena);
  window.__player = arena.player; // depuración
  lastHpShown = -1;
  syncHpHud();
  Combat.setSpecialHudName(arena.player.hero);
  Combat.updateSpecialHud(arena.player, playTime);
  // Cámara detrás del jugador desde el primer frame
  updateCamera(0, arena.camera, arena.player, arena, true);
  if (DEBUG_DUMMIES) spawnDebugDummies();
  else startWave(1); // Hordas: la partida arranca con la oleada 1
  const s = arena.player.hero.stats;
  console.log('Héroe listo: ' + arena.player.hero.name + ' — HP ' + arena.player.hp +
    ', velocidad ' + s.speed + ', daño ' + s.damage + ', alcance ' + s.range);
}

function removePlayer() {
  if (arena && arena.player) {
    arena.scene.remove(arena.player.group);
    arena.player = null;
    window.__player = null;
  }
}

function resizeArena() {
  if (!arena) return;
  const canvas = arena.renderer.domElement;
  const parent = canvas.parentElement;
  const w = parent ? parent.clientWidth : window.innerWidth;
  const h = parent ? parent.clientHeight : window.innerHeight;
  arena.renderer.setSize(w, h, false);
  arena.camera.aspect = w / Math.max(h, 1);
  arena.camera.updateProjectionMatrix();
}

function animateArena() {
  arena.rafId = requestAnimationFrame(animateArena);
  // Consumir el delta cada frame (evita un salto al reanudar tras la pausa),
  // pero el reloj de JUEGO sólo avanza en PLAY: en PAUSE cooldowns y ventana
  // de combo quedan completamente congelados.
  const dt = Math.min(arenaClock.getDelta(), 0.05);
  const playing = state === 'PLAY';
  if (playing) playTime += dt;
  const t = playTime;
  window.__playTime = t; // depuración

  if (playing) {
    // Jugador: movimiento WASD relativo a cámara + clamp circular
    if (arena.player) {
      arena.player.update(dt, readPlayerInput(), arena.camera);
      Combat.tickAttackAnim(arena.player, t);
      updateCamera(dt, arena.camera, arena.player, arena, false);
      syncHpHud();
      Combat.updateSpecialHud(arena.player, t);
    }
    Combat.updateFloaters(dt);
    updateHitParticles(dt);

    // Enemigos: IA, separación, limpieza de muertos + spawn escalonado
    if (arena.player) {
      Enemies.updateAll(enemies, dt, arena.player.group.position, t);
    }
    tickWaveSpawning(dt);

    // Llamas: escala y parpadeo del PointLight
    for (const flame of arena.flames) {
      const p = flame.userData.phase || 0;
      flame.scale.y = 1 + Math.sin(t * 11 + p) * 0.28;
      flame.scale.x = flame.scale.z = 1 + Math.cos(t * 9 + p) * 0.14;
      flame.rotation.y += dt * 2.2;
    }
    for (const light of arena.flickerLights) {
      const p = light.userData.phase || 0;
      light.intensity = (light.userData.baseIntensity || 1.9) + Math.sin(t * 13 + p) * 0.35 + Math.sin(t * 29 + p * 2) * 0.12;
    }
  }
  // En PAUSE el update queda congelado: sólo se re-renderiza el fotograma.

  arena.renderer.render(arena.scene, arena.camera);
}

/* ---------- Navegación ---------- */

/** Cambia de pantalla sólo si ui.showScreen acepta el id; devuelve si tuvo éxito. */
function go(screenId, nextState) {
  const ok = ui.showScreen(screenId);
  if (ok) state = nextState;
  return ok;
}

function startGame() {
  ui.resetHud();
  go('hud', 'PLAY');
  startArena();
  spawnPlayer();
}

/* ---------- Cableado de eventos ---------- */

function bindUI() {
  // Título → Modo
  document.getElementById('btn-play').addEventListener('click', () => go('mode', 'MODE'));

  // Modo → Héroe (sólo el modo habilitado; los deshabilitados llevan disabled + tooltip)
  document.querySelectorAll('#screen-mode .mode-card:not(.disabled)').forEach((btn) => {
    btn.addEventListener('click', () => go('hero', 'HERO'));
  });

  // Héroe: selección de tarjeta
  const heroWrap = document.getElementById('hero-cards');
  heroWrap.addEventListener('click', (event) => {
    const card = event.target.closest('.hero-card');
    if (!card) return;
    selectedHeroId = card.dataset.heroId;
    ui.selectHeroCard(selectedHeroId);
  });
  document.getElementById('btn-hero-continue').addEventListener('click', () => go('map', 'MAP'));

  // Mapa → Juego (sólo Coliseo está habilitado por ahora)
  document.querySelectorAll('#screen-map .map-card:not(.disabled)').forEach((btn) => {
    btn.addEventListener('click', () => startGame());
  });

  // Botones "Volver" genéricos: data-back="<pantalla destino>"
  const backTargets = { title: 'TITLE', mode: 'MODE', hero: 'HERO', map: 'MAP' };
  document.querySelectorAll('[data-back]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dest = btn.dataset.back;
      go(dest, backTargets[dest] || 'TITLE');
    });
  });

  // HUD → volver al título
  document.getElementById('btn-hud-back').addEventListener('click', () => { stopArena(); go('title', 'TITLE'); });

  // Pausa
  document.getElementById('btn-resume').addEventListener('click', () => go('hud', 'PLAY'));
  document.getElementById('btn-pause-quit').addEventListener('click', () => { stopArena(); go('title', 'TITLE'); });

  // Fin de partida
  document.getElementById('btn-retry').addEventListener('click', () => startGame());
  document.getElementById('btn-gameover-quit').addEventListener('click', () => { stopArena(); go('title', 'TITLE'); });

  // Error fatal → reintentar (recargar)
  document.getElementById('btn-error-retry').addEventListener('click', () => window.location.reload());

  // combat:hit → partículas + damage floater (Task 5)
  window.addEventListener('combat:hit', (event) => {
    const d = event.detail || {};
    const x = Number(d.x) || 0;
    const y = Number(d.y) || 1.4;
    const z = Number(d.z) || 0;
    spawnHitParticles(x, y, z);
    if (arena && arena.scene) {
      Combat.spawnDamageFloater(arena.scene, { x, y, z }, d.damage, { killed: !!d.killed });
    }
  });

  // Clic izquierdo → ataque/combo (sólo en juego y con el jugador vivo)
  const canvas = document.getElementById('game-canvas');
  if (canvas) {
    canvas.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      if (state !== 'PLAY' || !arena || !arena.player || !arena.player.alive) return;
      event.preventDefault();
      Combat.tryAttack(arena.player, enemies, playTime);
    });
  }

  // Movimiento + dash + Esc: pausa / reanudar + Q: especial
  window.addEventListener('keydown', (event) => {
    const code = event.code;
    if (code === 'Escape') {
      if (state === 'PLAY') {
        go('pause', 'PAUSE');
      } else if (state === 'PAUSE') {
        go('hud', 'PLAY');
      }
      return;
    }
    if (code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD' ||
        code === 'ArrowUp' || code === 'ArrowDown' || code === 'ArrowLeft' || code === 'ArrowRight') {
      keys.add(code);
      event.preventDefault();
      return;
    }
    if (code === 'ShiftLeft' || code === 'ShiftRight') {
      if (state === 'PLAY' && arena && arena.player) arena.player.dash();
      return;
    }
    if (code === 'KeyQ') {
      if (state === 'PLAY' && arena && arena.player && arena.player.alive) {
        Combat.trySpecial(arena.player, enemies, playTime);
      }
    }
  });
  window.addEventListener('keyup', (event) => {
    keys.delete(event.code);
  });
  // Evita teclas atascadas al cambiar de ventana/pestaña
  window.addEventListener('blur', () => keys.clear());
}

/* ---------- Arranque ---------- */

function init() {
  if (!checkEngine()) return;
  markEngineReady();

  ui.setHeroCards(HEROES);
  ui.selectHeroCard(selectedHeroId);
  window.__combat = Combat; // depuración
  window.__enemies = enemies;
  // Los ataques enemigos (windup completado) restan HP al jugador con flash rojo
  Enemies.onPlayerDamage((damage) => damagePlayer(damage));
  Object.defineProperty(window, '__waveState', { get: () => waveState }); // depuración
  bindUI();
  go('title', 'TITLE');

  console.log('Oriental Arena Warriors — listo. Three.js r' + THREE.REVISION + ' cargado desde CDN (módulos ES + import map).');
}

init();
