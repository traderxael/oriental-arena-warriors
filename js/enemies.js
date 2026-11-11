/* ============================================================
   enemies.js — Enemigos: ronin, bandido, lancero, brute y maestro + IA

   Interfaz pública (global de depuración `window.Enemies`):
     Enemies.spawn(type, wave, map, scene) -> Enemy
       Crea un enemigo del `type` ('ronin' | 'bandido' | 'lancero' |
       'brute' | 'maestro') con las stats escaladas por oleada de
       Logic.enemyStats(type, wave) — el maestro usa Logic.duelStats() —
       y lo añade a `scene` en un spawnPoint aleatorio de `map` (mapa o
       cualquier objeto con { spawnPoints: THREE.Vector3[], radius: number }).
       Tipos desconocidos: Logic.enemyStats lanza (por diseño).
     Enemies.updateAll(list, dt, playerPos, now, player)
       Actualiza una lista de enemigos in situ: persecución directa
       hacia `playerPos` (cualquier {x, z}), separación simple entre
       enemigos (radio 0.9 m) y ataques con windup. `player` (opcional)
       es el objeto jugador completo: el maestro lo usa para esquivar
       reactivamente sus tajos. Elimina de la escena y de la lista a
       los que mueran (liberando sus recursos procedurales propios).
     Enemies.onPlayerDamage(fn)
       Registra el manejador que recibe (damage, enemy) cuando el
       windup de un ataque enemigo se completa y el jugador sigue en
       rango. main.js lo usa para restar HP y flashear el vignette.
     Enemies.SUPPORTS — tipos con builders implementados
       (['ronin','bandido','lancero','brute','maestro']).

   Enemy (interfaz compatible con Combat):
     { group, hp, maxHp, type, alive, attackCooldownUntil,
       takeDamage(n), update(dt, playerPos, now, player) }
   (`alive` es requerido por Combat.aliveEnemies; sin él el enemigo
   seguiría recibiendo golpes tras morir.)

   IA por frame (tipos normales):
     - Si está en windup (originado al entrar en `range`), queda
       enraizado; al completarse los 0.4 s aplica el daño si el
       jugador sigue a ≤ range * 1.4 m.
     - Si `dist > range * 0.8`, persigue al jugador a `speed`.
     - Si está en `range` y `now >= attackCooldownUntil`, inicia
       windup de 0.4 s (attackCooldownUntil = now + attackCooldown).
     - Separación: empuje mutuo para que dos enemigos no se solapen
       (distancia < 0.9 m → se reparten el solape).
   IA del maestro (Duelo): orbita a range×0.9, alterna ciclos de
   aproximación/retirada, dash de retirada reactivo al tajo del jugador
   (0.22 s a 10 m/s, cooldown 2.5 s), windup de 0.5 s y giro especial
   telegrafiado (0.7 s) cada 9 s con daño ×1.5 en radio range×1.8.
   El jugador es invulnerable durante los i-frames del dash: el
   manejador de daño (main.js) lo consulta con player.isInvulnerable().

   Visual: constructores procedurales distintos por tipo (recolores
   y siluetas del patrón de heroes.js). El arma del ronin y del maestro
   se sustituye en caliente por assets/props/katana.glb (Assets.loadGLB,
   con fallback procedural automático); el machete del bandido es
   procedural (no hay GLB commiteado: Assets.loadGLB caería al
   fallback igualmente, con su warning claro en consola).

   Módulo ES: importa THREE desde el CDN fijado a 0.160.0 (import map).
   ============================================================ */
import * as THREE from 'three';
import { Assets } from './assets.js';

const KATANA_GLB = 'assets/props/katana.glb';
const SEPARATION_RADIUS = 0.9;      // m — repulsión entre enemigos
const WINDUP_TIME = 0.4;            // s de windup antes del golpe
const WINDUP_RANGE_SLACK = 1.4;     // el golpe conecta hasta range * slack
const ENEMY_RADIUS = 0.65;          // para el clamp circular en la arena
const SUPPORTS = ['ronin', 'bandido', 'lancero', 'brute', 'maestro'];
const MAESTRO_WINDUP = 0.5;         // s de telegraph del golpe del maestro
const MAESTRO_SPECIAL_WINDUP = 0.7; // s de telegraph del giro del maestro
const MAESTRO_SPECIAL_CD = 9;       // s entre giros del maestro

/* ---------- Materiales y helpers (patrón heroes.js) ---------- */

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.08, ...opts });
}

