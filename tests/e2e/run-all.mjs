/* Ejecuta la suite E2E completa contra http://127.0.0.1:8123.
   Si el puerto 8123 no está ya servido (p. ej. `python -m http.server 8123`),
   levanta un servidor HTTP estático local y lo cierra al terminar. */
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = normalize(join(here, '..', '..'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

async function isServerUp() {
  try {
    const res = await fetch('http://127.0.0.1:8123/');
    return res.ok;
  } catch (_err) {
    return false;
  }
}

async function ensureServer() {
  if (await isServerUp()) return null;
  const server = http.createServer((req, res) => {
    try {
      const cleanUrl = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = cleanUrl === '/' ? 'index.html' : cleanUrl.replace(/^\/+/, '');
      const filePath = normalize(join(root, rel));
      if (!filePath.startsWith(root)) {
        res.writeHead(403).end();
        return;
      }
      const st = statSync(filePath);
      if (!st.isFile()) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': 'no-cache',
      });
      createReadStream(filePath).pipe(res);
    } catch (_err) {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(8123, '127.0.0.1', resolve);
  });
  return server;
}

function runScript(script) {
  return new Promise((resolve) => {
    console.log('\n=== E2E: ' + script + ' ===');
    const child = spawn(process.execPath, [join(here, script)], {
      cwd: root,
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code || 0));
  });
}

const server = await ensureServer();
const suites = ['smoke.mjs', 'hordes.mjs', 'modes.mjs', 'fallback.mjs', 'stress.mjs'];
let failed = 0;
try {
  for (const s of suites) {
    const code = await runScript(s);
    if (code !== 0) failed += 1;
  }
} finally {
  if (server) await new Promise((r) => server.close(r));
}

if (failed > 0) {
  console.error(`\nE2E FALLÓ (${failed}/${suites.length} suites con error).`);
  process.exit(1);
} else {
  console.log(`\nE2E COMPLETO OK (${suites.length}/${suites.length} suites verdes).`);
}
