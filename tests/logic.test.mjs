import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Logic = require('../js/logic.js');

test('waveComposition: oleada 1 es exacta', () => {
  assert.deepEqual(Logic.waveComposition(1), {
    ronin: 3,
    bandido: 0,
    lancero: 0,
    brute: 0,
    maxAlive: 8,
  });
});

test('waveComposition: oleada 5 incluye lancero y 1 brute', () => {
  const w5 = Logic.waveComposition(5);
  assert.ok(w5.lancero >= 1, 'oleada 5 debe incluir al menos 1 lancero');
  assert.equal(w5.brute, 1);
});

test('waveComposition: oleada 10 incluye 1 brute (múltiplo de 5)', () => {
  assert.equal(Logic.waveComposition(10).brute, 1);
});

test('waveComposition: oleada 4 no incluye lanceros ni brute', () => {
  const w4 = Logic.waveComposition(4);
  assert.equal(w4.lancero, 0);
  assert.equal(w4.brute, 0);
});

test('waveComposition: oleada 20 no supera 25 vivos ni 25 totales', () => {
  const w20 = Logic.waveComposition(20);
  assert.equal(w20.maxAlive, 25);
  const total = w20.ronin + w20.bandido + w20.lancero + w20.brute;
  assert.ok(total <= 25, `total ${total} debe ser <= 25`);
});

test('waveComposition: counts totales nunca superan 25 en oleadas altas', () => {
  for (const wave of [15, 20, 25, 30, 50, 100]) {
    const w = Logic.waveComposition(wave);
    const total = w.ronin + w.bandido + w.lancero + w.brute;
    assert.ok(total <= 25, `oleada ${wave}: total ${total} debe ser <= 25`);
    assert.ok(w.maxAlive <= 25);
  }
});

test('waveComposition: maxAlive escala con tope 25', () => {
  assert.equal(Logic.waveComposition(1).maxAlive, 8);
  assert.equal(Logic.waveComposition(10).maxAlive, 25);
});

test('enemyStats: hp de brute > hp de ronin en oleada 1', () => {
  const brute = Logic.enemyStats('brute', 1);
  const ronin = Logic.enemyStats('ronin', 1);
  assert.ok(brute.hp > ronin.hp);
});

test('enemyStats: hp y damage crecen con la oleada', () => {
  const w1 = Logic.enemyStats('ronin', 1);
  const w5 = Logic.enemyStats('ronin', 5);
  assert.ok(w5.hp > w1.hp);
  assert.ok(w5.damage > w1.damage);
});

test('enemyStats: hp tiene clamp de 800', () => {
  const w100 = Logic.enemyStats('brute', 100);
  assert.ok(w100.hp <= 800);
  assert.equal(w100.hp, 800);
});

test('enemyStats: tipo desconocido lanza Error claro', () => {
  assert.throws(() => Logic.enemyStats('dragon', 1), /unknown type/i);
  assert.throws(() => Logic.enemyStats(undefined, 1), /unknown type/i);
});

test('enemyStats: devuelve las 5 propiedades requeridas', () => {
  const s = Logic.enemyStats('lancero', 3);
  for (const key of ['hp', 'speed', 'damage', 'range', 'attackCooldown']) {
    assert.equal(typeof s[key], 'number');
    assert.ok(Number.isFinite(s[key]));
  }
});

test('comboDamage: multiplicadores 1.0 / 1.15 / 1.4', () => {
  assert.equal(Logic.comboDamage(100, 1), 100);
  assert.equal(Logic.comboDamage(100, 2), 115);
  assert.equal(Logic.comboDamage(100, 3), 140);
});

test('inArc: true en rango y frontal', () => {
  assert.equal(Logic.inArc(0, 0, Math.PI / 2, 2, 3), true);
  assert.equal(Logic.inArc(0.4, 0, Math.PI / 2, 2, 3), true);
});

test('inArc: false fuera de rango', () => {
  assert.equal(Logic.inArc(0, 0, Math.PI / 2, 5, 3), false);
});

test('inArc: dist negativa se trata como fuera de rango (false)', () => {
  assert.equal(Logic.inArc(0, 0, Math.PI / 2, -1, 3), false);
});

test('inArc: false detrás del atacante', () => {
  assert.equal(Logic.inArc(Math.PI, 0, Math.PI / 2, 2, 3), false);
});

test('inArc: normaliza ángulos envolventes (±π)', () => {
  // facing casi π, target casi -π: diferencia angular pequeña, debe ser true
  assert.equal(Logic.inArc(-Math.PI + 0.1, Math.PI - 0.1, Math.PI / 2, 2, 3), true);
});

test('scoreFor: scoreFor(3, 12, 95) === 365', () => {
  assert.equal(Logic.scoreFor(3, 12, 95), 365);
});

test('scoreFor: enteros ≥ 0 con entradas negativas', () => {
  const s = Logic.scoreFor(-1, -5, -10);
  assert.equal(s, 0);
  assert.ok(Number.isInteger(s));
});

test('readBest: null storage devuelve 0', () => {
  assert.equal(Logic.readBest(null), 0);
});

test('readBest: JSON corrupto devuelve 0', () => {
  const storage = {
    getItem() {
      return '{corrupto!!!';
    },
  };
  assert.equal(Logic.readBest(storage), 0);
});

