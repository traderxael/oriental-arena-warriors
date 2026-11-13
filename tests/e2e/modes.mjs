/* E2E headless de los modos nuevos: Supervivencia y Duelo.
   Uso: node tests/e2e/modes.mjs [quality=baja]
   Requiere: python -m http.server 8123 en la raíz del proyecto.

   Supervivencia: HUD propio, recogida de orbe curación + orbe de daño (buff),
   oleada que sube por timer (40 s) y game over con fila de orbes + récord propio.
   Duelo: barra de boss, victoria forzada (takeDamage real al maestro), pantalla
   de victoria, retry y derrota real (el maestro golpea al jugador con 1 HP). */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, 'shots');
mkdirSync(shots, { recursive: true });

const quality = process.argv[2] || 'baja';
const errors = [];
let failures = 0;

function check(cond, label) {
  if (cond) {
    console.log('  OK  ' + label);
  } else {
    failures += 1;
    console.error('  FAIL ' + label);
  }
}

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
    '--disable-dev-shm-usage',
  ],
});

async function openMode(page, mode) {
  await page.goto(`http://127.0.0.1:8123/?quality=${quality}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__threeOk === true, null, { timeout: 20000 });
  await page.waitForSelector('#screen-title.visible', { timeout: 10000 });
  await page.click('#btn-play');
  await page.waitForSelector('#screen-mode.visible', { timeout: 5000 });
  await page.click(`#screen-mode .mode-card[data-mode="${mode}"]`);
  await page.waitForSelector('#screen-hero.visible', { timeout: 5000 });
  await page.click('#btn-hero-continue');
  await page.waitForSelector('#screen-map.visible', { timeout: 5000 });
  await page.click('#screen-map .map-card:not(.disabled)');
  await page.waitForSelector('#hud.visible', { timeout: 15000 });
  await page.waitForFunction(() => window.__arena && window.__player && window.__modeState, null, { timeout: 15000 });
  await fastMode(page);
}

/* SwiftShader renderiza a ~2 fps con sombras: el reloj de juego (dt capado a
   0.05) avanzaría a 0.1× y los waits de 40 s serían minutos. Sin sombras y a
   resolución mínima el ratio sube a ~0.75×. Sólo afecta al render del test;
   la lógica de juego es la misma. HP alta para que el jugador idle no muera
   durante las esperas (la derrota se fuerza al final por la vía real). */
async function fastMode(page) {
  await page.evaluate(() => {
    const a = window.__arena;
    a.renderer.shadowMap.enabled = false;
    if (a.sun) a.sun.castShadow = false;
    a.scene.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    a.renderer.setPixelRatio(0.5);
    a.renderer.setSize(160, 90, false);
    if (!a.renderer.__origRender) {
      a.renderer.__origRender = a.renderer.render.bind(a.renderer);
      let frame = 0;
      a.renderer.__throttle = true;
      a.renderer.render = function (...args) {
        if (!a.renderer.__throttle || (++frame % 10) === 0) {
          return a.renderer.__origRender(...args);
        }
      };
    } else {
      a.renderer.__throttle = true;
    }
    // maxHp también: el orbe de curación hace min(maxHp, hp+25) y nos volvería a 100
    window.__player.maxHp = 100000;
    window.__player.hp = 100000;
  });
}

async function sharpShot(page, outPath) {
  await page.evaluate(() => {
    const a = window.__arena;
    if (!a) return;
    a.renderer.__throttle = false;
    a.renderer.setPixelRatio(1);
    a.renderer.setSize(640, 360, false);
    a.camera.aspect = 640 / 360;
    a.camera.updateProjectionMatrix();
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: outPath });
  await page.evaluate(() => {
    const a = window.__arena;
    if (!a) return;
    a.renderer.__throttle = true;
    a.renderer.setPixelRatio(0.5);
    a.renderer.setSize(160, 90, false);
  });
}

const orbInScene = () => window.__arena.scene.children.some(
  (c) => c.geometry && c.geometry.type === 'IcosahedronGeometry'
);

async function pickupOrb(page, expectedPickups) {
  await page.waitForFunction(orbInScene, null, { timeout: 40000 });
  await page.evaluate(() => {
    const orb = window.__arena.scene.children.find(
      (c) => c.geometry && c.geometry.type === 'IcosahedronGeometry'
    );
    window.__player.group.position.set(orb.position.x, 0, orb.position.z);
  });
  await page.waitForFunction(
    (n) => window.__modeState && window.__modeState.pickups >= n,
    expectedPickups,
    { timeout: 10000 }
  );
}

try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console: ' + msg.text());
  });
  page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));

  /* ---------- Supervivencia ---------- */
  console.log('SUPERVIVENCIA');
  await openMode(page, 'supervivencia');
  await page.waitForTimeout(1500);

  const survHud = await page.evaluate(() => ({
    mode: document.getElementById('hud-mode').textContent,
    buffsVisible: !document.getElementById('hud-buffs').classList.contains('hidden'),
    bossHidden: document.getElementById('hud-boss').classList.contains('hidden'),
    waveVisible: !document.getElementById('hud-wave-stat').classList.contains('hidden'),
    state: window.__modeState,
  }));
  check(survHud.mode === 'Supervivencia', 'etiqueta de modo Supervivencia');
  check(survHud.buffsVisible && survHud.bossHidden && survHud.waveVisible, 'HUD: buffs visibles, boss oculto, oleada visible');
  check(survHud.state.mode === 'supervivencia' && survHud.state.wave === 1, 'estado inicial wave 1');
  await sharpShot(page, join(shots, 'survival-hud.png'));

  // Orbe 1 (curación): teleport del jugador y recogida real
  await pickupOrb(page, 1);
  const healFlash = await page.waitForFunction(
    () => document.getElementById('hud-hp').classList.contains('heal-flash'),
    null, { timeout: 3000 }
  ).then(() => true).catch(() => false);
  check(healFlash, 'orbe de curación: destello heal-flash en la barra de HP');

  // Orbe 2 (daño ×1.5): buff visible en HUD y multiplicador aplicado
  await pickupOrb(page, 2);
  // El span se pinta en el frame siguiente a la recogida: esperar al DOM
  await page.waitForFunction(
    () => !document.querySelector('#hud-buffs .buff-damage').classList.contains('hidden'),
    null, { timeout: 5000 }
  );
  const buffState = await page.evaluate(() => ({
    mult: window.__player.damageMult,
    spanVisible: !document.querySelector('#hud-buffs .buff-damage').classList.contains('hidden'),
    spanText: document.querySelector('#hud-buffs .buff-damage').textContent,
  }));
  check(buffState.mult === 1.5, 'orbe de daño: damageMult = 1.5');
  check(buffState.spanVisible && buffState.spanText.includes('1.5'), 'buff de daño visible en HUD (' + buffState.spanText + ')');
  await sharpShot(page, join(shots, 'survival-buff.png'));

  // Oleada por timer: sube a 2 a los 40 s de juego aunque queden enemigos
  await page.waitForFunction(() => window.__modeState && window.__modeState.wave >= 2, null, { timeout: 150000 });
  const wave2 = await page.evaluate(() => ({
    wave: window.__modeState.wave,
    hudWave: document.getElementById('hud-wave').textContent,
    alive: window.__enemies.length,
  }));
  check(wave2.wave === 2 && wave2.hudWave === '2', 'oleada 2 por timer (enemigos vivos: ' + wave2.alive + ')');

  // Derrota real: 1 HP junto a un enemigo; el golpe usa la vía Enemies.onPlayerDamage
  await page.evaluate(() => {
    const e = window.__enemies[0];
    if (e) {
      window.__player.hp = 1;
      window.__player.group.position.set(e.group.position.x + 0.8, 0, e.group.position.z + 0.8);
    }
  });
  await page.waitForSelector('#screen-gameover.visible', { timeout: 30000 });
  const survOver = await page.evaluate(() => ({
    heading: document.querySelector('#screen-gameover .screen-heading').textContent,
    headingTop: document.querySelector('#screen-gameover .screen-heading').getBoundingClientRect().top,
    mode: document.getElementById('go-mode').textContent,
    pickupsRowVisible: !document.getElementById('go-pickups-row').classList.contains('hidden'),
    pickups: document.getElementById('go-pickups').textContent,
    waveRowVisible: !document.getElementById('go-wave-row').classList.contains('hidden'),
    hpRowHidden: document.getElementById('go-hp-row').classList.contains('hidden'),
    bestLabel: document.getElementById('go-best-label').textContent,
    bestSurvival: localStorage.getItem('oaw_best_survival'),
    bestHorde: localStorage.getItem('oaw_best'),
    orbsLeft: window.__arena ? window.__arena.scene.children.filter(
      (c) => c.geometry && c.geometry.type === 'IcosahedronGeometry').length : -1,
  }));
  check(survOver.heading === 'Has caído en la arena', 'game over de derrota');
  check(survOver.headingTop >= 0, 'encabezado visible sin recorte en viewport bajo (top=' + Math.round(survOver.headingTop) + ')');
  check(survOver.mode === 'Supervivencia' && survOver.bestLabel.includes('Supervivencia'), 'etiquetas por modo');
  check(survOver.pickupsRowVisible && survOver.pickups === '2' && survOver.waveRowVisible && survOver.hpRowHidden, 'fila de orbes = 2, filas correctas');
  check(Number(survOver.bestSurvival) > 0 && survOver.bestHorde === null, 'récord aislado en oaw_best_survival');
  check(survOver.orbsLeft === 0, 'dispose limpia los orbes de la escena');
  await page.waitForTimeout(500); // dejar terminar el fade de la pantalla
  await page.screenshot({ path: join(shots, 'survival-gameover.png') });

  /* ---------- Duelo ---------- */
  console.log('DUELO');
  await openMode(page, 'duelo');
  await page.waitForFunction(() => window.__enemies.length === 1 && window.__enemies[0].type === 'maestro', null, { timeout: 15000 });
  await page.waitForTimeout(1200);

  const duelHud = await page.evaluate(() => ({
    mode: document.getElementById('hud-mode').textContent,
    bossVisible: !document.getElementById('hud-boss').classList.contains('hidden'),
    waveHidden: document.getElementById('hud-wave-stat').classList.contains('hidden'),
    buffsHidden: document.getElementById('hud-buffs').classList.contains('hidden'),
    bossName: document.querySelector('#hud-boss .boss-name').textContent,
    bossFill: document.getElementById('hud-boss-fill').style.width,
    bossHp: window.__modeState.bossHp,
  }));
  check(duelHud.mode === 'Duelo', 'etiqueta de modo Duelo');
  check(duelHud.bossVisible && duelHud.waveHidden && duelHud.buffsHidden, 'HUD: barra de boss visible, oleada y buffs ocultos');
  check(duelHud.bossName.includes('Maestro') && duelHud.bossFill === '100%' && duelHud.bossHp === 600, 'nameplate y barra del Maestro al 100%');
  await sharpShot(page, join(shots, 'duel-boss.png'));

  // La barra baja con el daño real (el HUD se pinta en el frame siguiente)
  await page.evaluate(() => window.__enemies[0].takeDamage(150));
  await page.waitForFunction(
    () => parseFloat(document.getElementById('hud-boss-fill').style.width) <= 75,
    null, { timeout: 5000 }
  );
  const bossPct = await page.evaluate(() => document.getElementById('hud-boss-fill').style.width);
  check(parseFloat(bossPct) <= 75, 'barra de boss refleja el daño (' + bossPct + ')');

  // Victoria: matar al maestro por la vía real de daño → updateAll lo retira → win
  await page.evaluate(() => window.__enemies[0].takeDamage(99999));
  await page.waitForSelector('#screen-gameover.visible', { timeout: 10000 });
  const duelWin = await page.evaluate(() => ({
    heading: document.querySelector('#screen-gameover .screen-heading').textContent,
    victoryClass: document.querySelector('#screen-gameover .screen-heading').classList.contains('victory'),
    mode: document.getElementById('go-mode').textContent,
    hpRowVisible: !document.getElementById('go-hp-row').classList.contains('hidden'),
    waveRowHidden: document.getElementById('go-wave-row').classList.contains('hidden'),
    record: !document.getElementById('go-record').classList.contains('hidden'),
    bestDuel: localStorage.getItem('oaw_best_duel'),
    bossHidden: document.getElementById('hud-boss').classList.contains('hidden'),
  }));
  check(duelWin.heading === '¡Victoria!' && duelWin.victoryClass, 'pantalla de victoria');
  check(duelWin.mode === 'Duelo' && duelWin.hpRowVisible && duelWin.waveRowHidden, 'filas de duelo (HP visible, oleada oculta)');
  check(duelWin.record && Number(duelWin.bestDuel) > 0, 'récord de duelo persistido');
  check(duelWin.bossHidden, 'dispose oculta la barra de boss');
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(shots, 'duel-victory.png') });

  // Retry → derrota real: 1 HP junto al maestro, su windup+golpe nos mata
  await page.click('#btn-retry');
  await page.waitForSelector('#hud.visible', { timeout: 5000 });
  await page.waitForFunction(() => window.__enemies.length === 1 && window.__enemies[0].type === 'maestro', null, { timeout: 15000 });
  await fastMode(page); // startArena re-aplica el tamaño completo: volver a acelerar
  await page.evaluate(() => {
    const boss = window.__enemies[0];
    window.__player.hp = 1;
    window.__player.group.position.set(boss.group.position.x + 1, 0, boss.group.position.z + 1);
  });
  await page.waitForSelector('#screen-gameover.visible', { timeout: 30000 });
  const duelLoss = await page.evaluate(() => ({
    heading: document.querySelector('#screen-gameover .screen-heading').textContent,
    record: !document.getElementById('go-record').classList.contains('hidden'),
    best: document.getElementById('go-best').textContent,
  }));
  check(duelLoss.heading === 'Has caído en la arena', 'derrota ante el Maestro');
  check(!duelLoss.record && Number(duelLoss.best) > 0, 'conserva el récord de la victoria sin marcar récord nuevo');
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(shots, 'duel-defeat.png') });

  if (errors.length) {
    console.error('ERRORES DE CONSOLA:\n' + errors.join('\n'));
    failures += 1;
  }
  if (failures === 0) {
    console.log('MODES OK (quality=' + quality + ')');
  } else {
    console.error(failures + ' comprobaciones fallidas');
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}