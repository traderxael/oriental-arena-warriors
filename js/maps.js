/* ============================================================
   maps.js — Construcción de mapas/arenas

   Interfaz pública:
     Maps.build(id, scene, renderer) -> {
       name: string,
       root: THREE.Group,
       bounds: { minX, maxX, minZ, maxZ },
       spawnPoints: THREE.Vector3[],
       radius: 38,
       flames: THREE.Mesh[],        // conos de llama (userData.isFlame) para animar
       flickerLights: THREE.PointLight[],
     }

     Maps.dispose(scene, built) libera el mapa al seleccionar otra arena.

   El Coliseo es circular: la colisión de jugador/enemigo debe usar
   `radius` (distancia al origen en XZ), no `bounds` (caja envolvente).
   Los props se cargan como GLB commiteados en assets/props/ vía
   Assets.loadGLB; si el GLB falta o falla, se usa un builder
   procedural equivalente y el juego funciona igual.
   ============================================================ */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Assets } from './assets.js';
import { Textures } from './textures.js';

const RADIUS = 38;
const PILLAR_RING = 34;
const PILLAR_COUNT = 16;
const WALL_HEIGHT = 6;
const GATE_ANGLES = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
const GATE_HALF_GAP = 0.087; // ~5° — hueco de puerta en el muro

/* ---------- Materiales y helpers ---------- */

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05, ...opts });
}

function shadowed(mesh, cast = true, receive = true) {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

/** Escala/posiciona un objeto cargado para que su base quede en y=0 y su altura sea `targetHeight`. */
function placeOnGround(obj, x, z, targetHeight) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  if (size.y > 0.0001 && targetHeight) {
    const s = targetHeight / size.y;
    obj.scale.setScalar(s);
    box.setFromObject(obj);
  }
  obj.position.set(x, -box.min.y, z);
  return obj;
}

/* ---------- Builders procedurales de fallback ---------- */

function buildProceduralTorch() {
  const g = new THREE.Group();
  g.name = 'fallback:torch';
  const pole = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.21, 2.6, 10), std('#3d2f23', { roughness: 0.8 })));
  pole.position.y = 1.3;
  const bowl = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.26, 0.42, 12), std('#241a12', { roughness: 0.6, metalness: 0.35 })));
  bowl.position.y = 2.78;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.06, 8, 16), std('#1a120c', { roughness: 0.5, metalness: 0.4 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 2.99;
  g.add(pole, bowl, rim);
  return g;
}

function buildProceduralArch() {
  const g = new THREE.Group();
  g.name = 'fallback:arch';
  const arch = shadowed(new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.48, 8, 24, Math.PI), std('#b9a982')));
  arch.position.y = 0;
  const lintel = shadowed(new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.55, 1.0), std('#a0342c', { roughness: 0.75 })));
  lintel.position.y = 0.35;
  const gold = new THREE.Mesh(new THREE.BoxGeometry(7.7, 0.14, 1.02), std('#d4af37', { roughness: 0.45, metalness: 0.6 }));
  gold.position.y = 0.68;
  g.add(arch, lintel, gold);
  return g;
}

function buildProceduralCherry() {
  const g = new THREE.Group();
  g.name = 'fallback:cherry';
  const trunk = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.4, 2.8, 8), std('#4a3220', { roughness: 0.9 })));
  trunk.position.y = 1.4;
  g.add(trunk);
  const bloom = std('#e8a7b8', { roughness: 0.95 });
  [[0, 3.6, 0, 1.7], [1.1, 3.1, 0.5, 1.2], [-1.0, 3.2, -0.6, 1.25]].forEach(([x, y, z, r]) => {
    const puff = shadowed(new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), bloom));
    puff.position.set(x, y, z);
    g.add(puff);
  });
  return g;
}

function buildProceduralColumn() {
  const g = new THREE.Group();
  g.name = 'fallback:column';
  const shaft = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 4.4, 12), std('#cbbd9d')));
  shaft.position.y = 2.3;
  const base = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.35, 1.3), std('#a1937a')));
  base.position.y = 0.17;
  const cap = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 1.2), std('#a1937a')));
  cap.position.y = 4.65;
  g.add(shaft, base, cap);
  return g;
}

function addBox(root, width, height, depth, color, x, y, z, options = {}) {
  const mesh = shadowed(new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    std(color, options.material || {})
  ), options.castShadow !== false, options.receiveShadow !== false);
  mesh.position.set(x, y, z);
  if (options.rotationY) mesh.rotation.y = options.rotationY;
  root.add(mesh);
  return mesh;
}

