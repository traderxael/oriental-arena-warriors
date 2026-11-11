/* ============================================================
   heroes.js — Héroes jugables: Akane y Goro

   Interfaz pública:
     HEROES            — array con los 2 héroes completos:
                         { id, name, theme, weapon, story, epithet, desc,
                           kanji, stats: { hp, speed, damage, range,
                                           comboWindow, fuerza, velocidad,
                                           defensa },
                           special: { name, cooldown, desc },
                           colors: { primary, secondary, accent, skin },
                           builder }
     buildAkane()      — THREE.Group procedural (~1.8 m), castShadow
     buildGoro()       — idem, más ancho, armadura azul/acero

   Arma: si existe assets/props/katana.glb se carga vía Assets.loadGLB
   (que nunca rechaza: cae a la katana/odachi procedural) y sustituye
   al arma procedural en caliente. La orientación del GLB es desconocida,
   así que se alinea su eje más largo a Y y se centra en el pivote.

   Módulo ES: importa THREE desde el CDN fijado a 0.160.0 (import map).
   ============================================================ */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Assets } from './assets.js';

const KATANA_GLB = 'assets/props/katana.glb';
const SHARED_WEAPON_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.72 });
SHARED_WEAPON_MAT.userData = { shared: true };

function bakeSingleMeshWeapon(sourceRoot) {
  try {
    sourceRoot.updateMatrixWorld(true);
    const parts = [];
    sourceRoot.traverse((n) => {
      if (!n || !n.isMesh || !n.geometry) return;
      const g = n.geometry.index ? n.geometry.toNonIndexed() : n.geometry.clone();
      g.applyMatrix4(n.matrixWorld);
      for (const name of Object.keys(g.attributes)) {
        if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
      }
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      const count = g.getAttribute('position').count;
      const mat = Array.isArray(n.material) ? n.material[0] : n.material;
      const col = (mat && mat.color) ? mat.color : new THREE.Color('#cfd2d6');
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i += 1) {
        colors[i * 3] = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      parts.push(g);
    });
    if (!parts.length) return sourceRoot;
    const merged = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    merged.userData = { shared: false };
    const single = new THREE.Mesh(merged, SHARED_WEAPON_MAT);
    single.castShadow = false;
    single.receiveShadow = false;
    return single;
  } catch (_err) {
    sourceRoot.traverse((n) => { if (n.isMesh) { n.castShadow = false; n.receiveShadow = false; } });
    return sourceRoot;
  }
}

/* ---------- Materiales y helpers ---------- */

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.08, ...opts });
}

