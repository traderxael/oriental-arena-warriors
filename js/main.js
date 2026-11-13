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
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Assets } from './assets.js';
import { Maps } from './maps.js';
import { HEROES } from './heroes.js';
import { createPlayer, updateCamera, orbitCamera, zoomCamera } from './player.js';
import { Combat } from './combat.js';
import { Enemies } from './enemies.js';
import { Modes } from './modes.js';
import { Quality } from './quality.js';
import { VFX } from './vfx.js';
import { Characters } from './characters.js';
import { HeroPreview } from './hero-preview.js';

/* Comprobación defensiva de Audio (js/audio.js, binding léxico global). */
function sfx(name) {
  try {
    if (typeof Audio !== 'undefined' && Audio && typeof Audio.play === 'function') Audio.play(name);
  } catch (_err) { /* silencioso */ }
}

const URL_PARAMS = new URLSearchParams(window.location.search);
// Dummies de prueba (Task 5): sólo con la URL ?debug=dummies. NO es contenido de juego.
const DEBUG_DUMMIES = URL_PARAMS.get('debug') === 'dummies';
// Escenario de estrés (Fase 7): ?debug=stress mantiene 25 enemigos vivos simultáneos.
const DEBUG_STRESS = URL_PARAMS.get('debug') === 'stress';
const AUTOSTART = URL_PARAMS.get('autostart') === '1';

// Expone THREE para consola/depuración y para que checkEngine()
// y el resto del código clásico puedan inspeccionar la versión.
window.THREE = THREE;
// Señal al watchdog inline (non-module) de que el motor cargó.
window.__threeOk = true;

var state = 'TITLE';

let selectedHeroId = HEROES[0].id;
// Modo elegido en la pantalla de modos ('hordas' | 'supervivencia' | 'duelo').
let selectedMode = 'hordas';
let selectedMapId = 'coliseo';

// Reloj de juego (segundos), actualizado cada frame en animateArena.
// Los handlers de ratón/teclado lo usan para `now` (combos, cooldowns).
let playTime = 0;
// Enemigos vivos (los crea js/enemies.js). Array estable: se muta in situ.
const enemies = [];
// Controlador del modo activo (js/modes.js): startHorde/startSurvival/startDuel.
// null cuando no hay partida activa (p. ej. ?debug=dummies).
let mode = null;
// Ráfagas de partículas activas (evento combat:hit)
const hitBursts = [];

// Teclas de movimiento pulsadas (KeyW/A/S/D + flechas). Se traducen a
// booleanos { forward, back, left, right } para player.update(dt, input, camera).
const keys = new Set();
let cameraPointerId = null;

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

/* ---------- Arena 3D: mapa seleccionado ---------- */

let arena = null;        // { scene, camera, renderer, flames, flickerLights, rafId, radius, player }
let arenaClock = null;
let lastHpShown = -1;

/* ---------- Calidad gráfica + postprocesado ---------- */

/** (Re)construye el composer de bloom según el preset activo. */
function rebuildComposer() {
  if (!arena) return;
  const preset = Quality.preset();
  if (arena.composer) {
    arena.composer.dispose();
    arena.composer = null;
  }
  if (!preset.bloom) return;
  const size = new THREE.Vector2();
  arena.renderer.getSize(size);
  const composer = new EffectComposer(arena.renderer);
  composer.setPixelRatio(arena.renderer.getPixelRatio());
  composer.setSize(Math.max(1, size.x), Math.max(1, size.y));
  composer.addPass(new RenderPass(arena.scene, arena.camera));
  const bScale = Number(preset.bloomScale) || 0.5;
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(Math.max(1, Math.floor(size.x * bScale)), Math.max(1, Math.floor(size.y * bScale))),
    0.35,
    0.6,
    0.82
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  arena.composer = composer;
}