test('readBest: valor guardado válido se lee y sanea', () => {
  const storage = {
    getItem() {
      return '1234';
    },
  };
  assert.equal(Logic.readBest(storage), 1234);
});

test('readBest: valor negativo se sanea a 0', () => {
  const storage = {
    getItem() {
      return '-50';
    },
  };
  assert.equal(Logic.readBest(storage), 0);
});

test('readBest: storage que lanza devuelve 0', () => {
  const storage = {
    getItem() {
      throw new Error('bloqueado (incógnito)');
    },
  };
  assert.equal(Logic.readBest(storage), 0);
});

test('writeBest: no lanza si storage lanza', () => {
  const storage = {
    setItem() {
      throw new Error('cuota excedida');
    },
  };
  assert.doesNotThrow(() => Logic.writeBest(storage, 500));
});

test('writeBest: sanea valor y roundtrip con readBest', () => {
  let saved = null;
  const storage = {
    getItem() {
      return saved;
    },
    setItem(_key, value) {
      saved = value;
    },
  };
  Logic.writeBest(storage, 777.9);
  assert.equal(Logic.readBest(storage), 777);
});

test('writeBest: null storage no lanza', () => {
  assert.doesNotThrow(() => Logic.writeBest(null, 100));
});

// ---- Supervivencia / Duelo (v2) ----

function mapStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m,
  };
}

test('survivalComposition: t=0 es oleada 1 con composición de waveComposition(1)', () => {
  const c = Logic.survivalComposition(0);
  const w1 = Logic.waveComposition(1);
  assert.equal(c.wave, 1);
  assert.equal(c.ronin, w1.ronin);
  assert.equal(c.bandido, w1.bandido);
  assert.equal(c.lancero, w1.lancero);
  assert.equal(c.brute, w1.brute);
  assert.equal(c.maxAlive, 8);
});

test('survivalComposition: la oleada avanza cada 40 s', () => {
  assert.equal(Logic.survivalComposition(39.9).wave, 1);
  assert.equal(Logic.survivalComposition(40).wave, 2);
  assert.equal(Logic.survivalComposition(120).wave, 4);
});

test('survivalComposition: maxAlive = min(8+floor(t/30), 20)', () => {
  assert.equal(Logic.survivalComposition(0).maxAlive, 8);
  assert.equal(Logic.survivalComposition(30).maxAlive, 9);
  assert.equal(Logic.survivalComposition(360).maxAlive, 20);
  assert.equal(Logic.survivalComposition(3600).maxAlive, 20);
});

test('survivalComposition: counts coinciden con waveComposition de su oleada', () => {
  for (const t of [0, 45, 200, 1000]) {
    const c = Logic.survivalComposition(t);
    const w = Logic.waveComposition(c.wave);
    assert.deepEqual(
      { ronin: c.ronin, bandido: c.bandido, lancero: c.lancero, brute: c.brute },
      { ronin: w.ronin, bandido: w.bandido, lancero: w.lancero, brute: w.brute },
    );
  }
});

test('survivalComposition: entradas negativas/NaN se sanean a oleada 1', () => {
  for (const bad of [-10, NaN, undefined]) {
    const c = Logic.survivalComposition(bad);
    assert.equal(c.wave, 1);
    assert.ok(c.maxAlive >= 8);
  }
});

test('survivalScore: kills*10 + floor(sec)*2 + pickups*25', () => {
  assert.equal(Logic.survivalScore(12, 95.7, 3), 120 + 190 + 75);
});

test('survivalScore: entradas negativas dan entero ≥ 0', () => {
  const s = Logic.survivalScore(-5, -10, -2);
  assert.equal(s, 0);
  assert.ok(Number.isInteger(s));
});

test('duelStats: valores exactos del maestro', () => {
  assert.deepEqual(Logic.duelStats(), {
    hp: 600, speed: 3.4, damage: 16, range: 2.8, attackCooldown: 1.1,
  });
});

test('duelScore: victoria con vida y tiempo', () => {
  assert.equal(Logic.duelScore(true, 300, 120), 500 + 1500 + 360);
});

test('duelScore: derrota sin bonus de victoria', () => {
  assert.equal(Logic.duelScore(false, 0, 400), 0);
});

test('duelScore: bonus de tiempo se corta en 300 s', () => {
  assert.equal(Logic.duelScore(true, 100, 900), 500 + 500 + 0);
});

test('duelScore: hp negativo se sanea a 0', () => {
  assert.equal(Logic.duelScore(true, -50, 0), 500 + 0 + 600);
});

test('readBest/writeBest: claves por modo aisladas entre sí y de hordas', () => {
  const s = mapStorage();
  Logic.writeBest(s, 100);
  Logic.writeBest(s, 200, 'oaw_best_survival');
  Logic.writeBest(s, 300, 'oaw_best_duel');
  assert.equal(Logic.readBest(s), 100);
  assert.equal(Logic.readBest(s, 'oaw_best_survival'), 200);
  assert.equal(Logic.readBest(s, 'oaw_best_duel'), 300);
  assert.equal(s._map.size, 3);
});

test('writeBest: clave por modo roundtrip y saneo, hordas intacto', () => {
  const s = mapStorage();
  Logic.writeBest(s, 777.9, 'oaw_best_survival');
  assert.equal(Logic.readBest(s, 'oaw_best_survival'), 777);
  assert.equal(Logic.readBest(s), 0);
});