function shadowed(obj) {
  obj.traverse((n) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
  return obj;
}

function mesh(geo, color, opts) {
  const m = new THREE.Mesh(geo, std(color, opts));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/* ---------- Armas ---------- */

/** Katana corta procedural (fallback y versión inicial del ronin). */
function buildShortKatana(bladeLength) {
  const g = new THREE.Group();
  const gripLen = bladeLength * 0.3;
  const bladeLen = bladeLength * 0.7;
  const bladeW = 0.045;
  const blade = mesh(new THREE.BoxGeometry(bladeW, bladeLen, 0.014), '#d8d8dc', { roughness: 0.32, metalness: 0.85 });
  blade.position.y = gripLen * 0.6 + bladeLen / 2;
  const tsuba = mesh(new THREE.CylinderGeometry(bladeW * 1.4, bladeW * 1.4, 0.03, 12), '#8a6d3b', { roughness: 0.4, metalness: 0.6 });
  tsuba.position.y = gripLen * 0.6 + 0.015;
  const tsuka = mesh(new THREE.CylinderGeometry(bladeW * 0.62, bladeW * 0.7, gripLen, 8), '#241a12', { roughness: 0.75 });
  tsuka.position.y = gripLen * 0.3;
  g.add(blade, tsuba, tsuka);
  const wrapper = new THREE.Group();
  wrapper.add(g);
  g.position.y = -(gripLen * 0.3);
  return wrapper;
}

/** Lanza (yari) procedural para el lancero: asta larga con hoja de cuatro filos. */
function buildSpear(bladeLength) {
  const g = new THREE.Group();
  const shaftLen = bladeLength * 0.78;
  const bladeLen = bladeLength * 0.22;
  const shaftR = 0.028;
  const shaft = mesh(new THREE.CylinderGeometry(shaftR, shaftR * 1.15, shaftLen, 8), '#6b4f2c', { roughness: 0.8 });
  shaft.position.y = shaftLen / 2;
  // Virola (casquillo) entre asta y hoja
  const collar = mesh(new THREE.CylinderGeometry(shaftR * 1.7, shaftR * 1.7, 0.06, 10), '#8a6d3b', { roughness: 0.4, metalness: 0.6 });
  collar.position.y = shaftLen + 0.03;
  // Hoja: cono de 4 caras, acero pulido
  const blade = mesh(new THREE.ConeGeometry(0.055, bladeLen, 4), '#cfd2d6', { roughness: 0.28, metalness: 0.85 });
  blade.position.y = shaftLen + 0.06 + bladeLen / 2;
  blade.rotation.y = Math.PI / 4;
  g.add(shaft, collar, blade);
  const wrapper = new THREE.Group();
  wrapper.add(g);
  // El pivote agarra el asta por su parte baja (tercio inferior)
  g.position.y = -bladeLength * 0.28;
  return wrapper;
}

/** Kanabō (maza de guerra) procedural para el brute: madera gruesa con aros de hierro. */
function buildKanabo(length) {
  const g = new THREE.Group();
  const gripLen = length * 0.32;
  const headLen = length * 0.68;
  const gripR = 0.042;
  const headR = 0.085;
  const grip = mesh(new THREE.CylinderGeometry(gripR, gripR * 1.1, gripLen, 8), '#33241a', { roughness: 0.85 });
  grip.position.y = gripLen / 2;
  const head = mesh(new THREE.CylinderGeometry(headR * 0.82, headR, headLen, 10), '#4a3826', { roughness: 0.78 });
  head.position.y = gripLen + headLen / 2;
  // Aros de hierro que ciñen la cabeza
  [0.22, 0.52, 0.8].forEach((f) => {
    const ring = mesh(new THREE.CylinderGeometry(headR * (1.02 - f * 0.18), headR * (1.02 - f * 0.18), 0.05, 10), '#4d4d52', { roughness: 0.45, metalness: 0.7 });
    ring.position.y = gripLen + headLen * f;
    g.add(ring);
  });
  // Punta roma de hierro
  const cap = mesh(new THREE.CylinderGeometry(headR * 0.55, headR * 0.82, 0.07, 10), '#5a5a60', { roughness: 0.4, metalness: 0.75 });
  cap.position.y = gripLen + headLen + 0.035;
  g.add(grip, head, cap);
  const wrapper = new THREE.Group();
  wrapper.add(g);
  g.position.y = -gripLen * 0.3;
  return wrapper;
}

/** Machete procedural para el bandido: hoja ancha y oxidada. */
function buildMachete(bladeLength) {
  const g = new THREE.Group();
  const gripLen = bladeLength * 0.34;
  const bladeLen = bladeLength * 0.66;
  const bladeW = 0.085;
  const rust = { roughness: 0.62, metalness: 0.55 };
  const blade = mesh(new THREE.BoxGeometry(bladeW, bladeLen, 0.018), '#b9b3a4', rust);
  blade.position.y = gripLen * 0.6 + bladeLen / 2;
  // Filo curvo (punta ensanchada): caja rotada en la punta
  const tip = mesh(new THREE.BoxGeometry(bladeW * 1.45, bladeLen * 0.24, 0.018), '#a8a292', rust);
  tip.position.y = gripLen * 0.6 + bladeLen - bladeLen * 0.12;
  const grip = mesh(new THREE.CylinderGeometry(bladeW * 0.55, bladeW * 0.62, gripLen, 8), '#3a2c1c', { roughness: 0.85 });
  grip.position.y = gripLen * 0.3;
  const guard = mesh(new THREE.CylinderGeometry(bladeW * 0.72, bladeW * 0.72, 0.025, 10), '#565045', { roughness: 0.5, metalness: 0.5 });
  guard.position.y = gripLen * 0.6 + 0.012;
  g.add(blade, tip, grip, guard);
  const wrapper = new THREE.Group();
  wrapper.add(g);
  g.position.y = -(gripLen * 0.3);
  return wrapper;
}

/** Pivote de arma en la mano derecha (el GLB del ronin lo sustituye in situ). */
function createWeaponPivot(weapon, x, y, z, rotZ) {
  const holder = new THREE.Group();
  holder.name = 'weapon';
  const weaponLengths = { katana: 0.95, machete: 0.72, spear: 2.35, kanabo: 1.35 };
  holder.userData.weaponLength = weaponLengths[weapon] || 0.72;
  holder.position.set(x, y, z);
  holder.rotation.z = rotZ;
  let built;
  if (weapon === 'katana') built = buildShortKatana(0.95);
  else if (weapon === 'machete') built = buildMachete(0.72);
  else if (weapon === 'spear') built = buildSpear(2.35);
  else built = buildKanabo(1.35);
  holder.add(built);
  return holder;
}

/** Sustituye el arma del ronin por el GLB de katana (patrón heroes.js). Nunca lanza. */
function attachRoninWeaponGLB(group) {
  Assets.loadGLB(KATANA_GLB, () => buildShortKatana(0.95)).then((glb) => {
    try {
      const holder = group.getObjectByName('weapon');
      if (!holder) return;
      const size = new THREE.Box3().setFromObject(glb).getSize(new THREE.Vector3());
      const len = Math.max(size.x, size.y, size.z);
      if (len > 0.001) glb.scale.setScalar(glb.scale.x * (0.95 / len));
      const centered = new THREE.Box3().setFromObject(glb);
      const c = centered.getCenter(new THREE.Vector3());
      glb.position.set(-c.x, -c.y, -c.z);
      Assets.disposeObject(holder);
      holder.clear();
      holder.add(glb);
    } catch (err) {
      console.warn('enemies: no se pudo aplicar el GLB de katana (' +
        (err && err.message ? err.message : err) + '). Se mantiene el arma procedural.');
    }
  });
}

/* ---------- Partes comunes ---------- */

function buildLegs(hipY, legRadius, legColor, sandalColor) {
  const legs = new THREE.Group();
  [-1, 1].forEach((side) => {
    const leg = mesh(new THREE.CylinderGeometry(legRadius, legRadius * 1.12, hipY, 8), legColor);
    leg.position.set(side * (legRadius + 0.05), hipY / 2 + 0.08, 0);
    const sandal = mesh(new THREE.BoxGeometry(legRadius * 2.1, 0.06, legRadius * 3.0), sandalColor);
    sandal.position.set(side * (legRadius + 0.05), 0.03, 0.05);
    legs.add(leg, sandal);
  });
  return legs;
}

/* ---------- Builders por tipo ---------- */

/** Ronin: gris/ocre, kasa de paja raída y katana. ~1.75 m. */
function buildRonin() {
  const g = new THREE.Group();
  g.name = 'enemy:ronin';

  const C = { cloth: '#6e6a63', clothDark: '#4c4842', ochre: '#a8843c', ochreDark: '#7a5f2a', skin: '#caa176', straw: '#b8a05c' };

  g.add(buildLegs(0.74, 0.09, C.clothDark, '#54452e'));

  // Torso: kimono gris con obi ocre
  const torsoY = 1.08;
  const torso = mesh(new THREE.CylinderGeometry(0.225, 0.30, 0.62, 12), C.cloth, { roughness: 0.8 });
  torso.position.y = torsoY;
  const obi = mesh(new THREE.CylinderGeometry(0.28, 0.285, 0.09, 12), C.ochre, { roughness: 0.6 });
  obi.position.y = 0.79;
  g.add(torso, obi);

  // Hombreras ocres desgastadas
  [-1, 1].forEach((side) => {
    const sode = mesh(new THREE.BoxGeometry(0.13, 0.22, 0.26), C.ochreDark, { roughness: 0.7 });
    sode.position.set(side * 0.30, 1.28, 0);
    sode.rotation.z = side * 0.16;
    g.add(sode);
  });

  // Brazos grises
  [-1, 1].forEach((side) => {
    const sleeve = mesh(new THREE.CylinderGeometry(0.068, 0.075, 0.32, 8), C.cloth, { roughness: 0.75 });
    sleeve.position.set(side * 0.28, 1.13, 0);
    sleeve.rotation.z = side * 0.24;
    const fore = mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.28, 8), C.clothDark);
    fore.position.set(side * 0.36, 0.88, 0.05);
    fore.rotation.z = side * 0.12;
    g.add(sleeve, fore);
  });

  // Cabeza + kasa raído (cono más ancho y caído que el de Akane)
  const head = mesh(new THREE.SphereGeometry(0.155, 12, 10), C.skin, { roughness: 0.7 });
  head.position.y = 1.47;
  const kasa = mesh(new THREE.ConeGeometry(0.38, 0.15, 14), C.straw, { roughness: 0.95 });
  kasa.position.y = 1.585;
  kasa.rotation.z = 0.06;
  g.add(head, kasa);

  const weapon = createWeaponPivot('katana', 0.38, 0.94, 0.07, -0.58);
  g.add(weapon);

  shadowed(g);
  attachRoninWeaponGLB(g);
  return g;
}

