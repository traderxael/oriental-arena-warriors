/* ============================================================
   main.js — Máquina de estados y arranque del juego
   Estados (global `state`):
     TITLE | MODE | HERO | MAP | PLAY | PAUSE | GAMEOVER
   La navegación entre pantallas se hace siempre vía ui.showScreen(id).
   ============================================================ */

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
  const box = document.getElementById('webgl-error');
  const detailEl = document.getElementById('webgl-error-detail');
  if (detailEl && detail) detailEl.textContent = detail;
  if (box) box.classList.remove('hidden');
  const app = document.getElementById('app');
  if (app) app.classList.add('hidden');
}

function checkEngine() {
  // 1) ¿Cargó el script de Three.js desde la CDN?
  if (window.__threeLoadFailed || typeof window.THREE === 'undefined') {
    showFatalError('No se pudo cargar el motor 3D desde la red (CDN de Three.js). Revisa tu conexión a internet y recarga la página.');
    return false;
  }
  // 2) ¿Versión desalineada con la fijada en index.html?
  if (window.THREE.REVISION !== '160') {
    showFatalError('No se pudo cargar el motor 3D: se esperaba Three.js r160 y se cargó r' + window.THREE.REVISION + '. Recarga la página o avisa al equipo.');
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

/* ---------- Navegación ---------- */

function go(screenId, nextState) {
  state = nextState;
  ui.showScreen(screenId);
}

function startGame() {
  ui.resetHud();
  go('hud', 'PLAY');
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
  document.getElementById('btn-hud-back').addEventListener('click', () => go('title', 'TITLE'));

  // Pausa
  document.getElementById('btn-resume').addEventListener('click', () => go('hud', 'PLAY'));
  document.getElementById('btn-pause-quit').addEventListener('click', () => go('title', 'TITLE'));

  // Fin de partida
  document.getElementById('btn-retry').addEventListener('click', () => startGame());
  document.getElementById('btn-gameover-quit').addEventListener('click', () => go('title', 'TITLE'));

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

  ui.setHeroCards(HEROES);
  ui.selectHeroCard(selectedHeroId);
  bindUI();
  go('title', 'TITLE');

  console.log('Oriental Arena Warriors — listo. Three.js r' + window.THREE.REVISION + ' cargado desde CDN.');
}

init();