/** Aplica el preset de Quality al renderer, sombras, pétalos y composer. */
function applyQuality() {
  if (!arena) return;
  const preset = Quality.preset();
  arena.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio));
  const useShadows = preset.shadows !== false;
  arena.renderer.shadowMap.enabled = useShadows;
  arena.renderer.shadowMap.needsUpdate = true;
  if (arena.sun) {
    arena.sun.castShadow = useShadows;
    arena.sun.shadow.mapSize.set(preset.shadow, preset.shadow);
    if (arena.sun.shadow.map) {
      arena.sun.shadow.map.dispose();
      arena.sun.shadow.map = null;
    }
  }
  VFX.setPetals(preset.petals);
  rebuildComposer();
  resizeArena();
  const select = document.getElementById('select-quality');
  if (select && select.value !== Quality.level) select.value = Quality.level;
}

function startArena() {
  const canvas = document.getElementById('game-canvas');
  if (!canvas) return;

  if (!arena) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.info.autoReset = false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
    arena = {
      scene,
      camera,
      renderer,
      map: null,
      mapId: null,
      flames: [],
      flickerLights: [],
      bounds: null,
      spawnPoints: [],
      obstacles: [],
      sun: null,
      radius: 38,
      rafId: null,
      player: null,
      composer: null,
    };
    window.__arena = arena;
    VFX.init(scene);
    Quality.onChange(() => applyQuality());
    window.addEventListener('resize', resizeArena);
  }

  if (arena.map && arena.mapId !== selectedMapId) {
    VFX.setPetals(0);
    VFX.clearTransient();
    Maps.dispose(arena.scene, arena.map);
    arena.map = null;
  }
  if (!arena.map) {
    const built = Maps.build(selectedMapId, arena.scene, arena.renderer);
    arena.map = built;
    arena.mapId = selectedMapId;
    arena.flames = built.flames;
    arena.flickerLights = built.flickerLights;
    arena.bounds = built.bounds;
    arena.spawnPoints = built.spawnPoints;
    arena.obstacles = built.obstacles;
    arena.sun = built.sun;
    arena.radius = built.radius;
    window.__arena = arena;
    VFX.init(arena.scene);
    applyQuality();
    console.log(built.name + ' construido. Radio: ' + arena.radius + ' - spawns: ' + arena.spawnPoints.length);
  }

  resizeArena();
  canvas.classList.remove('hidden');
  const placeholder = document.querySelector('#hud .hud-placeholder');
  if (placeholder) placeholder.classList.add('hidden');

  arenaClock = new THREE.Clock();
  playTime = 0;
  if (arena.rafId) cancelAnimationFrame(arena.rafId);
  animateArena();
}