/** Bandido: naranja sucio, machete oxidado; más rápido, más frágil. ~1.68 m. */
function buildBandido() {
  const g = new THREE.Group();
  g.name = 'enemy:bandido';

  const C = { cloth: '#b3541e', clothDark: '#7a3a16', dirt: '#4a3a28', skin: '#b98a5e', rag: '#d8c9a3' };

  g.add(buildLegs(0.7, 0.082, C.dirt, '#3c2f20'));

  // Torso: chaqueta naranja desaturada con harapos
  const torsoY = 1.02;
  const torso = mesh(new THREE.CylinderGeometry(0.21, 0.275, 0.58, 12), C.cloth, { roughness: 0.92 });
  torso.position.y = torsoY;
  // Harapos: tiras de tela colgando en la cintura
  for (let i = -1; i <= 1; i += 1) {
    const rag = mesh(new THREE.BoxGeometry(0.09, 0.22, 0.05), i === 0 ? C.rag : C.clothDark, { roughness: 0.95 });
    rag.position.set(i * 0.14, 0.68, 0.20);
    rag.rotation.x = 0.18;
    g.add(rag);
  }
  const belt = mesh(new THREE.CylinderGeometry(0.26, 0.265, 0.08, 12), C.dirt, { roughness: 0.85 });
  belt.position.y = 0.75;
  g.add(torso, belt);

  // Brazos: mangas naranjas arremangadas, antebrazos sucios
  [-1, 1].forEach((side) => {
    const sleeve = mesh(new THREE.CylinderGeometry(0.062, 0.068, 0.3, 8), C.clothDark, { roughness: 0.9 });
    sleeve.position.set(side * 0.265, 1.08, 0);
    sleeve.rotation.z = side * 0.3;
    const fore = mesh(new THREE.CylinderGeometry(0.048, 0.054, 0.28, 8), C.skin, { roughness: 0.75 });
    fore.position.set(side * 0.35, 0.84, 0.05);
    fore.rotation.z = side * 0.15;
    g.add(sleeve, fore);
  });

  // Cabeza + pañuelo (hachimaki sucio)
  const head = mesh(new THREE.SphereGeometry(0.15, 12, 10), C.skin, { roughness: 0.75 });
  head.position.y = 1.38;
  const wrap = mesh(new THREE.CylinderGeometry(0.153, 0.153, 0.07, 12), C.rag, { roughness: 0.95 });
  wrap.position.y = 1.44;
  const knot = mesh(new THREE.BoxGeometry(0.07, 0.12, 0.04), C.rag, { roughness: 0.95 });
  knot.position.set(0, 1.42, -0.17);
  g.add(head, wrap, knot);

  const weapon = createWeaponPivot('machete', 0.36, 0.9, 0.07, -0.66);
  g.add(weapon);

  shadowed(g);
  return g;
}

