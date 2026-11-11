/* ============================================================
   modes.js — Modos de juego: Hordas, Supervivencia y Duelo.

   Los tres arrancadores devuelven el MISMO contrato de controlador:
     update(dt)     — avanza el modo; llamar sólo en PLAY.
     registerKill() — +1 kill y recalcula el score en vivo (combat:hit).
     gameOver(won)  — fin de partida: stats + récord + ui.showGameOver.
                      `won` sólo lo usa Duelo (victoria al derrotar al
                      maestro); Hordas/Supervivencia lo ignoran.
     state()        — copia del estado interno (depuración).
     dispose()      — limpieza al desmontar la arena (orbes, HUD, buffs).

   ctx (lo provee main.js):
     getArena()   — arena 3D ({ scene, spawnPoints, radius, obstacles, player }) o null.
     getPlayer()  — jugador actual ({ hp, maxHp, alive, group, damageMult, speedMult }) o null.
     enemies      — array ESTABLE (se muta in situ, nunca se reasigna).
     onEnd(stats) — opcional; Duelo lo llama al ganar para que main.js
                    pase a GAMEOVER y desmonte la arena (la derrota ya
                    la gestiona main.js vía damagePlayer → gameOver()).

   Hordas (startHorde): máquina de oleadas por despeje.
     spawning → active → intermission (3 s) → siguiente oleada; over al caer.
   Supervivencia (startSurvival): oleadas por TIEMPO (cada 40 s, sin gate
     de despeje), spawns continuos hasta maxAlive creciente y orbes de
     poder cada 12 s (curación +25 / daño ×1.5 10 s / velocidad ×1.25 8 s).
   Duelo (startDuel): un único maestro (Enemies.spawn('maestro')) con IA
     de orbitar/esquivar/giro; gana quien vacíe la vida del otro.

   Récords por modo con Logic.readBest/writeBest(storage, value, key):
     oaw_best (hordas) · oaw_best_survival · oaw_best_duel.
   Si localStorage no está disponible (incógnito), readBest devuelve 0 y
   writeBest no hace nada: la partida nunca se rompe y la pantalla de fin
   muestra "Mejor: —" cuando no hay récord.
   ============================================================ */
import * as THREE from 'three';
import { Enemies } from './enemies.js';

const SPAWN_INTERVAL = 0.8;    // s entre apariciones dentro de una oleada
const WAVE_CLEAR_DELAY = 3;    // s de respiro antes de la siguiente oleada (hordas)
const RETRY_DELAY = 0.25;      // s de espera cuando maxAlive impide spawnear
const MAX_ALIVE_CAP = 25;      // límite global de enemigos vivos simultáneos
const ORB_FIRST_DELAY = 6;     // s hasta el primer orbe de poder
const ORB_INTERVAL = 12;       // s entre orbes de poder
const ORB_PICKUP_RADIUS = 1.2; // m — recogida al pasar cerca
const ORB_MAX_ALIVE = 3;       // orbes sin recoger simultáneos como máximo
const HEAL_AMOUNT = 25;        // HP que restaura el orbe de curación
const BUFF_DAMAGE_MULT = 1.5;
const BUFF_DAMAGE_SECONDS = 10;
const BUFF_SPEED_MULT = 1.25;
const BUFF_SPEED_SECONDS = 8;
const BEST_KEY_HORDE = 'oaw_best';
const BEST_KEY_SURVIVAL = 'oaw_best_survival';
const BEST_KEY_DUEL = 'oaw_best_duel';

export const Modes = { startHorde, startSurvival, startDuel };

/* Acceso seguro a localStorage: en incógnito el mero acceso puede lanzar.
   Además de getItem, la sonda exige que setItem + removeItem funcionen
   de verdad (setItem puede tragar errores o fallar por cuota). */
const PROBE_KEY = '__oaw_probe__';

function safeStorage() {
  try {
    const s = window.localStorage;
    s.setItem(PROBE_KEY, '1');           // tocar setItem fuerza el fallo real
    const back = s.getItem(PROBE_KEY);
    if (typeof s.removeItem === 'function') s.removeItem(PROBE_KEY);
    if (back !== '1') return null;       // el storage no guarda lo que le das
    return s;
  } catch (_err) {
    return null;
  }
}

