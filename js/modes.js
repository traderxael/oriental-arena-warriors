/* ============================================================
   modes.js — Modos de juego. Por ahora: Hordas Infinitas (Task 7).

   Modes.startHorde(ctx) arranca una partida de Hordas y devuelve un
   controlador con la única máquina de estados de oleadas del juego:

     spawning   → hay enemigos en cola; salen cada 0.8 s respetando maxAlive.
     active     → cola agotada; quedan enemigos por derrotar.
     intermission → arena despejada; respiro de 3 s y banner "OLEADA N+1".
     over       → el jugador ha caído; la oleada NO avanza más.

   ctx (lo provee main.js):
     getArena()   — arena 3D ({ scene, spawnPoints, radius, player }) o null.
     getPlayer()  — jugador actual ({ hp, alive }) o null.
     enemies      — array ESTABLE (se muta in situ, nunca se reasigna).

   El controlador (devuelto):
     update(dt)   — avanza spawns/intermedios; llamar sólo en PLAY.
     registerKill() — +1 kill y recalcula el score en vivo (evento combat:hit).
     gameOver()   — fin de partida: stats + récord (writeBest) + ui.showGameOver.
     state()      — copia del estado interno (depuración).

   Score en vivo: Logic.scoreFor(oleada, kills, segundos). El mejor se
   persiste con Logic.readBest/writeBest (clave `oaw_best`, encapsulada
   en logic.js). Si localStorage no está disponible (incógnito), readBest
   devuelve 0 y writeBest no hace nada: la partida nunca se rompe y la
   pantalla de fin muestra "Mejor: —" cuando no hay récord.
   ============================================================ */
import { Enemies } from './enemies.js';

const SPAWN_INTERVAL = 0.8;    // s entre apariciones dentro de una oleada
const WAVE_CLEAR_DELAY = 3;    // s de respiro antes de la siguiente oleada
const RETRY_DELAY = 0.25;      // s de espera cuando maxAlive impide spawnear
const MAX_ALIVE_CAP = 25;      // límite global de enemigos vivos simultáneos

export const Modes = { startHorde };

/* Acceso seguro a localStorage: en incógnito el mero acceso puede lanzar. */
function safeStorage() {
  try {
    const s = window.localStorage;
    // Tocar un método fuerza el SecurityError si está bloqueado
    const probe = s.getItem('__oaw_probe__');
    void probe;
    return s;
  } catch (_err) {
    return null;
  }
}