/** Lancero: índigo oscuro con franja carmesí, yari (lanza) larga. Alcance superior. ~1.74 m. */
function buildLancero() {
  const g = new THREE.Group();
  g.name = 'enemy:lancero';

  const C = { cloth: '#3d4b5c', clothDark: '#2a3441', sash: '#7a2d24', skin: '#caa176', dark: '#1f2733' };

  g.add(buildLegs(0.76, 0.088, C.clothDark, '#2b2b30'));

  // Torso: haramaki índigo con franja carmesí
  const torsoY = 1.09;
  const torso = mesh(new THREE.CylinderGeometry(0.215, 0.285, 0.6, 12), C.cloth, { roughness: 0.82 });
  torso.position.y = torsoY;
  const sash = mesh(new THREE.CylinderGeometry(0.27, 0.275, 0.08, 12), C.sash, { roughness: 0.6 });
  sash.position.y = 0.8;
  g.add(torso, sash);

  // Cintas cruzadas del pecho (coraza ligera de tela)
  [-1, 1].forEach((side) => {
    const strap = mesh(new THREE.BoxGeometry(0.09, 0.62, 0.03), C.clothDark, { roughness: 0.85 });
    strap.position.set(side * 0.11, torsoY + 0.02, 0.225);
    strap.rotation.z = side * 0.42;
    g.add(strap);
  });

  // Brazos: mangas índigo arremangadas; antebrazos al descubierto para el yari
  [-1, 1].forEach((side) => {
    const sleeve = mesh(new THREE.CylinderGeometry(0.064, 0.07, 0.3, 8), C.cloth, { roughness: 0.8 });
    sleeve.position.set(side * 0.27, 1.13, 0);
    sleeve.rotation.z = side * 0.28;
    const fore = mesh(new THREE.CylinderGeometry(0.048, 0.054, 0.28, 8), C.skin, { roughness: 0.75 });
    fore.position.set(side * 0.35, 0.88, 0.06);
    fore.rotation.z = side * 0.18;
    g.add(sleeve, fore);
  });

  // Cabeza + tokin (casquete lacado oscuro) y coleta
  const head = mesh(new THREE.SphereGeometry(0.15, 12, 10), C.skin, { roughness: 0.7 });
  head.position.y = 1.47;
  const cap = mesh(new THREE.CylinderGeometry(0.115, 0.145, 0.13, 12), C.dark, { roughness: 0.35, metalness: 0.25 });
  cap.position.y = 1.575;
  const topknot = mesh(new THREE.SphereGeometry(0.045, 8, 6), '#14181f', { roughness: 0.6 });
  topknot.position.y = 1.66;
  g.add(head, cap, topknot);

  const weapon = createWeaponPivot('spear', 0.35, 0.92, 0.09, -0.42);
  g.add(weapon);

  shadowed(g);
  return g;
}