function setHudText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/* Comprobación defensiva de Audio (js/audio.js, binding léxico global). */
function sfx(name) {
  try {
    if (typeof Audio !== 'undefined' && Audio && typeof Audio.play === 'function') Audio.play(name);
  } catch (_err) { /* silencioso */ }
}

function formatTime(totalSeconds) {
  const t = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

/**
 * Cierre común de partida: persiste el récord en `bestKey` (verificando
 * la lectura de vuelta), muestra la pantalla de fin y devuelve las stats
 * finales con best/isRecord/hasBest. Nunca lanza.
 */
function finishGame(stats, bestKey) {
  sfx(stats.won ? 'victory' : 'gameOver');
  const Logic = typeof window !== 'undefined' ? window.Logic : null;
  // ui.js declara `const ui` (binding léxico global, no window.ui): resolver así
  const uiRef = typeof ui !== 'undefined' ? ui : null;
  const storage = safeStorage(); // null si localStorage está bloqueado (incógnito)
  let prevBest = 0;
  let best = 0;
  let isRecord = false;
  if (storage) {
    try {
      prevBest = Logic && typeof Logic.readBest === 'function' ? Logic.readBest(storage, bestKey) : 0;
    } catch (_err) {
      prevBest = 0;
    }
    best = Math.max(prevBest, stats.score);
    if (stats.score > prevBest) {
      // Logic.writeBest nunca lanza (traga los fallos): hay que verificar
      // leyendo de vuelta que el récord realmente persistió.
      if (Logic && typeof Logic.writeBest === 'function') Logic.writeBest(storage, stats.score, bestKey);
      let persisted = false;
      try {
        persisted = Logic && typeof Logic.readBest === 'function' && Logic.readBest(storage, bestKey) >= stats.score;
      } catch (_err) {
        persisted = false;
      }
      if (persisted) {
        isRecord = true;
      } else {
        console.warn('No se pudo guardar el récord en localStorage (¿cuota llena?). Se muestra la partida sin insignia de récord.');
        best = prevBest; // no afirmar una marca que no quedó guardada
      }
    }
  }
  const final = Object.assign({}, stats, { best, isRecord, hasBest: best > 0 });
  if (uiRef && typeof uiRef.showGameOver === 'function') {
    uiRef.showGameOver(final);
  } else {
    console.warn('ui.showGameOver no está disponible; stats:', final);
  }
  return final;
}

/** Cola de tipos mezclada a partir de una composición {ronin, bandido, lancero, brute}. */
function buildQueue(comp) {
  const queue = [];
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
  return queue;
}

/* ---------- Hordas Infinitas ---------- */

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
    horde.wave = n;
    horde.queue = buildQueue(comp);
    horde.spawnTimer = 0; // primer enemigo inmediato
    horde.spawnedAll = horde.queue.length === 0;
    horde.intermissionTimer = 0;
    horde.maxAlive = Math.min(Number(comp.maxAlive) || 8, MAX_ALIVE_CAP);
    horde.phase = horde.queue.length ? 'spawning' : 'active';
    setHudText('hud-wave', String(n));
    if (uiRef && typeof uiRef.showBanner === 'function') uiRef.showBanner('OLEADA ' + n);
    sfx('waveStart');
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
    const stats = finishGame({
      mode: 'hordas',
      wave: horde.wave,
      kills: horde.kills,
      time,
      score: computeScore(),
    }, BEST_KEY_HORDE);
    console.log('Fin de la partida (Hordas) — oleada ' + stats.wave + ', kills ' + stats.kills +
      ', tiempo ' + formatTime(time) + ', puntos ' + stats.score +
      (stats.isRecord ? ' ¡NUEVO RÉCORD!' : (stats.hasBest ? ' (mejor: ' + stats.best + ')' : ' (sin récord guardado)')));
    return stats;
  }

  // La partida arranca inmediatamente con la oleada 1.
  beginWave(1);

  return {
    update,
    registerKill,
    gameOver,
    dispose() { /* hordas no deja objetos propios en escena ni HUD */ },
    /** Copia del estado para depuración (consola / window.__modeState). */
    state() {
      return {
        mode: 'hordas',
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

/* ---------- Supervivencia ---------- */

const ORB_KINDS = ['heal', 'damage', 'speed'];
const ORB_COLORS = { heal: '#46d67c', damage: '#ff5040', speed: '#3cc8e8' };
const ORB_KANJI = { heal: '命', damage: '力', speed: '風' };

function startSurvival(ctx) {
  const Logic = typeof window !== 'undefined' ? window.Logic : null;
  const uiRef = typeof ui !== 'undefined' ? ui : null;
  const enemies = (ctx && Array.isArray(ctx.enemies)) ? ctx.enemies : [];
  const getArena = (ctx && ctx.getArena) || (() => null);
  const getPlayer = (ctx && ctx.getPlayer) || (() => null);

  const survival = {
    elapsed: 0,
    wave: 1,
    kills: 0,
    pickups: 0,
    score: 0,
    queue: [],
    spawnTimer: 0,
    maxAlive: 8,
    orbTimer: ORB_FIRST_DELAY,
    orbCount: 0,
    orbs: [],            // { mesh, kind, phase, baseY }
    buffDamageUntil: 0,  // segundos de juego en que expira cada buff
    buffSpeedUntil: 0,
    over: false,
  };

  // Indicadores de buff en el HUD (se crean aquí y se retiran en dispose)
  const buffsEl = document.getElementById('hud-buffs');
  const buffDamageEl = document.createElement('span');
  buffDamageEl.className = 'buff buff-damage hidden';
  const buffSpeedEl = document.createElement('span');
  buffSpeedEl.className = 'buff buff-speed hidden';
  if (buffsEl) {
    buffsEl.appendChild(buffDamageEl);
    buffsEl.appendChild(buffSpeedEl);
  }
  let healFlashTimer = null;

  function compositionOf(elapsed) {
    if (Logic && typeof Logic.survivalComposition === 'function') {
      return Logic.survivalComposition(elapsed);
    }
    return { wave: 1, ronin: 3, bandido: 0, lancero: 0, brute: 0, maxAlive: 8 };
  }

  function computeScore() {
    if (Logic && typeof Logic.survivalScore === 'function') {
      return Logic.survivalScore(survival.kills, survival.elapsed, survival.pickups);
    }
    return survival.kills * 10 + Math.floor(survival.elapsed) * 2 + survival.pickups * 25;
  }

  function syncScoreHud() {
    survival.score = computeScore();
    setHudText('hud-score', String(survival.score));
  }

  function insideObstacle(obstacles, x, z) {
    if (!Array.isArray(obstacles)) return false;
    for (const ob of obstacles) {
      if (Math.hypot(x - ob.x, z - ob.z) < (Number(ob.r) || 0) + 0.6) return true;
    }
    return false;
  }

  function buildOrbMesh(kind) {
    const color = ORB_COLORS[kind] || '#d4af37';
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.28, 0),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.85,
        roughness: 0.3,
        metalness: 0.1,
      })
    );
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }

  function removeOrb(index) {
    const orb = survival.orbs[index];
    if (!orb) return;
    if (orb.mesh.parent) orb.mesh.parent.remove(orb.mesh);
    orb.mesh.geometry.dispose();
    orb.mesh.material.dispose();
    survival.orbs.splice(index, 1);
  }

  function spawnOrb(arena) {
    if (survival.orbs.length >= ORB_MAX_ALIVE) removeOrb(0); // el más viejo caduca
    const kind = ORB_KINDS[survival.orbCount % ORB_KINDS.length];
    survival.orbCount += 1;
    const player = getPlayer();
    const px = player && player.group ? player.group.position.x : 0;
    const pz = player && player.group ? player.group.position.z : 0;
    const maxR = Math.max(6, (arena.radius || 38) * 0.7);
    let x = 0;
    let z = 0;
    for (let tries = 0; tries < 10; tries += 1) {
      const a = Math.random() * Math.PI * 2;
      const r = 6 + Math.random() * Math.max(1, maxR - 6);
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      if (!insideObstacle(arena.obstacles, x, z) && Math.hypot(x - px, z - pz) > 3) break;
    }
    const mesh = buildOrbMesh(kind);
    mesh.position.set(x, 0.9, z);
    arena.scene.add(mesh);
    survival.orbs.push({ mesh, kind, phase: Math.random() * Math.PI * 2, baseY: 0.9 });
  }

  function applyOrb(kind, player) {
    survival.pickups += 1;
    sfx('pickup');
    if (kind === 'heal') {
      player.hp = Math.min(player.maxHp, player.hp + HEAL_AMOUNT);
      const hpBar = document.getElementById('hud-hp');
      if (hpBar) {
        hpBar.classList.add('heal-flash');
        if (healFlashTimer) clearTimeout(healFlashTimer);
        healFlashTimer = setTimeout(() => hpBar.classList.remove('heal-flash'), 700);
      }
    } else if (kind === 'damage') {
      player.damageMult = BUFF_DAMAGE_MULT;
      survival.buffDamageUntil = survival.elapsed + BUFF_DAMAGE_SECONDS;
    } else if (kind === 'speed') {
      player.speedMult = BUFF_SPEED_MULT;
      survival.buffSpeedUntil = survival.elapsed + BUFF_SPEED_SECONDS;
    }
    syncScoreHud();
  }

  function updateBuffs(player) {
    if (survival.buffDamageUntil > 0 && survival.elapsed >= survival.buffDamageUntil) {
      survival.buffDamageUntil = 0;
      player.damageMult = 1;
    }
    if (survival.buffSpeedUntil > 0 && survival.elapsed >= survival.buffSpeedUntil) {
      survival.buffSpeedUntil = 0;
      player.speedMult = 1;
    }
    const dLeft = survival.buffDamageUntil - survival.elapsed;
    const sLeft = survival.buffSpeedUntil - survival.elapsed;
    buffDamageEl.classList.toggle('hidden', dLeft <= 0);
    if (dLeft > 0) buffDamageEl.textContent = ORB_KANJI.damage + ' ×' + BUFF_DAMAGE_MULT + ' · ' + Math.ceil(dLeft) + ' s';
    buffSpeedEl.classList.toggle('hidden', sLeft <= 0);
    if (sLeft > 0) buffSpeedEl.textContent = ORB_KANJI.speed + ' ×' + BUFF_SPEED_MULT + ' · ' + Math.ceil(sLeft) + ' s';
  }

  function updateOrbs(dt, player) {
    const px = player.group.position.x;
    const pz = player.group.position.z;
    for (let i = survival.orbs.length - 1; i >= 0; i -= 1) {
      const orb = survival.orbs[i];
      orb.mesh.rotation.y += dt * 1.6;
      orb.mesh.position.y = orb.baseY + Math.sin(survival.elapsed * 2.4 + orb.phase) * 0.15;
      const d = Math.hypot(px - orb.mesh.position.x, pz - orb.mesh.position.z);
      if (d <= ORB_PICKUP_RADIUS) {
        applyOrb(orb.kind, player);
        removeOrb(i);
      }
    }
  }

  function registerKill() {
    if (survival.over) return;
    survival.kills += 1;
    syncScoreHud();
  }

  function update(dt) {
    if (survival.over) return;
    const player = getPlayer();
    if (!player || !player.alive) return;
    if (!(dt > 0)) return;

    survival.elapsed += dt;

    // Oleada por tiempo: sube cada 40 s aunque queden enemigos vivos
    const comp = compositionOf(survival.elapsed);
    if (comp.wave !== survival.wave) {
      survival.wave = comp.wave;
      survival.queue = buildQueue(comp);
      setHudText('hud-wave', String(survival.wave));
      if (uiRef && typeof uiRef.showBanner === 'function') uiRef.showBanner('OLEADA ' + survival.wave);
      sfx('waveStart');
    }
    survival.maxAlive = Math.min(Number(comp.maxAlive) || 8, MAX_ALIVE_CAP);

    syncScoreHud();
    setHudText('hud-timer', formatTime(survival.elapsed));
    updateBuffs(player);

    const arena = getArena();
    if (!arena) return;

    // Spawns continuos: la cola se rellena al agotarse (sin gate de despeje)
    survival.spawnTimer -= dt;
    if (survival.spawnTimer <= 0) {
      if (!survival.queue.length) survival.queue = buildQueue(comp);
      if (enemies.length < survival.maxAlive) {
        const type = survival.queue.shift();
        enemies.push(Enemies.spawn(type, survival.wave, arena, arena.scene));
        window.__enemies = enemies;
        survival.spawnTimer = SPAWN_INTERVAL;
      } else {
        survival.spawnTimer = RETRY_DELAY;
      }
    }

    // Orbes de poder
    survival.orbTimer -= dt;
    if (survival.orbTimer <= 0) {
      spawnOrb(arena);
      survival.orbTimer = ORB_INTERVAL;
    }
    updateOrbs(dt, player);
  }

  function gameOver() {
    if (survival.over) return null;
    survival.over = true;
    const time = Math.floor(survival.elapsed);
    const stats = finishGame({
      mode: 'supervivencia',
      wave: survival.wave,
      kills: survival.kills,
      pickups: survival.pickups,
      time,
      score: computeScore(),
    }, BEST_KEY_SURVIVAL);
    console.log('Fin de la partida (Supervivencia) — oleada ' + stats.wave + ', kills ' + stats.kills +
      ', orbes ' + stats.pickups + ', tiempo ' + formatTime(time) + ', puntos ' + stats.score +
      (stats.isRecord ? ' ¡NUEVO RÉCORD!' : (stats.hasBest ? ' (mejor: ' + stats.best + ')' : ' (sin récord guardado)')));
    return stats;
  }

  function dispose() {
    while (survival.orbs.length) removeOrb(0);
    if (buffsEl) buffsEl.textContent = '';
    if (healFlashTimer) clearTimeout(healFlashTimer);
    const hpBar = document.getElementById('hud-hp');
    if (hpBar) hpBar.classList.remove('heal-flash');
    const player = getPlayer();
    if (player) {
      player.damageMult = 1;
      player.speedMult = 1;
    }
  }

  // Arranque: oleada 1 inmediata
  const comp0 = compositionOf(0);
  survival.queue = buildQueue(comp0);
  survival.maxAlive = Math.min(Number(comp0.maxAlive) || 8, MAX_ALIVE_CAP);
  setHudText('hud-wave', '1');
  if (uiRef && typeof uiRef.showBanner === 'function') uiRef.showBanner('OLEADA 1');
  sfx('waveStart');

  return {
    update,
    registerKill,
    gameOver,
    dispose,
    state() {
      return {
        mode: 'supervivencia',
        wave: survival.wave,
        kills: survival.kills,
        pickups: survival.pickups,
        elapsed: survival.elapsed,
        score: survival.score,
        queue: survival.queue.length,
        orbs: survival.orbs.length,
        maxAlive: survival.maxAlive,
        buffDamage: Math.max(0, survival.buffDamageUntil - survival.elapsed),
        buffSpeed: Math.max(0, survival.buffSpeedUntil - survival.elapsed),
      };
    },
  };
}

