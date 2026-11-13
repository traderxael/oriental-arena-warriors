/* Escenario E2E 5: Stress 10 s + presupuestos de rendimiento + auto-guard
   - 25 enemigos riggeados vivos durante 10 s reales en ?quality=baja&debug=stress
   - Presupuestos: triangles <= 350k, calls <= 160, mixers <= 26, textureMB <= 64
   - Auto-guard: ?quality=alta&autoguard=1 baja automáticamente un nivel tras 120 frames > 33 ms */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, 'shots');
mkdirSync(shots, { recursive: true });

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

  await page.goto('http://127.0.0.1:8123/?quality=baja&debug=stress&autostart=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__arena && window.__player, null, { timeout: 15000 });
  // Mientras SwiftShader decodifica los 4 GLBs riggeados, bajar resolución temporalmente
  // para no bloquear el hilo principal >8 s en rasterización por software; luego restaurar 1280x720.
  await page.evaluate(() => {
    window.__arena.renderer.setSize(160, 90, false);
  });
  await page.waitForFunction(
    () => window.__perf && window.__enemies && window.__enemies.length === 25 &&
          window.__enemies.every((e) => e.rig && !e.rig.isFallback) &&
          window.__player && window.__player.rig && !window.__player.rig.isFallback,
    null,
    { timeout: 25000 }
  );
  await page.evaluate(() => {
    window.__arena.renderer.setPixelRatio(1);
    window.__arena.renderer.setSize(1280, 720, false);
    window.__arena.camera.aspect = 1280 / 720;
    window.__arena.camera.updateProjectionMatrix();
  });

  // 10 segundos completos de simulación continua a 1280x720 con los 25 enemigos riggeados
  await page.waitForTimeout(10000);
  await page.screenshot({ path: join(shots, 'stress-25.png') });

  const perfBaja = await page.evaluate(() => window.__perf);
  console.log('PERF BAJA (10 s stress):', JSON.stringify(perfBaja));

  check(perfBaja.enemies === 25, '25 enemigos vivos tras 10 s (' + perfBaja.enemies + ')');
  check(perfBaja.triangles <= 350000, 'triángulos <= 350k (' + perfBaja.triangles + ')');
  check(perfBaja.calls <= 160, 'draw calls <= 160 (' + perfBaja.calls + ')');
  check(perfBaja.mixers <= 26, 'mixers <= 26 (' + perfBaja.mixers + ')');
  check(perfBaja.memory.textureMB <= 64, 'texturas decodificadas <= 64 MB (' + perfBaja.memory.textureMB + ' MB)');

  // Medir también calls/triangles en Alta (con Bloom + sombras 2048)
  await page.evaluate(() => window.__quality.set('alta'));
  await page.waitForTimeout(1500);
  const perfAlta = await page.evaluate(() => window.__perf);
  console.log('PERF ALTA (25 enemies):', JSON.stringify(perfAlta));
  check(perfAlta.triangles <= 350000, 'triángulos Alta <= 350k (' + perfAlta.triangles + ')');
  check(perfAlta.calls <= 160, 'draw calls Alta <= 160 (' + perfAlta.calls + ')');

  // Verificar auto-guard (>33 ms durante 120 frames seguidos -> baja de alta a media)
  await page.goto('http://127.0.0.1:8123/?quality=alta&autoguard=1&autostart=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__arena && window.__player && window.__perf, null, { timeout: 20000 });
  await page.evaluate(() => {
    const a = window.__arena;
    // Evitar que SwiftShader tarde 500 ms/frame en el pass de Bloom: simular un
    // render de 36 ms exactos para verificar la ventana de 120 frames en ~5.5 s.
    a.composer.render = function () {
      const end = performance.now() + 36;
      while (performance.now() < end) { /* >33 ms deterministas */ }
    };
  });
  await page.waitForFunction(
    () => window.__perf && window.__perf.autoDowngrades >= 1 && window.__quality.level === 'media',
    null,
    { timeout: 25000 }
  );
  const afterGuard = await page.evaluate(() => ({ level: window.__quality.level, downgrades: window.__perf.autoDowngrades }));
  check(afterGuard.level === 'media' && afterGuard.downgrades >= 1, 'auto-guard baja calidad de alta -> media tras 120 frames > 33 ms');

  writeFileSync(
    join(here, 'perf-evidence.json'),
    JSON.stringify({ timestamp: new Date().toISOString(), stress25Baja: perfBaja, stress25Alta: perfAlta, autoGuard: afterGuard }, null, 2) + '\n'
  );

  if (errors.length) {
    console.error('ERRORES DE CONSOLA:\n' + errors.join('\n'));
    failures += 1;
  }
  if (failures === 0) console.log('STRESS & PERF OK');
  else process.exitCode = 1;
} finally {
  await browser.close();
}