function stopArena() {
  if (arena && arena.rafId) {
    cancelAnimationFrame(arena.rafId);
    arena.rafId = null;
  }
  if (mode && typeof mode.dispose === 'function') mode.dispose();
  mode = null;
  removeEnemies();
  Combat.clearFloaters();
  clearHitBursts();
  VFX.clearTransient();
  removePlayer();
  const canvas = document.getElementById('game-canvas');
  if (canvas) {
    if (cameraPointerId !== null && canvas.hasPointerCapture(cameraPointerId)) {
      canvas.releasePointerCapture(cameraPointerId);
    }
    cameraPointerId = null;
    canvas.classList.remove('camera-looking');
    canvas.classList.add('hidden');
  }
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
  enemies.length = 0; // array estable: los controladores guardan la referencia
  Enemies.clearCorpses();
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

const STRESS_ROSTER = [
  'ronin', 'ronin', 'ronin', 'ronin', 'ronin', 'ronin', 'ronin', 'ronin', 'ronin', 'ronin',
  'bandido', 'bandido', 'bandido', 'bandido', 'bandido', 'bandido', 'bandido', 'bandido',
  'lancero', 'lancero', 'lancero', 'lancero', 'lancero', 'lancero',
  'brute',
];

let stressPrewarmed = false;
let stressPrewarming = false;

function topUpStressEnemies() {
  if (!arena) return;
  if (!stressPrewarmed) {
    if (!stressPrewarming) {
      stressPrewarming = true;
      const heroPath = 'assets/characters/' + (selectedHeroId === 'goro' ? 'goro' : 'akane') + '.glb';
      Promise.all([
        Assets.loadGLTF(heroPath, () => new THREE.Group()),
        Assets.loadGLTF('assets/characters/ashigaru.glb', () => new THREE.Group()),
        Assets.loadGLTF('assets/characters/oni.glb', () => new THREE.Group()),
      ]).then(() => {
        stressPrewarmed = true;
        topUpStressEnemies();
      });
    }
    return;
  }
  let idx = enemies.length;
  while (enemies.length < 25) {
    const type = STRESS_ROSTER[idx % STRESS_ROSTER.length];
    const e = Enemies.spawn(type, 5, arena, arena.scene);
    const ring = 9 + (idx % 4) * 5.5;
    const ang = (idx / 25) * Math.PI * 2;
    e.group.position.set(Math.cos(ang) * ring, 0, Math.sin(ang) * ring);
    enemies.push(e);
    idx += 1;
  }
  window.__enemies = enemies;
}

/* ---------- Oleadas: lógica absorbida por Modes.startHorde (js/modes.js) ---------- */

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
  sfx('hurt');
  flashDamageVignette();
  VFX.addShake(0.15);
  lastHpShown = -1;
  syncHpHud();
  if (p.hp <= 0) {
    p.alive = false;
    if (state === 'PLAY') {
      // Fin de partida: el modo muestra el game over y congela la partida
      const stats = mode ? mode.gameOver() : null;
      state = 'GAMEOVER';
      if (!stats) {
        // Modo no disponible (p. ej. ?debug=dummies): pantalla básica de fin
        sfx('gameOver');
        ui.showScreen('gameover');
      }
      // Congelar y desmontar la arena: la pantalla de game over es opaca y
      // no hay motivo para seguir renderizando detrás de ella.
      stopArena();
      console.log('El jugador ha caído en la arena (oleada ' + (stats ? stats.wave : '?') + ').');
    }
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
  const curHp = Math.max(0, Math.ceil(p.hp));
  const pct = Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100));
  if (curHp === lastHpShown) return;
  lastHpShown = curHp;
  const hudHp = document.getElementById('hud-hp');
  if (hudHp) {
    hudHp.setAttribute('aria-valuenow', String(Math.round(pct)));
    hudHp.classList.toggle('low-hp', pct > 0 && pct <= 30);
  }
  const fill = document.getElementById('hud-hp-fill');
  if (fill) fill.style.width = pct + '%';
  const text = document.getElementById('hud-hp-text');
  if (text) text.textContent = curHp + ' / ' + p.maxHp;
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
  if (DEBUG_DUMMIES) {
    mode = null; // los dummies son un objetivo de pruebas: sin modo activo
    spawnDebugDummies();
  } else if (DEBUG_STRESS) {
    mode = null;
    arena.player.maxHp = 999999;
    arena.player.hp = 999999;
    lastHpShown = -1;
    syncHpHud();
    topUpStressEnemies();
    console.log('Modo estrés activo (?debug=stress): 25 enemigos simultáneos.');
  } else {
    // El modo arranca la partida (Hordas: oleada 1; Supervivencia: timer +
    // orbes; Duelo: el maestro). onEnd lo usa Duelo al ganar para congelar.
    const ctx = {
      getArena: () => arena,
      getPlayer: () => (arena && arena.player) || null,
      enemies,
      onEnd: () => {
        if (state !== 'PLAY') return;
        state = 'GAMEOVER';
        stopArena();
      },
    };
    if (selectedMode === 'supervivencia') mode = Modes.startSurvival(ctx);
    else if (selectedMode === 'duelo') mode = Modes.startDuel(ctx);
    else mode = Modes.startHorde(ctx);
  }
  const s = arena.player.hero.stats;
  console.log('Héroe listo: ' + arena.player.hero.name + ' — HP ' + arena.player.hp +
    ', velocidad ' + s.speed + ', daño ' + s.damage + ', alcance ' + s.range);
}