/** Brute: coloso acorazado, gran masa y kanabō. Lento, muy resistente y demoledor. ~2.15 m. */
function buildBrute() {
  const g = new THREE.Group();
  g.name = 'enemy:brute';

  const C = { cloth: '#5a2d2d', clothDark: '#3c1f1f', iron: '#4d4d52', ironDark: '#333338', skin: '#a97a52', band: '#241a12' };

  // Piernas gruesas
  g.add(buildLegs(0.88, 0.135, C.clothDark, '#241a12'));

  // Torso: enorme, con plancha de hierro en el pecho
  const torsoY = 1.32;
  const torso = mesh(new THREE.CylinderGeometry(0.36, 0.47, 0.82, 14), C.cloth, { roughness: 0.9 });
  torso.position.y = torsoY;
  const plate = mesh(new THREE.BoxGeometry(0.52, 0.34, 0.08), C.iron, { roughness: 0.4, metalness: 0.7 });
  plate.position.set(0, torsoY + 0.08, 0.4);
  const belt = mesh(new THREE.CylinderGeometry(0.45, 0.46, 0.1, 14), C.ironDark, { roughness: 0.45, metalness: 0.65 });
  belt.position.y = 0.95;
  g.add(torso, plate, belt);

  // Hombreras de hierro (sode grandes)
  [-1, 1].forEach((side) => {
    const pauldron = mesh(new THREE.BoxGeometry(0.26, 0.3, 0.34), C.iron, { roughness: 0.38, metalness: 0.72 });
    pauldron.position.set(side * 0.44, 1.56, 0);
    pauldron.rotation.z = side * 0.14;
    g.add(pauldron);
  });

  // Brazos: mangas anchas y antebrazos de cuero
  [-1, 1].forEach((side) => {
    const sleeve = mesh(new THREE.CylinderGeometry(0.105, 0.115, 0.38, 10), C.cloth, { roughness: 0.88 });
    sleeve.position.set(side * 0.44, 1.32, 0);
    sleeve.rotation.z = side * 0.26;
    const fore = mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.34, 10), C.band, { roughness: 0.8 });
    fore.position.set(side * 0.56, 1.0, 0.06);
    fore.rotation.z = side * 0.14;
    g.add(sleeve, fore);
  });

  // Cabeza + kabuto (casco) con maedate (cresta) de media luna
  const head = mesh(new THREE.SphereGeometry(0.185, 12, 10), C.skin, { roughness: 0.75 });
  head.position.y = 1.8;
  const helm = mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), C.iron, { roughness: 0.35, metalness: 0.75 });
  helm.position.y = 1.84;
  const crest = mesh(new THREE.BoxGeometry(0.06, 0.2, 0.04), '#d4af37', { roughness: 0.35, metalness: 0.8 });
  crest.position.y = 2.06;
  g.add(head, helm, crest);

  const weapon = createWeaponPivot('kanabo', 0.6, 1.02, 0.1, -0.62);
  g.add(weapon);

  shadowed(g);
  return g;
}

/** Maestro del Duelo: armadura de laca negra con filetes dorados y menpō. ~1.85 m. */
function buildMaestro() {
  const g = new THREE.Group();
  g.name = 'enemy:maestro';

  const C = { lacquer: '#181410', lacquerDark: '#0d0b09', gold: '#d4af37', goldDark: '#a8862a', skin: '#caa176', cloth: '#241d16' };

  g.add(buildLegs(0.8, 0.1, C.lacquerDark, '#14100c'));

  // Torso: dō de laca negra con obi dorado
  const torsoY = 1.16;
  const torso = mesh(new THREE.CylinderGeometry(0.24, 0.32, 0.66, 12), C.lacquer, { roughness: 0.35, metalness: 0.3 });
  torso.position.y = torsoY;
  const obi = mesh(new THREE.CylinderGeometry(0.30, 0.305, 0.1, 12), C.goldDark, { roughness: 0.4, metalness: 0.6 });
  obi.position.y = 0.85;
  const crest = mesh(new THREE.BoxGeometry(0.16, 0.16, 0.03), C.gold, { roughness: 0.35, metalness: 0.8 });
  crest.position.set(0, torsoY + 0.1, 0.29);
  g.add(torso, obi, crest);

  // Sode de laca con borde dorado
  [-1, 1].forEach((side) => {
    const sode = mesh(new THREE.BoxGeometry(0.15, 0.26, 0.3), C.lacquer, { roughness: 0.35, metalness: 0.3 });
    sode.position.set(side * 0.33, 1.38, 0);
    sode.rotation.z = side * 0.16;
    const trim = mesh(new THREE.BoxGeometry(0.16, 0.04, 0.31), C.gold, { roughness: 0.35, metalness: 0.8 });
    trim.position.set(side * 0.33, 1.5, 0);
    trim.rotation.z = side * 0.16;
    g.add(sode, trim);
  });

  // Brazos
  [-1, 1].forEach((side) => {
    const sleeve = mesh(new THREE.CylinderGeometry(0.07, 0.078, 0.34, 8), C.cloth, { roughness: 0.75 });
    sleeve.position.set(side * 0.30, 1.2, 0);
    sleeve.rotation.z = side * 0.24;
    const fore = mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.3, 8), C.lacquerDark);
    fore.position.set(side * 0.38, 0.94, 0.05);
    fore.rotation.z = side * 0.12;
    g.add(sleeve, fore);
  });

  // Cabeza + menpō (media máscara) y kabuto con maedate dorado
  const head = mesh(new THREE.SphereGeometry(0.16, 12, 10), C.skin, { roughness: 0.7 });
  head.position.y = 1.56;
  const mask = mesh(new THREE.SphereGeometry(0.165, 12, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), C.lacquerDark, { roughness: 0.4, metalness: 0.3 });
  mask.position.y = 1.56;
  const helm = mesh(new THREE.SphereGeometry(0.19, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), C.lacquer, { roughness: 0.3, metalness: 0.4 });
  helm.position.y = 1.6;
  const maedate = mesh(new THREE.BoxGeometry(0.05, 0.24, 0.03), C.gold, { roughness: 0.3, metalness: 0.85 });
  maedate.position.y = 1.82;
  g.add(head, mask, helm, maedate);

  const weapon = createWeaponPivot('katana', 0.4, 1.0, 0.07, -0.58);
  g.add(weapon);

  shadowed(g);
  attachRoninWeaponGLB(g);
  return g;
}