function addCylinder(root, top, bottom, height, color, x, y, z, segments = 10) {
  const mesh = shadowed(new THREE.Mesh(
    new THREE.CylinderGeometry(top, bottom, height, segments), std(color)
  ));
  mesh.position.set(x, y, z);
  root.add(mesh);
  return mesh;
}

function appendBoxPart(parts, width, height, depth, x, y, z, rotationY = 0) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const matrix = new THREE.Matrix4().makeRotationY(rotationY);
  matrix.setPosition(x, y, z);
  geometry.applyMatrix4(matrix);
  parts.push(geometry);
}

function appendMergedParts(root, parts, material) {
  if (!parts.length) return null;
  const geometry = mergeGeometries(parts);
  parts.forEach((part) => part.dispose());
  const mesh = shadowed(new THREE.Mesh(geometry, material));
  root.add(mesh);
  return mesh;
}

function addArenaFloor(root, radius, color, texture, ringColor) {
  const ground = shadowed(new THREE.Mesh(
    new THREE.CircleGeometry(radius, 64), std(color, { roughness: 1, map: texture })
  ), false, true);
  ground.rotation.x = -Math.PI / 2;
  root.add(ground);
  const outer = new THREE.Mesh(new THREE.CircleGeometry(260, 32), std('#34332f', { roughness: 1 }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.04;
  root.add(outer);
  const borderGeo = new THREE.RingGeometry(radius - 0.8, radius, 64);
  borderGeo.rotateX(-Math.PI / 2);
  const border = new THREE.Mesh(borderGeo, std(ringColor, { metalness: 0.22, roughness: 0.55 }));
  border.position.y = 0.025;
  root.add(border);
}

function addLanterns(root, positions, scale = 1) {
  const parts = [
    { geometry: new THREE.BoxGeometry(0.9, 0.3, 0.9), material: std('#514638'), y: 0.15 },
    { geometry: new THREE.CylinderGeometry(0.12, 0.17, 1.55, 8), material: std('#594b3b'), y: 1.05 },
    { geometry: new THREE.BoxGeometry(0.8, 0.75, 0.8), material: std('#e5c984', { emissive: '#e9a849', emissiveIntensity: 0.38, roughness: 0.72 }), y: 2.15, cast: false },
    { geometry: new THREE.BoxGeometry(1.04, 0.16, 1.04), material: std('#382a20'), y: 2.61 },
    { geometry: new THREE.BoxGeometry(1.28, 0.18, 1.28), material: std('#4c3328'), y: 2.79 },
    { geometry: new THREE.CylinderGeometry(0, 0.12, 0.42, 4), material: std('#4c3328'), y: 3.08 },
  ];
  parts.forEach((part) => {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, positions.length);
    mesh.castShadow = part.cast !== false;
    mesh.receiveShadow = part.cast !== false;
    positions.forEach(([x, z], index) => {
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(x, part.y * scale, z),
        new THREE.Quaternion(),
        new THREE.Vector3(scale, scale, scale)
      );
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    root.add(mesh);
  });
}

function addTorii(root, z, scale = 1) {
  const half = 4.1 * scale;
  const redParts = [];
  appendBoxPart(redParts, 0.62 * scale, 6.1 * scale, 0.62 * scale, -half, 3.05 * scale, z);
  appendBoxPart(redParts, 0.62 * scale, 6.1 * scale, 0.62 * scale, half, 3.05 * scale, z);
  appendBoxPart(redParts, 11.4 * scale, 0.65 * scale, 1.0 * scale, 0, 6.35 * scale, z);
  appendMergedParts(root, redParts, std('#a0342c'));
  const goldParts = [];
  appendBoxPart(goldParts, 9.6 * scale, 0.26 * scale, 1.12 * scale, 0, 5.86 * scale, z);
  appendMergedParts(root, goldParts, std('#d4af37', { metalness: 0.25 }));
  return [
    { x: -half, z, r: 0.72 * scale },
    { x: half, z, r: 0.72 * scale },
  ];
}

function addPagodaBuilding(root, x, z, baseY = 0, scale = 1, palette = {}) {
  const wood = palette.wood || '#53352d';
  const roof = palette.roof || '#a0342c';
  const gold = palette.gold || '#d4af37';
  const levels = [
    { y: 1.4, w: 7.0, h: 1.2 },
    { y: 4.2, w: 5.6, h: 1.05 },
    { y: 6.75, w: 4.2, h: 0.95 },
    { y: 9.0, w: 2.8, h: 0.8 },
  ];
  addBox(root, 6.2 * scale, 0.75 * scale, 6.2 * scale, '#82735d', x, baseY + 0.38 * scale, z);
  const woodParts = [];
  const goldParts = [];
  const roofParts = [];
  levels.forEach(({ y, w, h }, index) => {
    const sy = baseY + y * scale;
    const width = w * scale;
    const body = width * 0.68;
    appendBoxPart(woodParts, body, h * scale, body, x, sy, z);
    [-1, 1].forEach((side) => {
      appendBoxPart(goldParts, 0.12 * scale, h * 0.85 * scale, body + 0.1 * scale, x + side * body * 0.47, sy, z);
      appendBoxPart(goldParts, body + 0.1 * scale, h * 0.85 * scale, 0.12 * scale, x, sy, z + side * body * 0.47);
    });
    const roofGeometry = new THREE.CylinderGeometry(width * 0.58, width * 0.78, 0.48 * scale, 4);
    const roofMatrix = new THREE.Matrix4().makeRotationY(Math.PI / 4);
    roofMatrix.setPosition(x, sy + h * 0.62 * scale, z);
    roofGeometry.applyMatrix4(roofMatrix);
    roofParts.push(roofGeometry);
    appendBoxPart(goldParts, width * 0.84, 0.12 * scale, width * 0.84, x, sy + h * 0.42 * scale, z);
    if (index === levels.length - 1) {
      addCylinder(root, 0.04 * scale, 0.14 * scale, 1.7 * scale, gold, x, sy + 1.05 * scale, z, 6);
    }
  });
  appendMergedParts(root, woodParts, std(wood));
  appendMergedParts(root, goldParts, std(gold, { metalness: 0.35 }));
  appendMergedParts(root, roofParts, std(roof, { roughness: 0.64, metalness: 0.08 }));
}

function addColumns(root, positions, scale = 1) {
  const parts = [
    { geometry: new THREE.BoxGeometry(1.3, 0.35, 1.3), material: std('#a1937a'), y: 0.175 },
    { geometry: new THREE.CylinderGeometry(0.42, 0.52, 4.4, 12), material: std('#cbbd9d'), y: 2.3 },
    { geometry: new THREE.BoxGeometry(1.2, 0.35, 1.2), material: std('#a1937a'), y: 4.65 },
  ];
  parts.forEach((part) => {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, positions.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    positions.forEach(([x, z], index) => {
      mesh.setMatrixAt(index, new THREE.Matrix4().compose(
        new THREE.Vector3(x, part.y * scale, z),
        new THREE.Quaternion(),
        new THREE.Vector3(scale, scale, scale)
      ));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    root.add(mesh);
  });
}

function addSharedLighting(scene, root, renderer, theme) {
  scene.background = new THREE.Color(theme.background);
  scene.fog = new THREE.Fog(theme.fog, theme.fogNear || 78, theme.fogFar || 220);
  const sky = new Sky();
  sky.scale.setScalar(4500);
  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = theme.turbidity || 6;
  uniforms.rayleigh.value = theme.rayleigh || 1.8;
  uniforms.mieCoefficient.value = 0.005;
  uniforms.mieDirectionalG.value = 0.8;
  const sunPosition = new THREE.Vector3(...(theme.sunPosition || [34, 46, 20])).normalize();
  uniforms.sunPosition.value.copy(sunPosition);
  root.add(sky);

  let environment = null;
  if (renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const skyScene = new THREE.Scene();
    skyScene.add(sky.clone());
    environment = pmrem.fromScene(skyScene, 0, 0.1, 10000).texture;
    scene.environment = environment;
    pmrem.dispose();
  }
  root.add(new THREE.HemisphereLight(theme.hemisphere || '#fff3d6', theme.ground || '#50483f', 0.9));
  const sun = new THREE.DirectionalLight(theme.sun || '#ffe6b3', 1.65);
  sun.position.copy(sunPosition.clone().multiplyScalar(72));
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -48;
  sun.shadow.camera.right = 48;
  sun.shadow.camera.top = 48;
  sun.shadow.camera.bottom = -48;
  sun.shadow.camera.far = 130;
  sun.shadow.bias = -0.0005;
  root.add(sun);
  const fill = new THREE.DirectionalLight(theme.fill || '#ffd9a8', 0.42);
  fill.position.set(-18, 14, -24);
  root.add(fill);
  return { sun, environment };
}

function loadProp(root, path, fallbackBuilder, x, z, targetHeight) {
  Assets.loadGLB(path, fallbackBuilder).then((obj) => {
    if (root.userData.mapDisposed) {
      Assets.disposeObject(obj);
      return;
    }
    root.add(placeOnGround(obj, x, z, targetHeight));
  });
}

function finishArena(scene, root, renderer, name, spawnPoints, obstacles, theme, extras = {}) {
  const lighting = addSharedLighting(scene, root, renderer, theme);
  scene.add(root);
  return {
    name,
    root,
    environment: lighting.environment,
    sun: lighting.sun,
    bounds: { minX: -RADIUS, maxX: RADIUS, minZ: -RADIUS, maxZ: RADIUS },
    radius: RADIUS,
    spawnPoints,
    obstacles,
    flames: [],
    flickerLights: [],
    ...extras,
  };
}

/* ---------- Construcción del Coliseo ---------- */

const Maps = {
  /**
   * Construye el Coliseo del Sol Naciente y lo añade a `scene`.
   * Síncrono para la estructura; los props GLB se añaden cuando cargan
   * (o caen a su fallback procedural vía Assets.loadGLB).
   */
  buildColosseum(scene, renderer) {
    const root = new THREE.Group();
    root.name = 'colosseum';
    root.userData.mapDisposed = false;
    const flames = [];
    const flickerLights = [];

    // --- Suelo: círculo de arena + anillos oscuros + emblema central ---
    const floor = shadowed(new THREE.Mesh(new THREE.CircleGeometry(RADIUS + 12, 72), std('#c9a86a', { roughness: 1, map: Textures.sand(10, 10) })), false, true);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    root.add(floor);

    const ringParts = [10, 19, 28].map((r, i) => {
      const g = new THREE.RingGeometry(r, r + 1.5, 64);
      g.rotateX(-Math.PI / 2);
      g.translate(0, 0.01 + i * 0.001, 0);
      return g;
    });
    const mergedRings = new THREE.Mesh(mergeGeometries(ringParts), std('#8a6f47'));
    mergedRings.receiveShadow = true;
    ringParts.forEach((g) => g.dispose());
    root.add(mergedRings);

    const center = new THREE.Mesh(new THREE.CircleGeometry(4.4, 48), std('#a0342c', { roughness: 0.85 }));
    center.rotation.x = -Math.PI / 2;
    center.position.y = 0.02;
    center.receiveShadow = true;
    const centerRing = new THREE.Mesh(new THREE.RingGeometry(4.4, 5.15, 48), std('#d4af37', { roughness: 0.5, metalness: 0.35 }));
    centerRing.rotation.x = -Math.PI / 2;
    centerRing.position.y = 0.03;
    root.add(center, centerRing);

    // Plano exterior oscuro hasta el horizonte
    const outer = new THREE.Mesh(new THREE.CircleGeometry(260, 32), std('#33302a', { roughness: 1 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.02;
    root.add(outer);

    // --- Muro perimetral: cilindro abierto con 3 huecos (puertas) ---
    const wallMat = std('#b9a982', { side: THREE.DoubleSide, map: Textures.stone(12, 2) });
    const arcLen = (2 * Math.PI) / 3 - 2 * GATE_HALF_GAP;
    GATE_ANGLES.forEach((a) => {
      const seg = shadowed(new THREE.Mesh(
        new THREE.CylinderGeometry(RADIUS, RADIUS, WALL_HEIGHT, 48, 1, true, a + GATE_HALF_GAP, arcLen),
        wallMat
      ));
      seg.position.y = WALL_HEIGHT / 2;
      root.add(seg);
    });
    // Cornisa superior del muro (anillo plano de toro)
    const rim = new THREE.Mesh(new THREE.TorusGeometry(RADIUS, 0.32, 6, 72), std('#a1937a'));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = WALL_HEIGHT + 0.05;
    rim.castShadow = true;
    root.add(rim);

    // --- Gradas exteriores: 3 anillos de cajas, escalonadas sobre el muro ---
    const gradas = [
      { r: RADIUS + 3.2, h: 7.5, n: 28, color: '#8f8272' },
      { r: RADIUS + 6.6, h: 9.5, n: 33, color: '#7d7264' },
      { r: RADIUS + 10.0, h: 11.5, n: 38, color: '#6e6559' },
    ];
    gradas.forEach(({ r, h, n, color }) => {
      const chord = 2 * r * Math.sin(Math.PI / n) - 0.6;
      const parts = [];
      const m = new THREE.Matrix4();
      for (let i = 0; i < n; i += 1) {
        const a = (i / n) * Math.PI * 2;
        const geo = new THREE.BoxGeometry(chord, h, 2.5);
        m.makeRotationY(a);
        m.setPosition(r * Math.sin(a), h / 2 - 0.15, r * Math.cos(a));
        geo.applyMatrix4(m);
        parts.push(geo);
      }
      const merged = shadowed(new THREE.Mesh(mergeGeometries(parts), std(color, { map: Textures.stone(6, 2) })));
      parts.forEach((g) => g.dispose());
      root.add(merged);
    });

    // --- 2 niveles de arcadas: pilares + arcos de toro medio ---
    const chord = 2 * PILLAR_RING * Math.sin(Math.PI / PILLAR_COUNT);
    const arcR = chord / 2;
    const midAngles = [];
    for (let i = 0; i < PILLAR_COUNT; i += 1) {
      midAngles.push(((i + 0.5) / PILLAR_COUNT) * Math.PI * 2);
    }

    const levels = [
      { pillarH: 4.6, pillarW: 1.35, tube: 0.44, baseY: 0, color: '#cbbd9d' },
      { pillarH: 3.4, pillarW: 1.05, tube: 0.34, baseY: 4.6, color: '#c0b28e' },
    ];
    levels.forEach(({ pillarH, pillarW, tube, baseY, color }) => {
      const parts = [];
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const one = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < PILLAR_COUNT; i += 1) {
        const a = (i / PILLAR_COUNT) * Math.PI * 2;
        const geo = new THREE.BoxGeometry(pillarW, pillarH, pillarW);
        q.setFromAxisAngle(up, a);
        m.compose(new THREE.Vector3(PILLAR_RING * Math.sin(a), baseY + pillarH / 2, PILLAR_RING * Math.cos(a)), q, one);
        geo.applyMatrix4(m);
        parts.push(geo);
      }
      midAngles.forEach((a) => {
        const geo = new THREE.TorusGeometry(arcR, tube, 8, 22, Math.PI);
        q.setFromAxisAngle(up, a + Math.PI / 2);
        m.compose(new THREE.Vector3(PILLAR_RING * Math.sin(a), baseY + pillarH, PILLAR_RING * Math.cos(a)), q, one);
        geo.applyMatrix4(m);
        parts.push(geo);
      });
      const merged = shadowed(new THREE.Mesh(mergeGeometries(parts), std(color, { map: Textures.stone(3, 2) })));
      parts.forEach((g) => g.dispose());
      root.add(merged);
    });

    // --- Puertas: principal + 2 laterales (con spawnPoints, geometrías fusionadas) ---
    const spawnPoints = [];
    const jambParts = [];
    const doorParts = [];
    const trimParts = [];
    const tmpM = new THREE.Matrix4();
    const tmpQ = new THREE.Quaternion();
    const upY = new THREE.Vector3(0, 1, 0);
    const unitS = new THREE.Vector3(1, 1, 1);
    GATE_ANGLES.forEach((a, idx) => {
      const isMain = idx === 0;
      const gateColor = isMain ? '#a0342c' : '#8c3a30';
      const sinA = Math.sin(a);
      const cosA = Math.cos(a);
      const inward = a + Math.PI;

      // Jambas de piedra flanqueando el hueco
      [-1, 1].forEach((side) => {
        const jambAngle = a + side * 0.115;
        const jg = new THREE.BoxGeometry(1.7, 5.4, 1.7);
        tmpQ.setFromAxisAngle(upY, jambAngle);
        tmpM.compose(new THREE.Vector3(RADIUS * Math.sin(jambAngle), 2.7, RADIUS * Math.cos(jambAngle)), tmpQ, unitS);
        jg.applyMatrix4(tmpM);
        jambParts.push(jg);
      });

      // Oscuridad interior de la puerta (plano que mira al centro)
      const dg = new THREE.PlaneGeometry(6.6, 4.8);
      tmpQ.setFromAxisAngle(upY, inward);
      tmpM.compose(new THREE.Vector3((RADIUS + 0.05) * sinA, 2.4, (RADIUS + 0.05) * cosA), tmpQ, unitS);
      dg.applyMatrix4(tmpM);
      doorParts.push(dg);

      // Dintel de lacre con filete dorado
      const lintel = shadowed(new THREE.Mesh(new THREE.BoxGeometry(8.0, 0.85, 1.9), std(gateColor, { roughness: 0.7 })));
      lintel.position.set(RADIUS * sinA, 5.15, RADIUS * cosA);
      lintel.rotation.y = a;
      root.add(lintel);

      const tg = new THREE.BoxGeometry(8.1, 0.16, 1.92);
      tmpQ.setFromAxisAngle(upY, a);
      tmpM.compose(new THREE.Vector3(RADIUS * sinA, 5.62, RADIUS * cosA), tmpQ, unitS);
      tg.applyMatrix4(tmpM);
      trimParts.push(tg);

      // Punto de aparición dentro de la arena, frente a cada puerta
      spawnPoints.push(new THREE.Vector3((RADIUS - 6) * sinA, 0, (RADIUS - 6) * cosA));
    });
    root.add(shadowed(new THREE.Mesh(mergeGeometries(jambParts), std('#a1937a'))));
    root.add(new THREE.Mesh(mergeGeometries(doorParts), new THREE.MeshBasicMaterial({ color: '#0d0b09' })));
    root.add(new THREE.Mesh(mergeGeometries(trimParts), std('#d4af37', { roughness: 0.4, metalness: 0.6 })));
    jambParts.forEach((g) => g.dispose());
    doorParts.forEach((g) => g.dispose());
    trimParts.forEach((g) => g.dispose());

    // Puerta principal: intentar arco GLB decorativo (fallback: arco procedural)
    Assets.loadGLB('assets/props/arch.glb', buildProceduralArch).then((arch) => {
      if (root.userData.mapDisposed) {
        Assets.disposeObject(arch);
        return;
      }
      arch.scale.setScalar(1);
      const box = new THREE.Box3().setFromObject(arch);
      const w = box.getSize(new THREE.Vector3()).x;
      if (w > 0.001) arch.scale.setScalar(7.4 / w);
      arch.position.set(0, 5.7, RADIUS - 0.6);
      arch.rotation.y = Math.PI;
      root.add(arch);
    }).catch(() => {
      // loadGLB nunca rechaza; defensa en profundidad
      if (root.userData.mapDisposed) return;
      const arch = buildProceduralArch();
      arch.position.set(0, 5.7, RADIUS - 0.6);
      arch.rotation.y = Math.PI;
      root.add(arch);
    });

    // --- 2 antorchas flanqueando la puerta principal ---
    [-0.38, 0.38].forEach((offset, i) => {
      const a = offset;
      const r = RADIUS - 7;
      const x = r * Math.sin(a);
      const z = r * Math.cos(a);
      const phase = i * 2.13;

      // Poste/peana: GLB si carga, fallback procedural si no
      loadProp(root, 'assets/props/torch.glb', buildProceduralTorch, x, z, 2.9);

      // Llama: cono animado + PointLight (siempre procedural)
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.34, 0.95, 10),
        new THREE.MeshStandardMaterial({ color: '#ffb03a', emissive: '#ff6a1f', emissiveIntensity: 1.8, roughness: 0.4 })
      );
      flame.position.set(x, 3.45, z);
      flame.userData.isFlame = true;
      flame.userData.phase = phase;
      root.add(flame);
      flames.push(flame);

      const light = new THREE.PointLight('#ff8c3a', 1.9, 17, 2);
      light.position.set(x, 3.7, z);
      light.userData.isFlicker = true;
      light.userData.phase = phase;
      light.userData.baseIntensity = 1.9;
      root.add(light);
      flickerLights.push(light);
    });

    // --- Vegetación y columnas: GLBs commiteados que antes no se instanciaban ---
    const obstacles = [];
    [Math.PI / 3, Math.PI, (5 * Math.PI) / 3].forEach((a) => {
      const x = 35 * Math.sin(a);
      const z = 35 * Math.cos(a);
      obstacles.push({ x, z, r: 1.3 });
      loadProp(root, 'assets/props/cherry-tree.glb', buildProceduralCherry, x, z, 6.5);
    });
    GATE_ANGLES.forEach((a) => {
      [-0.22, 0.22].forEach((off) => {
        const ja = a + off;
        const x = 36 * Math.sin(ja);
        const z = 36 * Math.cos(ja);
        obstacles.push({ x, z, r: 0.8 });
        loadProp(root, 'assets/props/column.glb', buildProceduralColumn, x, z, 5.2);
      });
    });

    // --- Cielo físico (Sky addon) + environment map para metales ---
    const lighting = addSharedLighting(scene, root, renderer, {
      background: '#efd9a7', fog: '#e8c98f', hemisphere: '#fff3d6', ground: '#5a4632',
      sun: '#ffe6b3', fill: '#ffd9a8', sunPosition: [34, 46, 20],
    });
    const sun = lighting.sun;
    // Relleno cálido desde el interior de la arena hacia la puerta principal:
    // el arch.glb mira a -z (de cara al jugador) y el sol queda a sus espaldas;
    // sin esta luz la cara del arco se ve casi negra de frente. Sin sombras.
    const archFill = new THREE.DirectionalLight('#ffd9a8', 0.65);
    archFill.position.set(0, 11, -30); // brilla hacia +z (dirección por defecto hacia el origen)
    root.add(archFill);

    scene.add(root);

    return {
      bounds: { minX: -RADIUS, maxX: RADIUS, minZ: -RADIUS, maxZ: RADIUS },
      spawnPoints,
      radius: RADIUS,
      flames,
      flickerLights,
      obstacles,
      sun,
      root,
      environment: lighting.environment,
      name: 'Coliseo del Sol Naciente',
    };
  },
  buildTemple(scene, renderer) {
    const root = new THREE.Group();
    root.name = 'temple-courtyard';
    root.userData.mapDisposed = false;
    addArenaFloor(root, RADIUS, '#91866b', Textures.stone(9, 9), '#b89a59');

    const path = addBox(root, 6.4, 0.08, 54, '#b9a982', 0, 0.06, 0);
    path.material.map = Textures.stone(2, 12);
    path.material.needsUpdate = true;
    const dais = new THREE.Mesh(new THREE.CircleGeometry(7.6, 48), std('#756951'));
    dais.rotation.x = -Math.PI / 2;
    dais.position.y = 0.09;
    root.add(dais);
    const emblemGeo = new THREE.RingGeometry(7.7, 8.1, 48);
    emblemGeo.rotateX(-Math.PI / 2);
    const emblem = new THREE.Mesh(emblemGeo, std('#d4af37', { metalness: 0.35 }));
    emblem.position.y = 0.1;
    root.add(emblem);

    addPagodaBuilding(root, 0, 29, 0, 0.72, {
      wood: '#72563c', roof: '#873d32', gold: '#c6a256',
    });
    const obstacles = [{ x: 0, z: 29, r: 4.9 }, ...addTorii(root, -33, 0.7)];
    const lanternPositions = [[-15, -12], [15, -12], [-15, 12], [15, 12]];
    addLanterns(root, lanternPositions, 0.64);
    lanternPositions.forEach(([x, z]) => {
      obstacles.push({ x, z, r: 0.8 });
    });
    const columnPositions = [[-31, -11], [31, -11], [-31, 11], [31, 11]];
    addColumns(root, columnPositions, 0.95);
    columnPositions.forEach(([x, z]) => {
      obstacles.push({ x, z, r: 0.9 });
    });

    const spawns = [
      new THREE.Vector3(-25, 0, 17), new THREE.Vector3(25, 0, 17),
      new THREE.Vector3(-25, 0, -17), new THREE.Vector3(25, 0, -17),
    ];
    return finishArena(scene, root, renderer, 'Templo de los Cuatro Vientos', spawns, obstacles, {
      background: '#b8c5bd', fog: '#a9b9ad', hemisphere: '#eff4df', ground: '#545c4a',
      sun: '#fff0c4', fill: '#e4d7ae', sunPosition: [28, 48, 18], turbidity: 7,
    });
  },
  buildPagoda(scene, renderer) {
    const root = new THREE.Group();
    root.name = 'pagoda-terrace';
    root.userData.mapDisposed = false;
    addArenaFloor(root, RADIUS, '#777a75', Textures.stone(12, 12), '#c5a857');
    const ringParts = [12, 22, 31].map((r) => {
      const geometry = new THREE.RingGeometry(r, r + 0.36, 64);
      geometry.rotateX(-Math.PI / 2);
      return geometry;
    });
    const rings = new THREE.Mesh(mergeGeometries(ringParts), std('#bca46a', { metalness: 0.24 }));
    rings.position.y = 0.04;
    rings.receiveShadow = true;
    ringParts.forEach((geometry) => geometry.dispose());
    root.add(rings);

    addPagodaBuilding(root, 0, 29, 0, 0.76, {
      wood: '#454842', roof: '#31554e', gold: '#d3b15f',
    });
    const obstacles = [{ x: 0, z: 29, r: 5.2 }];
    const gate = addTorii(root, -32, 0.66);
    gate.forEach((obstacle) => obstacles.push(obstacle));
    const lanternPositions = [[-13, 22], [13, 22], [-13, -10], [13, -10]];
    addLanterns(root, lanternPositions, 0.58);
    lanternPositions.forEach(([x, z]) => {
      obstacles.push({ x, z, r: 0.72 });
    });
    const columnPositions = [[-31, 0], [31, 0], [0, -33]];
    addColumns(root, columnPositions, 1.02);
    columnPositions.forEach(([x, z]) => {
      obstacles.push({ x, z, r: 0.8 });
    });
    const spawns = [
      new THREE.Vector3(-23, 0, 23), new THREE.Vector3(23, 0, 23),
      new THREE.Vector3(-23, 0, -23), new THREE.Vector3(23, 0, -23),
    ];
    return finishArena(scene, root, renderer, 'Pagoda de la Niebla', spawns, obstacles, {
      background: '#a8b9c2', fog: '#92a5af', hemisphere: '#e7f0ea', ground: '#46535a',
      sun: '#f4ddb1', fill: '#c8d9d2', sunPosition: [-28, 44, 22], turbidity: 8, rayleigh: 2.2,
    });
  },
  buildGardens(scene, renderer) {
    const root = new THREE.Group();
    root.name = 'zen-gardens';
    root.userData.mapDisposed = false;
    addArenaFloor(root, RADIUS, '#81966a', Textures.sand(9, 9), '#d2bb83');

    addBox(root, 5.2, 0.09, 48, '#b6aa8c', 0, 0.06, 0, {
      material: { roughness: 1, map: Textures.stone(2, 9) },
    });
    addBox(root, 48, 0.09, 5.2, '#b6aa8c', 0, 0.065, 0, {
      material: { roughness: 1, map: Textures.stone(9, 2) },
    });
    [[-8, -7], [8, -7], [-8, 7], [8, 7]].forEach(([x, z], index) => {
      const stone = shadowed(new THREE.Mesh(
        new THREE.CylinderGeometry(1.6, 1.85, 0.18, 7), std(index % 2 ? '#777968' : '#918a70')
      ));
      stone.position.set(x, 0.12, z);
      root.add(stone);
    });

    const pond = shadowed(new THREE.Mesh(
      new THREE.CircleGeometry(4.6, 40), new THREE.MeshStandardMaterial({
        color: '#4a7b80', roughness: 0.28, metalness: 0.18, transparent: true, opacity: 0.94,
      })
    ), false, false);
    pond.rotation.x = -Math.PI / 2;
    pond.scale.set(1.25, 0.82, 1);
    pond.position.set(22, 0.035, -20);
    root.add(pond);
    const pondEdgeGeo = new THREE.RingGeometry(4.6, 5.25, 40);
    pondEdgeGeo.rotateX(-Math.PI / 2);
    const pondEdge = new THREE.Mesh(pondEdgeGeo, std('#817966'));
    pondEdge.scale.set(1.25, 0.82, 1);
    pondEdge.position.set(22, 0.04, -20);
    root.add(pondEdge);
    addBox(root, 9.5, 0.24, 1.7, '#6b4a2f', 22, 0.32, -20);
    addBox(root, 9.5, 0.14, 0.18, '#a08056', 22, 0.75, -21.1);
    addBox(root, 9.5, 0.14, 0.18, '#a08056', 22, 0.75, -18.9);

    const obstacles = [
      ...addTorii(root, 33, 0.56),
      { x: 22, z: -20, r: 4.3 },
    ];
    [[-30, -14], [30, -14], [-30, 14], [30, 14]].forEach(([x, z]) => {
      loadProp(root, 'assets/props/cherry-tree.glb', buildProceduralCherry, x, z, 6.5);
      obstacles.push({ x, z, r: 1.65 });
    });
    const lanternPositions = [[-15, 24], [15, 24], [-15, -24], [15, -24]];
    addLanterns(root, lanternPositions, 0.55);
    lanternPositions.forEach(([x, z]) => {
      obstacles.push({ x, z, r: 0.72 });
    });
    const spawns = [
      new THREE.Vector3(-29, 0, 0), new THREE.Vector3(29, 0, 0),
      new THREE.Vector3(0, 0, -29), new THREE.Vector3(0, 0, 29),
    ];
    return finishArena(scene, root, renderer, 'Jardines del Ciruelo', spawns, obstacles, {
      background: '#bdc49b', fog: '#a9b78b', hemisphere: '#f3f4d9', ground: '#455b43',
      sun: '#fff0c4', fill: '#d7e2ae', sunPosition: [24, 50, -18], turbidity: 5.5,
    });
  },
  build(id, scene, renderer) {
    const builders = {
      coliseo: Maps.buildColosseum,
      templo: Maps.buildTemple,
      pagoda: Maps.buildPagoda,
      jardines: Maps.buildGardens,
    };
    return (builders[id] || Maps.buildColosseum)(scene, renderer);
  },
  getName(id) {
    const names = {
      coliseo: 'Coliseo del Sol Naciente',
      templo: 'Templo de los Cuatro Vientos',
      pagoda: 'Pagoda de la Niebla',
      jardines: 'Jardines del Ciruelo',
    };
    return names[id] || names.coliseo;
  },
  dispose(scene, built) {
    if (!built) return;
    if (built.root) {
      built.root.userData.mapDisposed = true;
      scene.remove(built.root);
      Assets.disposeObject(built.root);
    }
    if (built.environment) {
      if (scene.environment === built.environment) scene.environment = null;
      built.environment.dispose();
    }
  },
};

export { Maps };
export default Maps;

// Acceso global de sólo lectura para depuración y scripts clásicos futuros.
if (typeof window !== 'undefined') window.Maps = Maps;
