/*
 * Oriental Arena Warriors - logica pura de juego (sin DOM).
 * Funciona en el navegador (window.Logic) y bajo CommonJS (node --test).
 * Archivo guardado como UTF-8.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.Logic = api;
  }
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var WAVE_CAP = 25;
  var HP_CAP = 800;
  var HP_PER_WAVE = 0.12;
  var BEST_KEY = 'oaw_best';

  function clampInt(value, min, max) {
    var n = Math.floor(Number(value));
    if (!Number.isFinite(n)) n = min;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function scaleStat(base, wave) {
    var w = clampInt(wave, 1, 1000000);
    return base * (1 + HP_PER_WAVE * (w - 1));
  }

  // Oleada 1: {ronin:3,bandido:0,lancero:0,brute:0}
  // Oleada 5+: incluye lanceros; multiplos de 5: 1 brute.
  // maxAlive = min(6 + wave*2, 25); totales siempre <= 25.
  function waveComposition(wave) {
    var w = clampInt(wave, 1, 1000000);

    var ronin = Math.min(3 + (w - 1), 10);
    var bandido = w >= 2 ? Math.min(2 + (w - 2), 8) : 0;
    var lancero = w >= 5 ? Math.min(1 + Math.floor((w - 5) / 2), 5) : 0;
    var brute = w % 5 === 0 ? 1 : 0;

    // Recorte determinista si el total superara el tope global.
    var total = ronin + bandido + lancero + brute;
    if (total > WAVE_CAP) {
      var overflow = total - WAVE_CAP;
      var takeRonin = Math.min(ronin, overflow);
      ronin -= takeRonin;
      overflow -= takeRonin;
      if (overflow > 0) {
        var takeBandido = Math.min(bandido, overflow);
        bandido -= takeBandido;
        overflow -= takeBandido;
      }
      if (overflow > 0) {
        lancero = Math.max(0, lancero - overflow);
      }
    }

    return {
      ronin: ronin,
      bandido: bandido,
      lancero: lancero,
      brute: brute,
      maxAlive: Math.min(6 + w * 2, WAVE_CAP),
    };
  }

  var ENEMY_BASE = {
    ronin: { hp: 60, speed: 2.2, damage: 8, range: 1.6, attackCooldown: 1.2 },
    bandido: { hp: 45, speed: 3.0, damage: 6, range: 1.4, attackCooldown: 0.9 },
    lancero: { hp: 80, speed: 1.8, damage: 12, range: 2.6, attackCooldown: 1.6 },
    brute: { hp: 220, speed: 1.3, damage: 20, range: 2.0, attackCooldown: 2.0 },
  };

  function enemyStats(type, wave) {
    var base = ENEMY_BASE[type];
    if (!base) {
      throw new Error('enemyStats: unknown type "' + String(type) + '" (expected ronin|bandido|lancero|brute)');
    }
    return {
      hp: Math.min(HP_CAP, Math.round(scaleStat(base.hp, wave))),
      speed: base.speed,
      damage: Math.max(1, Math.round(scaleStat(base.damage, wave))),
      range: base.range,
      attackCooldown: base.attackCooldown,
    };
  }

  var COMBO_MULTIPLIERS = [1.0, 1.15, 1.4];

  function comboDamage(base, hitsInCombo) {
    var idx = clampInt(hitsInCombo, 1, 3) - 1;
    var b = Number(base);
    if (!Number.isFinite(b) || b < 0) b = 0;
    return Math.round(b * COMBO_MULTIPLIERS[idx]);
  }

  function normalizeAngle(angle) {
    var a = Number(angle);
    if (!Number.isFinite(a)) return 0;
    a = a % (Math.PI * 2);
    if (a > Math.PI) a -= Math.PI * 2;
    if (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function inArc(angleToTarget, facing, arcRad, dist, range) {
    var d = Number(dist);
    var r = Number(range);
    var arc = Number(arcRad);
    if (!Number.isFinite(d) || !Number.isFinite(r) || !Number.isFinite(arc)) return false;
    if (d < 0) return false; // distancia negativa no es valida: fuera de rango
    if (d > r) return false;
    var diff = Math.abs(normalizeAngle(Number(angleToTarget) - Number(facing)));
    return diff <= Math.abs(arc) / 2;
  }

  function scoreFor(wave, kills, timeSeconds) {
    var w = clampInt(wave, 0, 1000000);
    var k = clampInt(kills, 0, 1000000);
    var t = Math.floor(Number(timeSeconds));
    if (!Number.isFinite(t) || t < 0) t = 0;
    return k * 10 + w * 50 + t;
  }

  function sanitizeBest(value) {
    var n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
  }

  function readBest(storage, key) {
    try {
      if (!storage) return 0;
      var raw = storage.getItem(key || BEST_KEY);
      if (raw == null) return 0;
      return sanitizeBest(JSON.parse(raw));
    } catch (_err) {
      return 0;
    }
  }

  function writeBest(storage, value, key) {
    try {
      if (!storage) return;
      storage.setItem(key || BEST_KEY, String(sanitizeBest(value)));
    } catch (_err) {
      // storage bloqueado (incognito) o sin cuota: ignorar
    }
  }

  // Supervivencia: la oleada sube por tiempo (cada 40 s), no por despeje.
  function survivalComposition(elapsedSec) {
    var t = Number(elapsedSec);
    if (!Number.isFinite(t) || t < 0) t = 0;
    var wave = 1 + Math.floor(t / 40);
    var comp = waveComposition(wave);
    return {
      wave: wave,
      ronin: comp.ronin,
      bandido: comp.bandido,
      lancero: comp.lancero,
      brute: comp.brute,
      maxAlive: Math.min(8 + Math.floor(t / 30), 20),
    };
  }

  function survivalScore(kills, sec, pickups) {
    var k = clampInt(kills, 0, 1000000);
    var p = clampInt(pickups, 0, 1000000);
    var t = Math.floor(Number(sec));
    if (!Number.isFinite(t) || t < 0) t = 0;
    return k * 10 + t * 2 + p * 25;
  }

  function duelStats() {
    return { hp: 600, speed: 3.4, damage: 16, range: 2.8, attackCooldown: 1.1 };
  }

  function duelScore(won, hpLeft, sec) {
    var hp = clampInt(hpLeft, 0, 1000000);
    var t = Math.floor(Number(sec));
    if (!Number.isFinite(t) || t < 0) t = 0;
    return (won ? 500 : 0) + hp * 5 + Math.max(0, 300 - t) * 2;
  }

  /* ---------- Helpers de animación (rigs GLB, Fase 5) ---------- */

  // Rol de locomoción de un clip: walk | idle | death | null.
  function clipRole(name) {
    var n = String(name == null ? '' : name);
    if (/dying|death/i.test(n)) return 'death';
    if (/jog|run|walk/i.test(n)) return 'walk';
    if (/idle/i.test(n)) return 'idle';
    return null;
  }

  // Root motion: anula X/Z de la traslación del hueso raíz (Hips/Root) y
  // conserva Y (bounce al correr, caída al morir). Muta tracks in situ.
  function stripRootMotion(tracks) {
    if (!Array.isArray(tracks)) return tracks;
    for (var i = 0; i < tracks.length; i += 1) {
      var tr = tracks[i];
      if (!tr || typeof tr.name !== 'string' || !tr.values) continue;
      if (!/(^|[.|/:])(mixamorig)?(hips|root)\.position$/i.test(tr.name)) continue;
      for (var j = 0; j + 2 < tr.values.length; j += 3) {
        tr.values[j] = 0;
        tr.values[j + 2] = 0;
      }
    }
    return tracks;
  }

  // Hueso de la mano derecha para re-parentar el arma: override manual,
  // luego nombre exacto, luego anclado, luego regex laxa. null si no hay.
  function pickHandBone(names, override) {
    if (!Array.isArray(names)) return null;
    if (override && names.indexOf(override) !== -1) return override;
    var i;
    for (i = 0; i < names.length; i += 1) {
      if (/^righthand$/i.test(String(names[i]))) return names[i];
    }
    for (i = 0; i < names.length; i += 1) {
      if (/^(right.*hand|hand.*right)$/i.test(String(names[i]))) return names[i];
    }
    for (i = 0; i < names.length; i += 1) {
      if (/hand.*r|r.*hand/i.test(String(names[i]))) return names[i];
    }
    return null;
  }

  return {
    waveComposition: waveComposition,
    enemyStats: enemyStats,
    comboDamage: comboDamage,
    inArc: inArc,
    scoreFor: scoreFor,
    readBest: readBest,
    writeBest: writeBest,
    survivalComposition: survivalComposition,
    survivalScore: survivalScore,
    duelStats: duelStats,
    duelScore: duelScore,
    clipRole: clipRole,
    stripRootMotion: stripRootMotion,
    pickHandBone: pickHandBone,
  };
});