/* ---------- Duelo 1v1 ---------- */

function startDuel(ctx) {
  const Logic = typeof window !== 'undefined' ? window.Logic : null;
  const enemies = (ctx && Array.isArray(ctx.enemies)) ? ctx.enemies : [];
  const getArena = (ctx && ctx.getArena) || (() => null);
  const getPlayer = (ctx && ctx.getPlayer) || (() => null);

  const duel = {
    elapsed: 0,
    kills: 0,
    score: 0,
    spawned: false,
    won: false,
    over: false,
  };

  function duelScore(won, hpLeft, sec) {
    if (Logic && typeof Logic.duelScore === 'function') return Logic.duelScore(won, hpLeft, sec);
    return (won ? 500 : 0) + Math.max(0, Math.round(hpLeft)) * 5 + Math.max(0, 300 - Math.floor(sec)) * 2;
  }

  function showBossHud() {
    const boss = document.getElementById('hud-boss');
    if (boss) boss.classList.remove('hidden');
    const fill = document.getElementById('hud-boss-fill');
    if (fill) fill.style.width = '100%';
    const bar = document.getElementById('hud-boss-bar');
    if (bar) bar.setAttribute('aria-valuenow', '100');
  }

  function updateBossHud(enemy) {
    const pct = Math.max(0, Math.min(100, (enemy.hp / enemy.maxHp) * 100));
    const fill = document.getElementById('hud-boss-fill');
    if (fill) fill.style.width = pct + '%';
    const bar = document.getElementById('hud-boss-bar');
    if (bar) bar.setAttribute('aria-valuenow', String(Math.round(pct)));
  }

  function spawnMaestro() {
    const arena = getArena();
    if (!arena) return;
    const enemy = Enemies.spawn('maestro', 1, arena, arena.scene);
    // Aparece a 12 m del centro (el jugador arranca en el centro), mirándolo
    const a = Math.random() * Math.PI * 2;
    enemy.group.position.set(Math.cos(a) * 12, 0, Math.sin(a) * 12);
    enemy.group.rotation.y = Math.atan2(-enemy.group.position.x, -enemy.group.position.z);
    enemies.push(enemy);
    window.__enemies = enemies;
    duel.spawned = true;
    showBossHud();
    sfx('waveStart');
    console.log('Duelo: el Maestro entra en la arena (HP ' + enemy.maxHp + ').');
  }

  function registerKill() {
    if (duel.over) return;
    duel.kills += 1;
  }

  function update(dt) {
    if (duel.over) return;
    const player = getPlayer();
    if (!player || !player.alive) return;
    if (!(dt > 0)) return;

    duel.elapsed += dt;
    setHudText('hud-timer', formatTime(duel.elapsed));
    duel.score = duelScore(false, player.hp, duel.elapsed);
    setHudText('hud-score', String(duel.score));

    if (!duel.spawned) {
      spawnMaestro();
      return;
    }

    // Victoria: el maestro ha caído (Enemies.updateAll ya lo retiró de la lista)
    if (enemies.length === 0) {
      gameOver(true);
      return;
    }
    updateBossHud(enemies[0]);
  }

  function gameOver(won) {
    if (duel.over) return null;
    duel.over = true;
    duel.won = !!won;
    const player = getPlayer();
    const hpLeft = player ? Math.max(0, Math.round(player.hp)) : 0;
    const time = Math.floor(duel.elapsed);
    const score = duelScore(duel.won, hpLeft, time);
    const stats = finishGame({
      mode: 'duelo',
      won: duel.won,
      wave: 1,
      kills: duel.kills,
      hpLeft,
      time,
      score,
    }, BEST_KEY_DUEL);
    console.log('Fin del duelo — ' + (duel.won ? 'VICTORIA' : 'derrota') +
      ', HP restante ' + hpLeft + ', tiempo ' + formatTime(time) + ', puntos ' + score +
      (stats.isRecord ? ' ¡NUEVO RÉCORD!' : (stats.hasBest ? ' (mejor: ' + stats.best + ')' : ' (sin récord guardado)')));
    // La victoria la descubre el propio update: main.js debe congelar la partida.
    if (duel.won && ctx && typeof ctx.onEnd === 'function') ctx.onEnd(stats);
    return stats;
  }

  function dispose() {
    const boss = document.getElementById('hud-boss');
    if (boss) boss.classList.add('hidden');
    const fill = document.getElementById('hud-boss-fill');
    if (fill) fill.style.width = '100%';
  }

  return {
    update,
    registerKill,
    gameOver,
    dispose,
    state() {
      const boss = enemies.length ? enemies[0] : null;
      return {
        mode: 'duelo',
        elapsed: duel.elapsed,
        kills: duel.kills,
        score: duel.score,
        spawned: duel.spawned,
        won: duel.won,
        over: duel.over,
        bossHp: boss ? boss.hp : 0,
        bossMaxHp: boss ? boss.maxHp : 0,
      };
    },
  };
}