const BUILDERS = { ronin: buildRonin, bandido: buildBandido, lancero: buildLancero, brute: buildBrute, maestro: buildMaestro };

/* ---------- Daño al jugador ---------- */

let playerDamageHandler = null;

/** Registra el manejador (damage, enemy) que aplica el daño al jugador. */
function onPlayerDamage(fn) {
  playerDamageHandler = typeof fn === 'function' ? fn : null;
}

/* ---------- Interfaz Enemy ---------- */

function spawn(type, wave, map, scene) {
  const builder = BUILDERS[type];
  if (!builder) {
    throw new Error('Enemies.spawn: tipo no soportado "' + String(type) +
      '" (soportados: ' + SUPPORTS.join(', ') + ')');
  }
  const stats = type === 'maestro'
    ? (window.Logic && typeof window.Logic.duelStats === 'function'
      ? window.Logic.duelStats()
      : { hp: 600, speed: 3.4, damage: 16, range: 2.8, attackCooldown: 1.1 })
    : (window.Logic
      ? window.Logic.enemyStats(type, wave)
      : { hp: 60, speed: 2.2, damage: 8, range: 1.6, attackCooldown: 1.2 });

  const group = builder();

  // Punto de aparición aleatorio entre los spawnPoints del mapa (+ jitter)
  const points = map && Array.isArray(map.spawnPoints) && map.spawnPoints.length
    ? map.spawnPoints
    : [new THREE.Vector3(Math.cos(Math.PI / 2) * 30, 0, Math.sin(Math.PI / 2) * 30)];
  const base = points[Math.floor(Math.random() * points.length)];
  group.position.set(
    base.x + (Math.random() - 0.5) * 3,
    0,
    base.z + (Math.random() - 0.5) * 3
  );
  group.rotation.y = Math.random() * Math.PI * 2;
  if (scene) scene.add(group);

  const arenaRadius = map && typeof map.radius === 'number' ? map.radius : 38;
  const obstacles = map && Array.isArray(map.obstacles) ? map.obstacles : null;
  const maxHp = Math.max(1, Math.round(stats.hp));

  const enemy = {
    group,
    type,
    hp: maxHp,
    maxHp,
    alive: true,
    ownsResources: true, // geometrías/materiales creados por el builder son propios
    attackCooldownUntil: 0,
    windupUntil: 0,      // 0 = sin windup en curso
    pendingDamage: 0,
    weaponBaseZ: null,   // rotación Z base del pivote de arma (se captura 1ª vez)
    // Estado exclusivo del maestro (Duelo)
    duelMode: 'orbit',
    duelModeUntil: 0,
    orbitSign: 1,
    dashUntil: 0,
    dashX: 0,
    dashZ: 0,
    retreatCooldownUntil: 0,
    spinUntil: 0,
    pendingSpecial: false,
    specialAt: 6,
    update(dt, playerPos, now, player) {
      if (!this.alive) return;
      if (!(dt > 0)) return;
      const t = Number(now) || 0;
      if (type === 'maestro') {
        maestroUpdate(this, dt, playerPos, t, player, stats, arenaRadius, obstacles);
        return;
      }
      const px = playerPos && typeof playerPos.x === 'number' ? playerPos.x : 0;
      const pz = playerPos && typeof playerPos.z === 'number' ? playerPos.z : 0;
      const dx = px - group.position.x;
      const dz = pz - group.position.z;
      const dist = Math.hypot(dx, dz);

      // Mirar siempre al jugador
      if (dist > 1e-4) group.rotation.y = Math.atan2(dx, dz);

      // Windup en curso: enraizado hasta completarlo
      if (this.windupUntil > 0) {
        const p = THREE.MathUtils.clamp((t - (this.windupUntil - WINDUP_TIME)) / WINDUP_TIME, 0, 1);
        setWindupPose(this, p);
        if (t >= this.windupUntil) {
          const dmg = this.pendingDamage;
          this.windupUntil = 0;
          this.pendingDamage = 0;
          setWindupPose(this, 0); // arma vuelve a la guardia
          if (dist <= stats.range * WINDUP_RANGE_SLACK && playerDamageHandler) {
            playerDamageHandler(dmg, this);
          }
        }
        return;
      }

      // Perseguir si está fuera de su zona de ataque
      if (dist > stats.range * 0.8) {
        const step = Math.min(stats.speed * dt, dist);
        group.position.x += (dx / dist) * step;
        group.position.z += (dz / dist) * step;
        clampToArena(group.position, arenaRadius, obstacles);
        return;
      }

      // En rango: iniciar windup si el ataque está listo
      if (t >= this.attackCooldownUntil) {
        this.windupUntil = t + WINDUP_TIME;
        this.pendingDamage = stats.damage;
        this.attackCooldownUntil = t + stats.attackCooldown;
        setWindupPose(this, 0);
      }
    },
    takeDamage(n) {
      if (!this.alive) return;
      this.hp = Math.max(0, this.hp - Math.max(0, Number(n) || 0));
      if (this.hp <= 0) {
        this.alive = false;
        this.windupUntil = 0;
        this.pendingDamage = 0;
        this.group.visible = false; // Combat también lo oculta; defensa en profundidad
      }
    },
  };

  return enemy;
}

