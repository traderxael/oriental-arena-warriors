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

// Expone THREE para consola/depuración y para que checkEngine()
// y el resto del código clásico puedan inspeccionar la versión.
window.THREE = THREE;
// Señal al watchdog inline (non-module) de que el motor cargó.
window.__threeOk = true;

var state = 'TITLE';

const HEROES = [
  {
    id: 'kaito',
    name: 'Kaito',
    epithet: 'El Samurái Errante',
    desc: 'Katana veloz y disciplina de acero. Equilibrio perfecto entre ataque y defensa.',
    kanji: '侍',
    stats: { fuerza: 80, velocidad: 65, defensa: 70 },
  },
  {
    id: 'mei',
    name: 'Mei',
    epithet: 'La Cultivadora del Qi',
    desc: 'Canaliza la energía espiritual en ráfagas devastadoras. Gran reserva de qi.',
    kanji: '氣',
    stats: { fuerza: 60, velocidad: 75, defensa: 55 },
  },
  {
    id: 'takeshi',
    name: 'Takeshi',
    epithet: 'El Monje de los Puños',
    desc: 'Puños y patadas letales forjados en el templo. Un muro que devuelve el golpe.',
    kanji: '拳',
    stats: { fuerza: 70, velocidad: 60, defensa: 90 },
  },
];

let selectedHeroId = HEROES[0].id;

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

let arena = null;        // { scene, camera, renderer, flames, flickerLights, rafId, orbitAngle }
let arenaClock = null;

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
      orbitAngle: 0,
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
  const canvas = document.getElementById('game-canvas');
  if (canvas) canvas.classList.add('hidden');
  const placeholder = document.querySelector('#hud .hud-placeholder');
  if (placeholder) placeholder.classList.remove('hidden');
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
  const dt = arenaClock.getDelta();
  const t = arenaClock.elapsedTime;

  // Cámara orbitando lento alrededor del Coliseo
  arena.orbitAngle += dt * 0.18;
  const orbitR = 29;
  const height = 12;
  arena.camera.position.set(
    orbitR * Math.sin(arena.orbitAngle),
    height,
    orbitR * Math.cos(arena.orbitAngle)
  );
  arena.camera.lookAt(0, 1.5, 0);

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

  // Esc: pausa / reanudar
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (state === 'PLAY') {
      go('pause', 'PAUSE');
    } else if (state === 'PAUSE') {
      go('hud', 'PLAY');
    }
  });
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
