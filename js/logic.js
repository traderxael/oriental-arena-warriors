/*
 * Oriental Arena Warriors — lógica pura de juego (sin DOM).
 * Funciona en el navegador (window.Logic) y bajo CommonJS (node --test).
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
  // Oleada 5+: incluye lanceros; múltiplos de 5: 1 brute.
  // maxAlive = min(6 + wave*2, 25); totales siempre ≤ 25.
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
    var base = ENEMY_BASE[type] || ENEMY_BASE.ronin;
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

  function readBest(storage) {
    try {
      if (!storage) return 0;
      var raw = storage.getItem(BEST_KEY);
      if (raw == null) return 0;
      return sanitizeBest(JSON.parse(raw));
    } catch (_err) {
      return 0;
    }
  }

  function writeBest(storage, value) {
    try {
      if (!storage) return;
      storage.setItem(BEST_KEY, String(sanitizeBest(value)));
    } catch (_err) {
      /* storage bloqueado (incógnito) o sin cuota: ignorar */
    }
  }

  return {
    waveComposition: waveComposition,
    enemyStats: enemyStats,
    comboDamage: comboDamage,
    inArc: inArc,
    scoreFor: scoreFor,
    readBest: readBest,
    writeBest: writeBest,
  };
});
