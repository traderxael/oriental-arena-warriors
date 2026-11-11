/* ============================================================
   textures.js — Texturas procedurales por canvas (sin descargas)

   Interfaz pública:
     Textures.sand(rx, ry)   — arena del coliseo
     Textures.stone(rx, ry)  — muro, gradas, pilares
     Textures.wood(rx, ry)   — madera de puertas/props

   Cada combinación (tipo, repeat) se cachea: el mismo material puede
   pedir la textura varias veces sin regenerar el canvas. sRGB +
   RepeatWrapping + anisotropy 4 para que el suelo no se lave en rasante.
   ============================================================ */
import * as THREE from 'three';

const cache = new Map();

function makeCanvas(size, painter) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  painter(ctx, size);
  return canvas;
}

function speckle(ctx, size, colors, count, maxRadius) {
  for (let i = 0; i < count; i += 1) {
    ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
    ctx.globalAlpha = 0.12 + Math.random() * 0.25;
    const r = 0.5 + Math.random() * maxRadius;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function paintSand(ctx, size) {
  ctx.fillStyle = '#c9a86a';
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, ['#b28f52', '#dcb97c', '#a6834a', '#e4c68c'], 5200, 1.6);
  // Rastrillado circular suave (jardín zen)
  ctx.strokeStyle = 'rgba(140,110,66,0.16)';
  ctx.lineWidth = 2;
  for (let r = 24; r < size; r += 26) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function paintStone(ctx, size) {
  ctx.fillStyle = '#b9a982';
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, ['#a89873', '#c8b992', '#93845f'], 3600, 2.2);
  // Juntas de sillares
  ctx.strokeStyle = 'rgba(90,78,56,0.35)';
  ctx.lineWidth = 3;
  const rows = 4;
  const cols = 4;
  for (let y = 0; y <= rows; y += 1) {
    ctx.beginPath();
    ctx.moveTo(0, (y / rows) * size);
    ctx.lineTo(size, (y / rows) * size);
    ctx.stroke();
  }
  for (let y = 0; y < rows; y += 1) {
    const offset = (y % 2) * (size / cols / 2);
    for (let x = 0; x <= cols; x += 1) {
      const px = offset + (x / cols) * size;
      ctx.beginPath();
      ctx.moveTo(px, (y / rows) * size);
      ctx.lineTo(px, ((y + 1) / rows) * size);
      ctx.stroke();
    }
  }
}

function paintWood(ctx, size) {
  ctx.fillStyle = '#6b4a2f';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 90; i += 1) {
    ctx.strokeStyle = i % 3 === 0 ? 'rgba(46,30,18,0.35)' : 'rgba(122,88,56,0.3)';
    ctx.lineWidth = 1 + Math.random() * 2.5;
    const x = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + 8, size * 0.33, x - 8, size * 0.66, x + 4, size);
    ctx.stroke();
  }
  speckle(ctx, size, ['#4a3220', '#7d5a3a'], 900, 1.2);
}

const PAINTERS = { sand: paintSand, stone: paintStone, wood: paintWood };

function get(kind, rx, ry) {
  const key = kind + ':' + rx + ':' + ry;
  if (cache.has(key)) return cache.get(key);
  const tex = new THREE.CanvasTexture(makeCanvas(512, PAINTERS[kind]));
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.repeat.set(rx, ry);
  cache.set(key, tex);
  return tex;
}

const Textures = {
  sand: (rx = 10, ry = 10) => get('sand', rx, ry),
  stone: (rx = 8, ry = 2) => get('stone', rx, ry),
  wood: (rx = 1, ry = 1) => get('wood', rx, ry),
};

export { Textures };
export default Textures;