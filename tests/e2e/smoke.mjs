/* Smoke test headless: arranque + flujo completo hasta la arena.
   Uso: node tests/e2e/smoke.mjs [quality=baja]
   Requiere: python -m http.server 8123 en la raíz del proyecto. */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, 'shots');
mkdirSync(shots, { recursive: true });

const quality = process.argv[2] || 'baja';
const errors = [];

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
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console: ' + msg.text());
  });
  page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));

  await page.goto(`http://127.0.0.1:8123/?quality=${quality}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__threeOk === true, null, { timeout: 20000 });
  await page.waitForSelector('#screen-title.visible', { timeout: 10000 });
  await page.screenshot({ path: join(shots, `smoke-title-${quality}.png`) });

  // Título → Modo → Héroe → Mapa → Juego
  await page.click('#btn-play');
  await page.waitForSelector('#screen-mode.visible', { timeout: 5000 });
  await page.screenshot({ path: join(shots, `smoke-mode-${quality}.png`) });
  await page.click('#screen-mode .mode-card:not(.disabled)');
  await page.waitForSelector('#screen-hero.visible', { timeout: 5000 });
  await page.screenshot({ path: join(shots, `smoke-hero-${quality}.png`) });
  await page.click('#btn-hero-continue');
  await page.waitForSelector('#screen-map.visible', { timeout: 5000 });
  await page.click('#screen-map .map-card:not(.disabled)');
  await page.waitForSelector('#hud.visible', { timeout: 15000 });

  // Esperar a que la arena renderice unos frames
  await page.waitForFunction(() => window.__arena && window.__player, null, { timeout: 15000 });
  await page.waitForTimeout(3500);

  const info = await page.evaluate(() => {
    const a = window.__arena;
    return {
      quality: window.__quality.level,
      hasComposer: !!a.composer,
      radius: a.radius,
      obstacles: a.obstacles ? a.obstacles.length : -1,
      hasSun: !!a.sun,
      environment: !!a.scene.environment,
      playerHp: window.__player.hp,
      enemies: window.__enemies.length,
      calls: a.renderer.info.render.calls,
      triangles: a.renderer.info.render.triangles,
      geometries: a.renderer.info.memory.geometries,
      textures: a.renderer.info.memory.textures,
      playTime: window.__playTime,
    };
  });
  console.log('ARENA INFO:', JSON.stringify(info, null, 2));
  await page.screenshot({ path: join(shots, `smoke-arena-${quality}.png`) });

  // Pausa: selector de calidad presente y funcional
  await page.keyboard.press('Escape');
  await page.waitForSelector('#screen-pause.visible', { timeout: 5000 });
  const selectValue = await page.inputValue('#select-quality');
  console.log('SELECT QUALITY:', selectValue);
  await page.screenshot({ path: join(shots, `smoke-pause-${quality}.png`) });
  await page.keyboard.press('Escape');
  await page.waitForSelector('#hud.visible', { timeout: 5000 });

  if (errors.length) {
    console.error('ERRORES DE CONSOLA:\n' + errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('SMOKE OK (quality=' + quality + ')');
  }
} finally {
  await browser.close();
}