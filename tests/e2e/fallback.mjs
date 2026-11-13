/* Escenario E2E 4: Fallback GLB
   Aborta todas las rutas assets/characters/* y verifica que el juego arranca,
   no emite console.error ni pageerror y sigue siendo 100% jugable con los
   builders procedurales. */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, 'shots');
mkdirSync(shots, { recursive: true });

const errors = [];
const warnings = [];
let failures = 0;

function check(cond, label) {
  if (cond) console.log('  OK  ' + label);
  else {
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

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.route('**/assets/characters/**', (route) => route.abort('failed'));

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const txt = msg.text();
      // Chromium emite "Failed to load resource: net::ERR_FAILED" al abortar la red a propósito
      if (!txt.startsWith('Failed to load resource:')) errors.push('console: ' + txt);
    }
    if (msg.type() === 'warning') warnings.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));

  await page.goto('http://127.0.0.1:8123/?quality=baja', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__threeOk === true, null, { timeout: 20000 });
  await page.click('#btn-play');
  await page.waitForSelector('#screen-mode.visible', { timeout: 5000 });
  await page.click('#screen-mode .mode-card[data-mode="hordas"]');
  await page.waitForSelector('#screen-hero.visible', { timeout: 5000 });
  await page.waitForTimeout(800);
  await page.click('#btn-hero-continue');
  await page.waitForSelector('#screen-map.visible', { timeout: 5000 });
  await page.click('#screen-map .map-card:not(.disabled)');
  await page.waitForSelector('#hud.visible', { timeout: 15000 });

  await page.waitForFunction(() => window.__player && window.__enemies.length >= 1, null, { timeout: 15000 });
  await page.waitForTimeout(1500);

  // Colocar enemigo procedural frente al jugador y matarlo con ataque real
  const fbState = await page.evaluate(() => {
    const p = window.__player;
    const e = window.__enemies[0];
    p.group.position.set(0, 0, 0);
    p.group.rotation.y = 0;
    e.group.position.set(0, 0, 1.4);
    return {
      playerHasProceduralChildren: p.group.children.length >= 4,
      playerRig: p.rig,
      enemyHasWeapon: !!e.group.getObjectByName('weapon'),
      enemyRig: e.rig,
      mixers: window.Characters.activeMixerCount(),
    };
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shots, 'fallback-procedural.png') });

  check(fbState.playerHasProceduralChildren && fbState.playerRig === null, 'jugador cae limpiamente al builder procedural');
  check(fbState.enemyHasWeapon && fbState.enemyRig === null, 'enemigo cae limpiamente al builder procedural con arma');
  check(fbState.mixers === 0, '0 mixers activos cuando los GLBs de personaje fallan');
  check(warnings.some((w) => w.includes('assets/characters/')), 'console.warn descriptivo emitido al abortar GLBs');

  // Verificar combate completo sobre fallback procedural
  await page.evaluate(() => {
    window.__enemies[0].hp = 10;
    window.__combat.tryAttack(window.__player, window.__enemies, window.__playTime);
  });
  await page.waitForFunction(() => window.__modeState && window.__modeState.kills >= 1, null, { timeout: 5000 });
  check(true, 'combate y conteo de bajas funcionan sobre fallback procedural');

  if (errors.length) {
    console.error('ERRORES DE CONSOLA:\n' + errors.join('\n'));
    failures += 1;
  }
  if (failures === 0) console.log('FALLBACK OK');
  else process.exitCode = 1;
} finally {
  await browser.close();
}