function shadowed(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function mesh(geo, color, opts) {
  return shadowed(new THREE.Mesh(geo, std(color, opts)));
}

/** Rota `obj` para que su eje más largo quede alineado con Y. */
function alignLongestAxisToY(obj) {
  const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
  if (size.y >= size.x && size.y >= size.z) return;
  if (size.x >= size.z) obj.rotation.z = Math.PI / 2;
  else obj.rotation.x = -Math.PI / 2;
}

/**
 * Carga el GLB de katana y lo sustituye dentro del pivote `holder`
 * (un Group con userData.weaponLength en metros). Nunca lanza:
 * Assets.loadGLB ya cae al fallback procedural; aquí además se envuelve
 * todo en try/catch por defensa en profundidad.
 */
function attachWeaponGLB(group, weaponLength) {
  Assets.loadGLB(KATANA_GLB, () => buildKatanaMesh(weaponLength)).then((glb) => {
    try {
      const holder = group.getObjectByName('weapon');
      if (!holder) return;
      alignLongestAxisToY(glb);
      const box = new THREE.Box3().setFromObject(glb);
      const size = box.getSize(new THREE.Vector3());
      const len = Math.max(size.x, size.y, size.z);
      if (len > 0.001) glb.scale.setScalar(glb.scale.x * (weaponLength / len));
      // Empuñadura (extremo min.y) en la palma; la hoja se proyecta hacia +Y
      const centered = new THREE.Box3().setFromObject(glb);
      const c = centered.getCenter(new THREE.Vector3());
      glb.position.set(-c.x, -centered.min.y - weaponLength * 0.14, -c.z);
      const baked = bakeSingleMeshWeapon(glb);
      Assets.disposeObject(glb);
      Assets.disposeObject(holder);
      holder.clear();
      holder.add(baked);
    } catch (err) {
      console.warn('heroes: no se pudo aplicar el GLB de katana (' +
        (err && err.message ? err.message : err) + '). Se mantiene el arma procedural.');
    }
  });
}

/* ---------- Arma procedural (fallback / inicial) ---------- */

/**
 * Katana/odachi procedural a lo largo de Y, con la empuñadura
 * centrada en el origen del pivote. `bladeLength` en metros.
 */
function buildKatanaMesh(bladeLength) {
  const g = new THREE.Group();
  const gripLen = bladeLength * 0.26;
  const bladeLen = bladeLength * 0.74;
  const bladeW = bladeLength > 1.3 ? 0.075 : 0.052;
  const steel = '#d8d8dc';
  const steelDark = '#9a9aa2';

  // Hoja: caja achatada + lomo más oscuro
  const blade = mesh(new THREE.BoxGeometry(bladeW, bladeLen, 0.016), steel, { roughness: 0.32, metalness: 0.85 });
  blade.position.y = gripLen * 0.62 + bladeLen / 2;
  const spine = mesh(new THREE.BoxGeometry(bladeW * 0.32, bladeLen, 0.02), steelDark, { roughness: 0.4, metalness: 0.8 });
  spine.position.set(bladeW * 0.32, blade.position.y, 0);
  // Punta biselada
  const tip = mesh(new THREE.ConeGeometry(bladeW * 0.62, bladeW * 1.6, 4), steel, { roughness: 0.3, metalness: 0.85 });
  tip.scale.z = 0.32;
  tip.position.y = gripLen * 0.62 + bladeLen + bladeW * 0.72;

  // Tsuba (guardamano) y tsuka (empuñadura)
  const tsuba = mesh(new THREE.CylinderGeometry(bladeW * 1.35, bladeW * 1.35, 0.028, 14), '#d4af37', { roughness: 0.35, metalness: 0.75 });
  tsuba.position.y = gripLen * 0.62 + 0.014;
  const tsuka = mesh(new THREE.CylinderGeometry(bladeW * 0.62, bladeW * 0.68, gripLen, 10), '#241a12', { roughness: 0.75 });
  tsuka.position.y = gripLen * 0.31;
  // Filetes dorados de la empuñadura
  [-0.28, 0, 0.28].forEach((off, i) => {
    const wrap = mesh(new THREE.TorusGeometry(bladeW * 0.68, 0.008, 6, 12), i === 1 ? '#d4af37' : '#3a2c1c', { roughness: 0.5, metalness: 0.4 });
    wrap.rotation.x = Math.PI / 2;
    wrap.position.y = gripLen * (0.31 + off) + gripLen * 0.0;
    g.add(wrap);
  });
  const pommel = mesh(new THREE.CylinderGeometry(bladeW * 0.72, bladeW * 0.72, 0.03, 10), '#d4af37', { roughness: 0.35, metalness: 0.75 });
  pommel.position.y = 0.015;

  g.add(blade, spine, tip, tsuba, tsuka, pommel);
  // El pivote entrega el arma centrada en la mano (origen = mitad de la empuñadura)
  const wrapper = new THREE.Group();
  wrapper.add(g);
  g.position.y = -(gripLen * 0.31);
  return wrapper;
}

/** Pivote de arma nacido en la mano derecha; el GLB lo sustituye in situ. */
function createWeaponPivot(weaponLength, x, y, z, rotZ) {
  const holder = new THREE.Group();
  holder.name = 'weapon';
  holder.userData.weaponLength = weaponLength;
  holder.position.set(x, y, z);
  holder.rotation.z = rotZ;
  const procedural = buildKatanaMesh(weaponLength);
  holder.add(procedural);
  return holder;
}

/* ---------- Partes comunes ---------- */

function buildLegs(hipY, legRadius, legColor, sandalColor) {
  const legs = new THREE.Group();
  [-1, 1].forEach((side) => {
    const leg = mesh(new THREE.CylinderGeometry(legRadius, legRadius * 1.15, hipY, 10), legColor);
    leg.position.set(side * (legRadius + 0.06), hipY / 2 + 0.09, 0);
    const sandal = mesh(new THREE.BoxGeometry(legRadius * 2.1, 0.07, legRadius * 3.1), sandalColor);
    sandal.position.set(side * (legRadius + 0.06), 0.035, 0.05);
    legs.add(leg, sandal);
  });
  return legs;
}

function buildTorso(torsoColor, radiusTop, radiusBottom, height, y) {
  const torso = mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 12), torsoColor, { roughness: 0.72 });
  torso.position.y = y;
  return torso;
}

function buildHead(skin, y, radius) {
  const head = mesh(new THREE.SphereGeometry(radius, 14, 12), skin, { roughness: 0.65 });
  head.position.y = y;
  return head;
}

function buildTopknot(y) {
  const knot = mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.14, 8), '#141210');
  knot.position.y = y;
  const base = mesh(new THREE.SphereGeometry(0.1, 10, 8), '#141210', { roughness: 0.55 });
  base.scale.set(1, 0.62, 1);
  base.position.y = y - 0.075;
  return [base, knot];
}

/* ---------- Builders de héroe ---------- */

