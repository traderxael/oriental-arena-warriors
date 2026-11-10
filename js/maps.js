/* ============================================================
   maps.js — Construcción de mapas/arenas

   Interfaz pública:
     Maps.buildColosseum(scene) -> {
       bounds: { minX, maxX, minZ, maxZ },
       spawnPoints: THREE.Vector3[],
       radius: 38,
       flames: THREE.Mesh[],        // conos de llama (userData.isFlame) para animar
       flickerLights: THREE.PointLight[],
     }

   El Coliseo es circular: la colisión de jugador/enemigo debe usar
   `radius` (distancia al origen en XZ), no `bounds` (caja envolvente).
   Los props se cargan como GLB commiteados en assets/props/ vía
   Assets.loadGLB; si el GLB falta o falla, se usa un builder
   procedural equivalente y el juego funciona igual.
   ============================================================ */
import * as THREE from 'three';
import { Assets } from './assets.js';

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

/* ---------- Construcción del Coliseo ---------- */

const Maps = {
  /**
   * Construye el Coliseo del Sol Naciente y lo añade a `scene`.
   * Síncrono para la estructura; los props GLB se añaden cuando cargan
   * (o caen a su fallback procedural vía Assets.loadGLB).
   */
  buildColosseum(scene) {
    const root = new THREE.Group();
    root.name = 'colosseum';
    const flames = [];
    const flickerLights = [];

    // --- Suelo: círculo de arena + anillos oscuros + emblema central ---
    const floor = shadowed(new THREE.Mesh(new THREE.CircleGeometry(RADIUS + 12, 72), std('#c9a86a', { roughness: 1 })), false, true);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    root.add(floor);

    [10, 19, 28].forEach((r, i) => {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 1.5, 64), std('#8a6f47'));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.01 + i * 0.001;
      ring.receiveShadow = true;
      root.add(ring);
    });

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
    const wallMat = std('#b9a982', { side: THREE.DoubleSide });
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
      for (let i = 0; i < n; i += 1) {
        const a = (i / n) * Math.PI * 2;
        const box = shadowed(new THREE.Mesh(new THREE.BoxGeometry(chord, h, 2.5), std(color)));
        box.position.set(r * Math.sin(a), h / 2 - 0.15, r * Math.cos(a));
        box.rotation.y = a;
        root.add(box);
      }
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
      const pillarGeo = new THREE.BoxGeometry(pillarW, pillarH, pillarW);
      for (let i = 0; i < PILLAR_COUNT; i += 1) {
        const a = (i / PILLAR_COUNT) * Math.PI * 2;
        const pillar = shadowed(new THREE.Mesh(pillarGeo, std(color)));
        pillar.position.set(PILLAR_RING * Math.sin(a), baseY + pillarH / 2, PILLAR_RING * Math.cos(a));
        pillar.rotation.y = a;
        root.add(pillar);
      }
      const arcGeo = new THREE.TorusGeometry(arcR, tube, 8, 22, Math.PI);
      midAngles.forEach((a) => {
        const arc = shadowed(new THREE.Mesh(arcGeo, std(color)));
        // El plano del arco contiene la cuerda (tangente) y es vertical
        arc.position.set(PILLAR_RING * Math.sin(a), baseY + pillarH, PILLAR_RING * Math.cos(a));
        arc.rotation.y = a + Math.PI / 2;
        root.add(arc);
      });
    });

    // --- Puertas: principal + 2 laterales (con spawnPoints) ---
    const spawnPoints = [];
    GATE_ANGLES.forEach((a, idx) => {
      const isMain = idx === 0;
      const gateColor = isMain ? '#a0342c' : '#8c3a30';
      const sinA = Math.sin(a);
      const cosA = Math.cos(a);
      const inward = a + Math.PI;

      // Jambas de piedra flanqueando el hueco
      [-1, 1].forEach((side) => {
        const jambAngle = a + side * 0.115;
        const jamb = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.7, 5.4, 1.7), std('#a1937a')));
        jamb.position.set(RADIUS * Math.sin(jambAngle), 2.7, RADIUS * Math.cos(jambAngle));
        jamb.rotation.y = jambAngle;
        root.add(jamb);
      });

      // Oscuridad interior de la puerta (plano que mira al centro)
      const door = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 4.8), new THREE.MeshBasicMaterial({ color: '#0d0b09' }));
      door.position.set((RADIUS + 0.05) * sinA, 2.4, (RADIUS + 0.05) * cosA);
      door.rotation.y = inward;
      root.add(door);

      // Dintel de lacre con filete dorado
      const lintel = shadowed(new THREE.Mesh(new THREE.BoxGeometry(8.0, 0.85, 1.9), std(gateColor, { roughness: 0.7 })));
      lintel.position.set(RADIUS * sinA, 5.15, RADIUS * cosA);
      lintel.rotation.y = a;
      const goldTrim = new THREE.Mesh(new THREE.BoxGeometry(8.1, 0.16, 1.92), std('#d4af37', { roughness: 0.4, metalness: 0.6 }));
      goldTrim.position.set(RADIUS * sinA, 5.62, RADIUS * cosA);
      goldTrim.rotation.y = a;
      root.add(lintel, goldTrim);

      // Punto de aparición dentro de la arena, frente a cada puerta
      spawnPoints.push(new THREE.Vector3((RADIUS - 6) * sinA, 0, (RADIUS - 6) * cosA));
    });

    // Puerta principal: intentar arco GLB decorativo (fallback: arco procedural)
    Assets.loadGLB('assets/props/arch.glb', buildProceduralArch).then((arch) => {
      arch.scale.setScalar(1);
      const box = new THREE.Box3().setFromObject(arch);
      const w = box.getSize(new THREE.Vector3()).x;
      if (w > 0.001) arch.scale.setScalar(7.4 / w);
      arch.position.set(0, 5.7, RADIUS - 0.6);
      arch.rotation.y = Math.PI;
      scene.add(arch);
    }).catch(() => {
      // loadGLB nunca rechaza; defensa en profundidad
      const arch = buildProceduralArch();
      arch.position.set(0, 5.7, RADIUS - 0.6);
      arch.rotation.y = Math.PI;
      scene.add(arch);
    });

    // --- 2 antorchas flanqueando la puerta principal ---
    [-0.38, 0.38].forEach((offset, i) => {
      const a = offset;
      const r = RADIUS - 7;
      const x = r * Math.sin(a);
      const z = r * Math.cos(a);
      const phase = i * 2.13;

      // Poste/peana: GLB si carga, fallback procedural si no
      Assets.loadGLB('assets/props/torch.glb', buildProceduralTorch).then((torch) => {
        const t = placeOnGround(torch, x, z, 2.9);
        scene.add(t);
      }).catch(() => {
        const t = placeOnGround(buildProceduralTorch(), x, z, 2.9);
        scene.add(t);
      });

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

    // --- Luces de la escena: sol cálido + ambiente hemisférico ---
    const hemi = new THREE.HemisphereLight('#fff3d6', '#5a4632', 0.8);
    root.add(hemi);
    const sun = new THREE.DirectionalLight('#ffe6b3', 1.7);
    sun.position.set(34, 46, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -55;
    sun.shadow.camera.right = 55;
    sun.shadow.camera.top = 55;
    sun.shadow.camera.bottom = -55;
    sun.shadow.camera.far = 130;
    sun.shadow.bias = -0.0005;
    root.add(sun);

    scene.add(root);

    return {
      bounds: { minX: -RADIUS, maxX: RADIUS, minZ: -RADIUS, maxZ: RADIUS },
      spawnPoints,
      radius: RADIUS,
      flames,
      flickerLights,
    };
  },
};

export { Maps };
export default Maps;

// Acceso global de sólo lectura para depuración y scripts clásicos futuros.
if (typeof window !== 'undefined') window.Maps = Maps;
