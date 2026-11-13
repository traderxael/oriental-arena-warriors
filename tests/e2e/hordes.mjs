/* Escenario E2E 1: Boot sin errores + flujo completo Hordas
   (title -> mode -> hero 3D preview -> map -> spawn -> kill -> corpse -> muerte -> resultados -> retry -> récord persiste). */
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
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console: ' + msg.text());
  });
  page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));

  await page.goto(`http://127.0.0.1:8123/?quality=${quality}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__threeOk === true, null, { timeout: 20000 });
  await page.waitForSelector('#screen-title.visible', { timeout: 10000 });
  await page.screenshot({ path: join(shots, 'hordes-title.png') });

  // Mute botón global
  await page.click('#btn-mute');
  check(await page.evaluate(() => Audio.isMuted() === true), 'Audio.setMuted(true) silencia master-gain');
  await page.click('#btn-mute');
  check(await page.evaluate(() => Audio.isMuted() === false), 'Audio.setMuted(false) restaura master-gain');

  // Título -> Modo -> Héroe (con preview 3D 256²) -> Mapa -> Arena
  await page.click('#btn-play');
  await page.waitForSelector('#screen-mode.visible', { timeout: 5000 });
  await page.click('#screen-mode .mode-card[data-mode="hordas"]');
  await page.waitForSelector('#screen-hero.visible', { timeout: 5000 });
  await page.waitForFunction(() => window.HeroPreview && window.HeroPreview.isMounted(), null, { timeout: 5000 });
  await page.waitForTimeout(1500);
  check(await page.evaluate(() => document.querySelectorAll('#hero-preview-canvas').length === 1), 'visor 256² único en selector de héroe');
  await page.screenshot({ path: join(shots, 'hordes-hero-preview.png') });

  // El conejo samurái aparece en el selector y se dibuja en el mismo visor 3D.
  await page.click('#hero-cards .hero-card[data-hero-id="tsuki"]');
  await page.waitForFunction(() =>
    document.getElementById('hero-preview-name').textContent.trim() === 'Tsuki' &&
    document.getElementById('hpv-wpn').textContent.trim() === 'Wakizashi' &&
    document.querySelector('#hero-cards [data-hero-id="tsuki"]').getAttribute('aria-selected') === 'true',
    null,
    { timeout: 5000 }
  );
  await page.waitForTimeout(7000);
  check(await page.evaluate(() => window.HEROES.some((hero) => hero.id === 'tsuki')), 'Tsuki aparece como héroe seleccionable');
  await page.screenshot({ path: join(shots, 'hordes-hero-tsuki.png') });

  // El resto del flujo verifica el montaje riggeado de Akane.
  await page.click('#hero-cards .hero-card[data-hero-id="akane"]');
  await page.waitForFunction(() => document.getElementById('hero-preview-name').textContent.trim() === 'Akane');

  await page.click('#btn-hero-continue');
  await page.waitForSelector('#screen-map.visible', { timeout: 5000 });
  check(await page.evaluate(() => !window.HeroPreview.isMounted() && document.querySelectorAll('#hero-preview-canvas').length === 0), 'visor 256² liberado al salir de #screen-hero');

  await page.click('#screen-map .map-card:not(.disabled)');
  await page.waitForSelector('#hud.visible', { timeout: 15000 });
  await page.waitForFunction(
    () => window.__arena && window.__player && window.__player.rig &&
          window.__enemies.length >= 1 && window.__enemies[0].rig,
    null,
    { timeout: 25000 }
  );

  // Acelerar tamaño interno tras tomar la captura principal de combate
  await page.evaluate(() => {
    const p = window.__player;
    const e = window.__enemies[0];
    p.group.position.set(0, 0, 0);
    p.group.rotation.y = 0; // mira a +Z
    e.group.position.set(0, 0, 1.5); // delante del jugador en el arco de ataque
    e.hp = 10;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(shots, 'hordes-combat.png') });

  // Kill real con Combat.tryAttack -> verifica kill registrado + pool de cadáveres
  await page.evaluate(() => {
    const a = window.__arena;
    a.renderer.setPixelRatio(0.5);
    a.renderer.setSize(160, 90, false);
    if (!a.renderer.__origRender) {
      a.renderer.__origRender = a.renderer.render.bind(a.renderer);
      let f = 0;
      a.renderer.render = function (...args) {
        if ((++f % 8) === 0) return a.renderer.__origRender(...args);
      };
    }
    window.__combat.tryAttack(window.__player, window.__enemies, window.__playTime);
  });
  await page.waitForFunction(() => window.__modeState && window.__modeState.kills >= 1, null, { timeout: 5000 });
  const killState = await page.evaluate(() => ({
    kills: window.__modeState.kills,
    score: window.__modeState.score,
    corpses: window.Enemies.corpseCount(),
  }));
  check(killState.kills >= 1 && killState.score >= 60, 'kill registrado y puntuación actualizada (' + killState.score + ')');
  check(killState.corpses >= 1, 'enemigo riggeado pasa al pool de cadáveres tras morir');

  // Esperar a que haya otro enemigo vivo para morir contra él por vía real
  await page.waitForFunction(() => window.__enemies.length >= 1, null, { timeout: 15000 });
  await page.evaluate(() => {
    const e = window.__enemies[0];
    window.__player.hp = 1;
    window.__player.group.position.set(e.group.position.x + 0.7, 0, e.group.position.z + 0.7);
  });
  await page.waitForSelector('#screen-gameover.visible', { timeout: 30000 });
  const go1 = await page.evaluate(() => ({
    heading: document.querySelector('#screen-gameover .screen-heading').textContent,
    kills: document.getElementById('go-kills').textContent,
    score: Number(document.getElementById('go-score').textContent),
    best: Number(document.getElementById('go-best').textContent),
    isRecord: !document.getElementById('go-record').classList.contains('hidden'),
    savedBest: Number(localStorage.getItem('oaw_best')),
  }));
  check(go1.heading === 'Has caído en la arena', 'pantalla de fin de partida mostrada');
  check(go1.kills === '1' && go1.score >= 60 && go1.isRecord && go1.savedBest === go1.score, 'nuevo récord guardado en oaw_best (' + go1.savedBest + ')');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shots, 'hordes-gameover.png') });

  // Retry -> morir con menos puntos (0 kills, oleada 1 -> ~50 pts) -> el récord anterior persiste
  await page.click('#btn-retry');
  await page.waitForSelector('#hud.visible', { timeout: 15000 });
  await page.waitForFunction(() => window.__enemies.length >= 1 && window.__player, null, { timeout: 15000 });
  await page.evaluate(() => {
    const a = window.__arena;
    a.renderer.setPixelRatio(0.5);
    a.renderer.setSize(160, 90, false);
    const e = window.__enemies[0];
    window.__player.hp = 1;
    window.__player.group.position.set(e.group.position.x + 0.7, 0, e.group.position.z + 0.7);
  });
  await page.waitForSelector('#screen-gameover.visible', { timeout: 30000 });
  const go2 = await page.evaluate(() => ({
    score: Number(document.getElementById('go-score').textContent),
    best: Number(document.getElementById('go-best').textContent),
    isRecord: !document.getElementById('go-record').classList.contains('hidden'),
    savedBest: Number(localStorage.getItem('oaw_best')),
  }));
  check(go2.score < go1.score && go2.best === go1.score && go2.savedBest === go1.score && !go2.isRecord, 'récord persiste tras retry con menor puntuación (' + go2.best + ')');

  if (errors.length) {
    console.error('ERRORES DE CONSOLA:\n' + errors.join('\n'));
    failures += 1;
  }
  if (failures === 0) console.log('HORDES OK');
  else process.exitCode = 1;
} finally {
  await browser.close();
}