function buildAkane() {
  const g = new THREE.Group();
  g.name = 'hero:akane';

  const C = { armor: '#a0342c', armorDark: '#5c1f1a', black: '#1a1a1a', gold: '#d4af37', skin: '#e8b187', straw: '#c8a95c', cloth: '#2a2a30' };

  // Piernas: hakama oscuro + sandalias de paja
  g.add(buildLegs(0.78, 0.095, C.cloth, '#7a6544'));

  // Torso: armadura lacada roja con placa negra y filete dorado
  const torsoY = 1.12;
  g.add(buildTorso(C.armor, 0.235, 0.31, 0.66, torsoY));
  const cuirass = mesh(new THREE.BoxGeometry(0.34, 0.4, 0.07), C.black, { roughness: 0.5, metalness: 0.2 });
  cuirass.position.set(0, torsoY + 0.04, 0.245);
  const cuirassTrim = mesh(new THREE.BoxGeometry(0.35, 0.045, 0.075), C.gold, { roughness: 0.35, metalness: 0.7 });
  cuirassTrim.position.set(0, torsoY - 0.17, 0.246);
  g.add(cuirass, cuirassTrim);
  // Cinturón (obi) dorado
  const obi = mesh(new THREE.CylinderGeometry(0.295, 0.3, 0.1, 12), C.gold, { roughness: 0.4, metalness: 0.55 });
  obi.position.y = 0.8;
  g.add(obi);

  // Hombreras (sode) rojas con canto dorado
  [-1, 1].forEach((side) => {
    const sode = mesh(new THREE.BoxGeometry(0.15, 0.3, 0.3), C.armorDark, { roughness: 0.6 });
    sode.position.set(side * 0.33, 1.33, 0);
    sode.rotation.z = side * 0.18;
    const sodeTrim = mesh(new THREE.BoxGeometry(0.16, 0.05, 0.31), C.gold, { roughness: 0.4, metalness: 0.6 });
    sodeTrim.position.set(side * 0.345, 1.19, 0);
    sodeTrim.rotation.z = side * 0.18;
    g.add(sode, sodeTrim);
  });

  // Brazos: mangas rojas, antebrazos negros
  [-1, 1].forEach((side) => {
    const sleeve = mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.34, 8), C.armor, { roughness: 0.65 });
    sleeve.position.set(side * 0.31, 1.18, 0);
    sleeve.rotation.z = side * 0.28;
    const fore = mesh(new THREE.CylinderGeometry(0.058, 0.065, 0.3, 8), C.black);
    fore.position.set(side * 0.4, 0.9, 0.05);
    fore.rotation.z = side * 0.14;
    g.add(sleeve, fore);
  });

  // Cabeza + rostro + moño + kasa (sombrero de paja)
  g.add(buildHead(C.skin, 1.53, 0.165));
  g.add(...buildTopknot(1.705));
  const kasa = mesh(new THREE.ConeGeometry(0.35, 0.17, 18), C.straw, { roughness: 0.95 });
  kasa.position.y = 1.665;
  const kasaRim = mesh(new THREE.TorusGeometry(0.345, 0.018, 6, 20), '#a8853e', { roughness: 0.9 });
  kasaRim.rotation.x = Math.PI / 2;
  kasaRim.position.y = 1.582;
  g.add(kasa, kasaRim);

  // Katana en la mano derecha (empuñadura centrada, hoja al aire en diagonal)
  const weapon = createWeaponPivot(1.06, 0.42, 0.98, 0.08, -0.62);
  g.add(weapon);

  g.traverse((n) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
  attachWeaponGLB(g, 1.06);
  return g;
}