function removePlayer() {
  if (arena && arena.player) {
    if (typeof arena.player.dispose === 'function') {
      arena.player.dispose();
    } else {
      Assets.disposeObject(arena.player.group);
    }
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
  if (arena.composer) {
    arena.composer.setPixelRatio(arena.renderer.getPixelRatio());
    arena.composer.setSize(w, h);
  }
}

/* ---------- Sonda de rendimiento (window.__perf) + auto-guard ---------- */

const perfWindow = [];   // [{ tMs, dtMs }] últimos 1000 ms
const guardWindow = [];  // últimos 120 dtMs en PLAY (tras warmup)
let prevPerfNow = 0;
let lastTexScanAt = -Infinity;
let cachedTextureMB = 0;
let autoDowngrades = 0;

function estimateDecodedTextureMB(scene) {
  if (!scene) return 0;
  const seen = new Set();
  let bytes = 0;
  const addTex = (tex) => {
    if (!tex || !tex.isTexture) return;
    const src = tex.source;
    const id = (src && src.uuid) || tex.uuid;
    if (seen.has(id)) return;
    seen.add(id);
    const img = (src && src.data) || tex.image;
    const w = Number(img && (img.width || img.videoWidth)) || 0;
    const h = Number(img && (img.height || img.videoHeight)) || 0;
    if (w > 0 && h > 0) bytes += w * h * 4;
  };
  addTex(scene.environment);
  addTex(scene.background);
  scene.traverse((node) => {
    if (!node || !node.material) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    for (const m of mats) {
      if (!m) continue;
      for (const k of Object.keys(m)) {
        const v = m[k];
        if (v && v.isTexture) addTex(v);
      }
    }
  });
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

function recordPerfFrame(playing) {
  const nowMs = performance.now();
  const dtMs = prevPerfNow > 0 ? Math.min(nowMs - prevPerfNow, 1000) : 16.67;
  prevPerfNow = nowMs;

  perfWindow.push({ tMs: nowMs, dtMs });
  const cutoff = nowMs - 1000;
  while (perfWindow.length > 1 && perfWindow[0].tMs < cutoff) {
    perfWindow.shift();
  }

  if (playing && playTime >= 1.5) {
    guardWindow.push(dtMs);
    if (guardWindow.length > 120) guardWindow.shift();
    const shouldDrop = window.Logic && typeof window.Logic.shouldDowngradeQuality === 'function'
      ? window.Logic.shouldDowngradeQuality(guardWindow, 33, 120)
      : false;
    if (!Quality.lockedByUrl && shouldDrop) {
      if (Quality.downgrade()) {
        autoDowngrades += 1;
        guardWindow.length = 0;
        console.info('Quality auto-guard: calidad reducida automáticamente a "' + Quality.level + '".');
      } else {
        guardWindow.length = 0;
      }
    }
  }

  if (arena && nowMs - lastTexScanAt >= 1000) {
    lastTexScanAt = nowMs;
    cachedTextureMB = estimateDecodedTextureMB(arena.scene);
  }

  const msList = perfWindow.map((s) => s.dtMs);
  const stats = window.Logic && typeof window.Logic.computePerfStats === 'function'
    ? window.Logic.computePerfStats(msList)
    : { fps: 0, avgMs: 0, p95: 0 };
  const rInfo = arena ? arena.renderer.info.render : { calls: 0, triangles: 0 };
  const mInfo = arena ? arena.renderer.info.memory : { geometries: 0, textures: 0 };

  window.__perf = {
    fps: stats.fps,
    avgMs: stats.avgMs,
    p95: stats.p95,
    calls: rInfo.calls,
    triangles: rInfo.triangles,
    memory: {
      geometries: mInfo.geometries,
      textures: mInfo.textures,
      textureMB: cachedTextureMB,
    },
    mixers: Characters.activeMixerCount(),
    enemies: enemies.length,
    quality: Quality.level,
    autoDowngrades,
  };
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
      VFX.applyShake(arena.camera, dt);
      syncHpHud();
      Combat.updateSpecialHud(arena.player, t);
    }
    Combat.updateFloaters(dt);
    updateHitParticles(dt);
    VFX.update(dt, t);

    // Enemigos: IA, separación, limpieza de muertos + spawn escalonado
    if (arena.player) {
      Enemies.updateAll(enemies, dt, arena.player.group.position, t, arena.player);
    }
    if (DEBUG_STRESS) topUpStressEnemies();
    if (mode) mode.update(dt);

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

  arena.renderer.info.reset();
  if (arena.composer) {
    arena.composer.render();
  } else {
    arena.renderer.render(arena.scene, arena.camera);
  }
  recordPerfFrame(playing);
}

/* ---------- Navegación ---------- */

/** Cambia de pantalla sólo si ui.showScreen acepta el id; devuelve si tuvo éxito. */
function go(screenId, nextState) {
  const ok = ui.showScreen(screenId);
  if (ok) {
    state = nextState;
    if (screenId === 'hero') {
      HeroPreview.mount(document.getElementById('hero-preview-viewport'), selectedHeroId);
    } else {
      HeroPreview.unmount();
    }
  }
  return ok;
}

function startGame() {
  ui.resetHud();
  ui.setHudMode(selectedMode);
  const mapLabel = document.getElementById('hud-map');
  if (mapLabel) mapLabel.textContent = Maps.getName(selectedMapId);
  go('hud', 'PLAY');
  startArena();
  spawnPlayer();
}

/* ---------- Cableado de eventos ---------- */

function bindUI() {
  // Clic de UI en cualquier botón (delegado: cubre botones dinámicos como las tarjetas de héroe)
  document.addEventListener('click', (event) => {
    const btn = event.target && typeof event.target.closest === 'function' ? event.target.closest('button') : null;
    if (btn) sfx('uiClick');
  });

  // Título → Modo
  document.getElementById('btn-play').addEventListener('click', () => go('mode', 'MODE'));

  // Modo → Héroe (guarda el modo elegido; los deshabilitados llevan disabled + tooltip)
  document.querySelectorAll('#screen-mode .mode-card:not(.disabled)').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedMode = btn.dataset.mode || 'hordas';
      go('hero', 'HERO');
    });
  });

  // Héroe: selección de tarjeta
  const heroWrap = document.getElementById('hero-cards');
  heroWrap.addEventListener('click', (event) => {
    const card = event.target.closest('.hero-card');
    if (!card) return;
    selectedHeroId = card.dataset.heroId;
    ui.selectHeroCard(selectedHeroId);
    HeroPreview.setHero(selectedHeroId);
  });
  document.getElementById('btn-hero-continue').addEventListener('click', () => go('map', 'MAP'));

  // Mapa → Juego
  document.querySelectorAll('#screen-map .map-card:not(.disabled)').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedMapId = btn.dataset.map || 'coliseo';
      startGame();
    });
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

  // Calidad gráfica (persistente en localStorage; ?quality= tiene prioridad)
  const qualitySelect = document.getElementById('select-quality');
  if (qualitySelect) {
    qualitySelect.value = Quality.level;
    qualitySelect.addEventListener('change', () => Quality.set(qualitySelect.value));
  }

  // Botón global de silencio (master-gain en Audio)
  const muteBtn = document.getElementById('btn-mute');
  if (muteBtn) {
    const syncMuteBtn = () => {
      const muted = typeof Audio !== 'undefined' && Audio && typeof Audio.isMuted === 'function' ? Audio.isMuted() : false;
      muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
      muteBtn.classList.toggle('muted', muted);
      const label = muted ? 'Activar audio' : 'Silenciar audio';
      muteBtn.title = label;
      muteBtn.setAttribute('aria-label', label);
      const icon = document.getElementById('mute-icon');
      const text = document.getElementById('mute-label');
      if (icon) icon.textContent = muted ? '静' : '音';
      if (text) text.textContent = muted ? 'Silencio' : 'Sonido';
    };
    syncMuteBtn();
    muteBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (typeof Audio !== 'undefined' && Audio && typeof Audio.setMuted === 'function') {
        const next = !Audio.isMuted();
        Audio.setMuted(next);
        if (!next) sfx('uiClick');
      }
      syncMuteBtn();
    });
  }

  // Fin de partida
  document.getElementById('btn-retry').addEventListener('click', () => startGame());
  document.getElementById('btn-gameover-quit').addEventListener('click', () => { stopArena(); go('title', 'TITLE'); });

  // Error fatal → reintentar (recargar)
  document.getElementById('btn-error-retry').addEventListener('click', () => window.location.reload());

  // combat:hit → partículas + damage floater (Task 5) + conteo de kills (modo activo)
  window.addEventListener('combat:hit', (event) => {
    const d = event.detail || {};
    if (d.killed && mode) mode.registerKill();
    const x = Number(d.x) || 0;
    const y = Number(d.y) || 1.4;
    const z = Number(d.z) || 0;
    spawnHitParticles(x, y, z);
    if (d.killed) {
      spawnHitParticles(x, y + 0.3, z); // brasas extra al morir
      VFX.addShake(0.08);
    }
    if (arena && arena.scene) {
      Combat.spawnDamageFloater(arena.scene, { x, y, z }, d.damage, { killed: !!d.killed });
    }
  });

  // Clic izquierdo → ataque/combo (sólo en juego y con el jugador vivo)
  const canvas = document.getElementById('game-canvas');
  if (canvas) {
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 2 || state !== 'PLAY' || !arena || !arena.player || !arena.player.alive) return;
      event.preventDefault();
      cameraPointerId = event.pointerId;
      canvas.classList.add('camera-looking');
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (event.pointerId !== cameraPointerId || state !== 'PLAY' || !arena || !arena.player) return;
      orbitCamera(arena.player, event.movementX, event.movementY);
    });
    const endCameraDrag = (event) => {
      if (event.pointerId !== cameraPointerId) return;
      cameraPointerId = null;
      canvas.classList.remove('camera-looking');
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener('pointerup', endCameraDrag);
    canvas.addEventListener('pointercancel', endCameraDrag);
    canvas.addEventListener('lostpointercapture', (event) => {
      if (event.pointerId === cameraPointerId) {
        cameraPointerId = null;
        canvas.classList.remove('camera-looking');
      }
    });
    canvas.addEventListener('contextmenu', (event) => {
      if (state === 'PLAY') event.preventDefault();
    });
    canvas.addEventListener('wheel', (event) => {
      if (state !== 'PLAY' || !arena || !arena.player || !arena.player.alive) return;
      event.preventDefault();
      zoomCamera(arena.player, event.deltaY);
    }, { passive: false });
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
      if (state === 'PLAY' && arena && arena.player && arena.player.dash()) {
        sfx('dash');
        VFX.dashTrail(arena.player.group.position, arena.player.dashDir);
      }
      return;
    }
    if (code === 'KeyQ') {
      if (state === 'PLAY' && arena && arena.player && arena.player.alive) {
        if (Combat.trySpecial(arena.player, enemies, playTime)) VFX.addShake(0.25);
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
  Object.defineProperty(window, '__modeState', { get: () => (mode ? mode.state() : null) }); // depuración
  bindUI();
  if (AUTOSTART) {
    startGame();
  } else {
    go('title', 'TITLE');
  }

  console.log('Oriental Arena Warriors — listo. Three.js r' + THREE.REVISION + ' cargado desde CDN (módulos ES + import map).');
}

init();