/**
 * IA del maestro (Duelo): orbita a media distancia, alterna ciclos de
 * aproximación/retirada, esquiva con un dash reactivo cuando el jugador
 * inicia un tajo cerca y telegrafía un giro especial cada MAESTRO_SPECIAL_CD s.
 */
function maestroUpdate(enemy, dt, playerPos, t, player, stats, arenaRadius, obstacles) {
  const pos = enemy.group.position;
  const px = playerPos && typeof playerPos.x === 'number' ? playerPos.x : 0;
  const pz = playerPos && typeof playerPos.z === 'number' ? playerPos.z : 0;
  const dx = px - pos.x;
  const dz = pz - pos.z;
  const dist = Math.hypot(dx, dz);
  const range = stats.range;

  // Fin del giro especial: el golpe conecta si el jugador sigue cerca
  if (enemy.spinUntil > 0 && t >= enemy.spinUntil) {
    enemy.spinUntil = 0;
    setWindupPose(enemy, 0);
    if (dist <= range * 1.8 && playerDamageHandler) {
      playerDamageHandler(Math.round(stats.damage * 1.5), enemy);
    }
  }

  // Giro en curso: rota sobre sí mismo, sin desplazarse
  if (enemy.spinUntil > t) {
    enemy.group.rotation.y += dt * 12;
    return;
  }

  // Mirar siempre al jugador
  if (dist > 1e-4) enemy.group.rotation.y = Math.atan2(dx, dz);

  // Windup en curso: golpe normal (0.5 s) o giro especial (0.7 s)
  if (enemy.windupUntil > 0) {
    const duration = enemy.pendingSpecial ? MAESTRO_SPECIAL_WINDUP : MAESTRO_WINDUP;
    const p = THREE.MathUtils.clamp((t - (enemy.windupUntil - duration)) / duration, 0, 1);
    setWindupPose(enemy, p);
    if (t >= enemy.windupUntil) {
      enemy.windupUntil = 0;
      if (enemy.pendingSpecial) {
        enemy.pendingSpecial = false;
        enemy.spinUntil = t + 0.45;
      } else {
        const dmg = enemy.pendingDamage;
        enemy.pendingDamage = 0;
        setWindupPose(enemy, 0);
        if (dist <= range * WINDUP_RANGE_SLACK && playerDamageHandler) {
          playerDamageHandler(dmg, enemy);
        }
      }
    }
    return;
  }

  // Dash de retirada reactivo al inicio de un tajo del jugador
  if (player && player.alive && typeof player.swingStart === 'number' &&
      player.swingStart > 0 && t >= player.swingStart && t - player.swingStart <= 0.12 &&
      dist < range * 1.6 && t >= enemy.retreatCooldownUntil) {
    enemy.retreatCooldownUntil = t + 2.5;
    enemy.dashUntil = t + 0.22;
    if (dist > 1e-4) {
      enemy.dashX = -dx / dist;
      enemy.dashZ = -dz / dist;
    } else {
      const a = Math.random() * Math.PI * 2;
      enemy.dashX = Math.cos(a);
      enemy.dashZ = Math.sin(a);
    }
  }
  if (enemy.dashUntil > t) {
    pos.x += enemy.dashX * 10 * dt;
    pos.z += enemy.dashZ * 10 * dt;
    clampToArena(pos, arenaRadius, obstacles);
    return;
  }

  // Especial telegrafiado cada 9 s si el jugador está a distancia razonable
  if (t >= enemy.specialAt && dist <= range * 2.2) {
    enemy.specialAt = t + MAESTRO_SPECIAL_CD;
    enemy.windupUntil = t + MAESTRO_SPECIAL_WINDUP;
    enemy.pendingSpecial = true;
    enemy.attackCooldownUntil = Math.max(enemy.attackCooldownUntil, t + MAESTRO_SPECIAL_WINDUP + 0.6);
    setWindupPose(enemy, 0);
    return;
  }

  // Golpe normal telegrafiado en rango y con el ataque listo
  if (dist <= range && t >= enemy.attackCooldownUntil) {
    enemy.windupUntil = t + MAESTRO_WINDUP;
    enemy.pendingDamage = stats.damage;
    enemy.attackCooldownUntil = t + stats.attackCooldown;
    setWindupPose(enemy, 0);
    return;
  }

  // Ciclos de combate: orbitar → aproximarse → retirarse
  if (t >= enemy.duelModeUntil) {
    const modes = ['orbit', 'approach', 'retreat'];
    enemy.duelMode = modes[Math.floor(Math.random() * modes.length)];
    enemy.duelModeUntil = t + 1.2 + Math.random() * 1.4;
    if (Math.random() < 0.5) enemy.orbitSign *= -1;
  }

  const nx = dist > 1e-4 ? dx / dist : 0;
  const nz = dist > 1e-4 ? dz / dist : 0;
  let mx = 0;
  let mz = 0;
  if (enemy.duelMode === 'approach') {
    if (dist > range * 0.75) { mx = nx; mz = nz; }
  } else if (enemy.duelMode === 'retreat') {
    if (dist < range * 1.5) { mx = -nx; mz = -nz; }
  } else {
    // Orbit: mantiene range×0.9 con componente radial correctiva + lateral
    const target = range * 0.9;
    const radial = dist > target ? 0.6 : (dist < target * 0.7 ? -0.6 : 0);
    mx = nx * radial - nz * enemy.orbitSign;
    mz = nz * radial + nx * enemy.orbitSign;
  }
  const len = Math.hypot(mx, mz);
  if (len > 1e-4) {
    mx /= len;
    mz /= len;
    let step = stats.speed * dt;
    if (enemy.duelMode === 'approach') step = Math.min(step, Math.max(0, dist - range * 0.75));
    else if (enemy.duelMode === 'retreat') step = Math.min(step, Math.max(0, range * 1.5 - dist));
    pos.x += mx * step;
    pos.z += mz * step;
    clampToArena(pos, arenaRadius, obstacles);
  }
}