function buildGoro() {
  const g = new THREE.Group();
  g.name = 'hero:goro';

  const C = { armor: '#3f4f63', armorDark: '#2c3848', steel: '#6b7b8d', steelLight: '#8b9bab', black: '#1a1a1a', gold: '#d4af37', skin: '#d9a97c', cloth: '#22262e' };

  // Piernas más gruesas
  g.add(buildLegs(0.8, 0.12, C.cloth, '#4c4034'));

  // Torso masivo: armadura azul/acero
  const torsoY = 1.14;
  g.add(buildTorso(C.armor, 0.32, 0.4, 0.72, torsoY));
  const cuirass = mesh(new THREE.BoxGeometry(0.46, 0.44, 0.09), C.steel, { roughness: 0.38, metalness: 0.65 });
  cuirass.position.set(0, torsoY + 0.05, 0.32);
  const cuirassTrim = mesh(new THREE.BoxGeometry(0.47, 0.05, 0.1), C.gold, { roughness: 0.35, metalness: 0.7 });
  cuirassTrim.position.set(0, torsoY - 0.19, 0.325);
  g.add(cuirass, cuirassTrim);
  // Kusazuri (placas faldón)
  for (let i = -1; i <= 1; i += 1) {
    const skirt = mesh(new THREE.BoxGeometry(0.16, 0.2, 0.06), C.armorDark, { roughness: 0.6, metalness: 0.25 });
    skirt.position.set(i * 0.19, 0.77, 0.32);
    skirt.rotation.x = 0.22;
    g.add(skirt);
  }
  const obi = mesh(new THREE.CylinderGeometry(0.385, 0.395, 0.11, 12), C.black, { roughness: 0.6 });
  obi.position.y = 0.84;
  g.add(obi);

  // Hombreras grandes de acero
  [-1, 1].forEach((side) => {
    const sode = mesh(new THREE.BoxGeometry(0.2, 0.34, 0.36), C.armorDark, { roughness: 0.45, metalness: 0.4 });
    sode.position.set(side * 0.44, 1.38, 0);
    sode.rotation.z = side * 0.15;
    const rivet = mesh(new THREE.SphereGeometry(0.03, 8, 6), C.gold, { roughness: 0.3, metalness: 0.75 });
    rivet.position.set(side * 0.5, 1.28, 0.19);
    g.add(sode, rivet);
  });

  // Brazos gruesos
  [-1, 1].forEach((side) => {
    const sleeve = mesh(new THREE.CylinderGeometry(0.095, 0.11, 0.36, 8), C.armor, { roughness: 0.6, metalness: 0.2 });
    sleeve.position.set(side * 0.42, 1.2, 0);
    sleeve.rotation.z = side * 0.3;
    const fore = mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.32, 8), C.steel, { roughness: 0.4, metalness: 0.55 });
    fore.position.set(side * 0.53, 0.92, 0.06);
    fore.rotation.z = side * 0.16;
    g.add(sleeve, fore);
  });

  // Cabeza + hachimaki blanco + moño
  g.add(buildHead(C.skin, 1.56, 0.175));
  const hachimaki = mesh(new THREE.CylinderGeometry(0.178, 0.178, 0.075, 12), '#f3e9d2', { roughness: 0.85 });
  hachimaki.position.y = 1.63;
  g.add(hachimaki);
  g.add(...buildTopknot(1.745));

  // Odachi (gran katana) en la mano derecha
  const weapon = createWeaponPivot(1.5, 0.55, 1.0, 0.1, -0.72);
  g.add(weapon);

  g.traverse((n) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
  attachWeaponGLB(g, 1.5);
  return g;
}

/* ---------- HEROES ---------- */

const HEROES = [
  {
    id: 'akane',
    name: 'Akane',
    theme: 'Samurái',
    weapon: 'Katana',
    epithet: 'La Ronin Exiliada',
    desc: 'Katana veloz y disciplina lunar. Daño equilibrado y la esquiva más rápida de la arena.',
    kanji: '刀',
    story: 'Ronin exiliada del clan Satsuma, Akane carga con el deshonor de un duelo que no eligió. En la arena busca redención: cada corte es un paso hacia su nombre borrado. Ligera como el viento, precisa como la luna que la vio partir.',
    stats: { hp: 100, speed: 6.2, damage: 18, range: 2.6, comboWindow: 0.55, fuerza: 70, velocidad: 88, defensa: 55 },
    special: {
      name: 'Desenvaine Relámpago',
      cooldown: 8,
      desc: 'Corte instantáneo en línea: desenvaina y atraviesa a todos los enemigos frente a ella.',
    },
    colors: { primary: '#a0342c', secondary: '#1a1a1a', accent: '#d4af37', skin: '#e8b187' },
    builder: buildAkane,
  },
  {
    id: 'goro',
    name: 'Goro',
    theme: 'Samurái',
    weapon: 'Odachi',
    epithet: 'El Último Samurái',
    desc: 'Odachi colosal y armadura de acero. Lento, pero cada tajo parte armaduras y voluntades.',
    kanji: '剛',
    story: 'Último samurái de su dominio, Goro lucha por honor tras la caída de su señor. Su odachi ha partido armaduras y corazones por igual; cada tajo es un réquiem por el mundo que lo vio nacer y juró defender hasta la muerte.',
    stats: { hp: 140, speed: 4.6, damage: 34, range: 3.0, comboWindow: 0.7, fuerza: 95, velocidad: 42, defensa: 78 },
    special: {
      name: 'Tajo Giratorio',
      cooldown: 10,
      desc: 'Giro de 360° con el odachi: daña a todos los enemigos que lo rodean.',
    },
    colors: { primary: '#3f4f63', secondary: '#1a1a1a', accent: '#d4af37', skin: '#d9a97c' },
    builder: buildGoro,
  },
];

export { HEROES, buildAkane, buildGoro };
export default HEROES;

// Acceso global de sólo lectura para depuración.
if (typeof window !== 'undefined') window.HEROES = HEROES;
