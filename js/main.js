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

// Expone THREE para consola/depuración y para que checkEngine()
// y el resto del código clásico puedan inspeccionar la versión.
window.THREE = THREE;
// Señal al watchdog inline (non-module) de que el motor cargó.
window.__threeOk = true;

var state = 'TITLE';

let selectedHeroId = HEROES[0].id;

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
  removePlayer();
  const canvas = document.getElementById('game-canvas');
  if (canvas) canvas.classList.add('hidden');
  const placeholder = document.querySelector('#hud .hud-placeholder');
  if (placeholder) placeholder.classList.remove('hidden');
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
  removePlayer();
  arena.player = createPlayer(selectedHeroId, arena.scene, arena);
  window.__player = arena.player; // depuración
  lastHpShown = -1;
  syncHpHud();
  // Cámara detrás del jugador desde el primer frame
  updateCamera(0, arena.camera, arena.player, arena, true);
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
  const dt = Math.min(arenaClock.getDelta(), 0.05);
  const t = arenaClock.elapsedTime;
  const playing = state === 'PLAY';

  if (playing) {
    // Jugador: movimiento WASD relativo a cámara + clamp circular
    if (arena.player) {
      arena.player.update(dt, readPlayerInput(), arena.camera);
      updateCamera(dt, arena.camera, arena.player, arena, false);
      syncHpHud();
    }

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

  // Movimiento + dash + Esc: pausa / reanudar
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
  bindUI();
  go('title', 'TITLE');

  console.log('Oriental Arena Warriors — listo. Three.js r' + THREE.REVISION + ' cargado desde CDN (módulos ES + import map).');
}

init();