/** Telegraph del windup: el arma se echa atrás y el torso se inclina. p ∈ [0, 1]. */
function setWindupPose(enemy, p) {
  const weapon = enemy.group.getObjectByName('weapon');
  if (weapon) {
    if (enemy.weaponBaseZ == null) enemy.weaponBaseZ = weapon.rotation.z;
    weapon.rotation.z = enemy.weaponBaseZ + Math.sin(p * Math.PI * 0.5) * 0.85;
  }
  enemy.group.rotation.x = -0.14 * Math.sin(p * Math.PI);
}

/** Limita la posición al círculo de la arena y la saca de los obstáculos circulares. */
function clampToArena(pos, radius, obstacles) {
  const max = Math.max((radius || 38) - ENEMY_RADIUS, 1);
  const r = Math.hypot(pos.x, pos.z);
  if (r > max) {
    const s = max / r;
    pos.x *= s;
    pos.z *= s;
  }
  if (obstacles) {
    for (const ob of obstacles) {
      const dx = pos.x - ob.x;
      const dz = pos.z - ob.z;
      const d = Math.hypot(dx, dz);
      const min = (Number(ob.r) || 0) + ENEMY_RADIUS;
      if (d < min && d > 1e-6) {
        const s = min / d;
        pos.x = ob.x + dx * s;
        pos.z = ob.z + dz * s;
      }
    }
  }
  return pos;
}

/** Libera geometrías/materiales propios del enemigo (no los GLB compartidos). */
function disposeEnemy(enemy) {
  if (!enemy || !enemy.group || enemy._disposed) return;
  if (enemy.group.parent) enemy.group.parent.remove(enemy.group);
  if (enemy.ownsResources) {
    enemy.group.traverse((n) => {
      if (!n) return;
      if (n.geometry && typeof n.geometry.dispose === 'function') n.geometry.dispose();
      const mats = Array.isArray(n.material) ? n.material : (n.material ? [n.material] : []);
      for (const m of mats) {
        if (m && typeof m.dispose === 'function') m.dispose();
      }
    });
  }
  enemy._disposed = true;
}

/**
 * Actualiza todos los enemigos. Elimina de la escena y de `list` a los
 * que hayan muerto (hp <= 0), liberando sus recursos propios.
 */
function updateAll(list, dt, playerPos, now, player) {
  if (!Array.isArray(list)) return;
  const t = Number(now) || 0;

  // 1) IA individual
  for (const enemy of list) {
    if (enemy && typeof enemy.update === 'function') enemy.update(dt, playerPos, t, player);
  }

  // 2) Separación: repulsión mútua (reparto del solape)
  for (let i = 0; i < list.length; i += 1) {
    const a = list[i];
    if (!a || !a.alive || !a.group) continue;
    for (let j = i + 1; j < list.length; j += 1) {
      const b = list[j];
      if (!b || !b.alive || !b.group) continue;
      const dx = b.group.position.x - a.group.position.x;
      const dz = b.group.position.z - a.group.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= SEPARATION_RADIUS) continue;
      let nx, nz;
      if (dist > 1e-4) {
        nx = dx / dist;
        nz = dz / dist;
      } else {
        // Solape perfecto: dirección aleatoria estable-ish
        const angle = Math.random() * Math.PI * 2;
        nx = Math.cos(angle);
        nz = Math.sin(angle);
      }
      const push = (SEPARATION_RADIUS - dist) / 2;
      a.group.position.x -= nx * push;
      a.group.position.z -= nz * push;
      b.group.position.x += nx * push;
      b.group.position.z += nz * push;
    }
  }

  // 3) Limpieza: retirar muertos de la escena y de la lista
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const enemy = list[i];
    if (enemy && (enemy.alive === false || (Number(enemy.hp) || 0) <= 0)) {
      disposeEnemy(enemy);
      list.splice(i, 1);
    }
  }
}

export const Enemies = {
  SUPPORTS,
  SEPARATION_RADIUS,
  WINDUP_TIME,
  spawn,
  updateAll,
  onPlayerDamage,
  dispose: disposeEnemy,
};

// Acceso global de sólo lectura para depuración.
if (typeof window !== 'undefined') window.Enemies = Enemies;

export default Enemies;