function setHudText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function formatTime(totalSeconds) {
  const t = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function startHorde(ctx) {
  const Logic = typeof window !== 'undefined' ? window.Logic : null;
  // ui.js declara `const ui` (binding léxico global, no window.ui): resolver así
  const uiRef = typeof ui !== 'undefined' ? ui : null;
  const enemies = (ctx && Array.isArray(ctx.enemies)) ? ctx.enemies : [];
  const getArena = (ctx && ctx.getArena) || (() => null);
  const getPlayer = (ctx && ctx.getPlayer) || (() => null);

  const horde = {
    phase: 'spawning',   // spawning | active | intermission | over
    wave: 0,
    kills: 0,
    elapsed: 0,          // segundos de JUEGO (no avanza en pausa ni tras morir)
    score: 0,
    queue: [],
    spawnTimer: 0,
    spawnedAll: true,
    intermissionTimer: 0,
    maxAlive: 8,
    over: false,
  };

  function computeScore() {
    if (Logic && typeof Logic.scoreFor === 'function') {
      return Logic.scoreFor(horde.wave, horde.kills, horde.elapsed);
    }
    return horde.kills * 10 + horde.wave * 50 + Math.floor(horde.elapsed);
  }

  function syncScoreHud() {
    horde.score = computeScore();
    setHudText('hud-score', String(horde.score));
  }

  function compositionOf(wave) {
    if (Logic && typeof Logic.waveComposition === 'function') {
      return Logic.waveComposition(wave);
    }
    return { ronin: 3, bandido: 0, lancero: 0, brute: 0, maxAlive: 8 };
  }

  function beginWave(n) {
    const comp = compositionOf(n);
    const queue = [];
    // Todos los tipos prometidos por waveComposition tienen builder (Task 7).
    for (const type of ['ronin', 'bandido', 'lancero', 'brute']) {
      const count = Math.max(0, Number(comp[type]) || 0);
      for (let i = 0; i < count; i += 1) queue.push(type);
    }
    // Mezcla aleatoria para que no salgan en bloques por tipo
    for (let i = queue.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = queue[i];
      queue[i] = queue[j];
      queue[j] = tmp;
    }
    horde.wave = n;
    horde.queue = queue;
    horde.spawnTimer = 0; // primer enemigo inmediato
    horde.spawnedAll = queue.length === 0;
    horde.intermissionTimer = 0;
    horde.maxAlive = Math.min(Number(comp.maxAlive) || 8, MAX_ALIVE_CAP);
    horde.phase = queue.length ? 'spawning' : 'active';
    setHudText('hud-wave', String(n));
    if (uiRef && typeof uiRef.showBanner === 'function') uiRef.showBanner('OLEADA ' + n);
    console.log('Oleada ' + n + ': ' + (comp.ronin || 0) + ' ronin, ' + (comp.bandido || 0) +
      ' bandido, ' + (comp.lancero || 0) + ' lancero, ' + (comp.brute || 0) +
      ' brute — maxAlive ' + horde.maxAlive);
  }

  function registerKill() {
    if (horde.over) return;
    horde.kills += 1;
    syncScoreHud();
  }

  function update(dt) {
    if (horde.over) return;
    const player = getPlayer();
    // Oleadas NO avanzan con el jugador muerto: manda el game over.
    if (!player || !player.alive) return;
    if (!(dt > 0)) return;

    horde.elapsed += dt;
    syncScoreHud();
    setHudText('hud-timer', formatTime(horde.elapsed));

    const arena = getArena();
    if (!arena) return;

    if (horde.queue.length) {
      horde.spawnTimer -= dt;
      if (horde.spawnTimer <= 0) {
        if (enemies.length < horde.maxAlive) {
          const type = horde.queue.shift();
          enemies.push(Enemies.spawn(type, horde.wave, arena, arena.scene));
          window.__enemies = enemies;
          horde.spawnTimer = SPAWN_INTERVAL;
        } else {
          horde.spawnTimer = RETRY_DELAY; // oleada llena: reintentar pronto
        }
        if (!horde.queue.length) {
          horde.spawnedAll = true;
          horde.phase = 'active';
        }
      }
      return;
    }

    if (horde.spawnedAll && enemies.length === 0) {
      if (horde.phase !== 'intermission') {
        horde.phase = 'intermission';
        horde.intermissionTimer = WAVE_CLEAR_DELAY;
      } else {
        horde.intermissionTimer -= dt;
        if (horde.intermissionTimer <= 0) beginWave(horde.wave + 1);
      }
    }
  }

  /** Fin de partida: puntúa, persiste el récord y muestra la pantalla de game over. */
  function gameOver() {
    if (horde.over) return null;
    horde.over = true;
    horde.phase = 'over';

    const time = Math.floor(horde.elapsed);
    const score = computeScore();
    const storage = safeStorage(); // null si localStorage está bloqueado (incógnito)
    let prevBest = 0;
    let canPersist = storage !== null;
    if (canPersist) {
      try {
        prevBest = Logic && typeof Logic.readBest === 'function' ? Logic.readBest(storage) : 0;
      } catch (_err) {
        prevBest = 0;
        canPersist = false;
      }
    }
    // Sin storage no hay récord que batir ni mostrar: mejor '—' y sin badge
    const isRecord = canPersist && score > prevBest;
    const best = canPersist ? Math.max(prevBest, score) : 0;
    if (isRecord) {
      try {
        if (Logic && typeof Logic.writeBest === 'function') Logic.writeBest(storage, score);
      } catch (_err) { canPersist = false; /* storage bloqueado a medias */ }
    }
    const stats = {
      wave: horde.wave,
      kills: horde.kills,
      time,
      score,
      best,
      isRecord,
      hasBest: best > 0,
    };
    if (uiRef && typeof uiRef.showGameOver === 'function') {
      uiRef.showGameOver(stats);
    } else {
      console.warn('ui.showGameOver no está disponible; stats:', stats);
    }
    console.log('Fin de la partida — oleada ' + stats.wave + ', kills ' + stats.kills +
      ', tiempo ' + formatTime(time) + ', puntos ' + stats.score +
      (isRecord ? ' ¡NUEVO RÉCORD!' : (stats.hasBest ? ' (mejor: ' + stats.best + ')' : ' (sin récord guardado)')));
    return stats;
  }

  // La partida arranca inmediatamente con la oleada 1.
  beginWave(1);

  return {
    update,
    registerKill,
    gameOver,
    /** Copia del estado para depuración (consola / window.__hordeState). */
    state() {
      return {
        wave: horde.wave,
        kills: horde.kills,
        elapsed: horde.elapsed,
        score: horde.score,
        phase: horde.phase,
        queue: horde.queue.length,
        maxAlive: horde.maxAlive,
      };
    },
  };
}
