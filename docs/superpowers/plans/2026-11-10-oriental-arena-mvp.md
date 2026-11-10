# Oriental Arena Warriors — MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un corte vertical jugable y verificado de Oriental Arena Warriors: menú completo → selección de 2 héroes (Akane, Goro) → mapa Coliseo → modo Hordas Infinitas, con combate 3D en navegador.

**Architecture:** Sitio estático sin build: `index.html` + módulos ES5/ES6 en `js/`, Three.js r160 (o posterior, pinned) vía CDN (unpkg o jsdelivr). La lógica pura (oleadas, scoring, daño de combos) vive en `js/logic.js` sin dependencias de DOM/Three, testeable con `node --test`. Render, input y UI van en módulos separados.

**Tech Stack:** HTML/CSS/JS vanilla, Three.js (CDN, versión pinned exacta), GLTFLoader (examples/jsm vía CDN), `node --test` (sólo para lógica pura; no es dependencia del juego), Web Audio API para SFX.

**Spec:** docs/superpowers/specs/2026-11-10-oriental-arena-warriors-design.md (leer primero; este plan lo implementa para el MVP solamente)

## Global Constraints
- Sin build step para el usuario final; el juego corre sirviendo el repo como sitio estático (`python -m http.server` / `npx serve` / GitHub Pages).
- Three.js y GLTFLoader vía CDN pinned (misma versión exacta en ambos). Google Fonts opcional con degradación.
- Assets 3D del juego commiteados al repo bajo `assets/` con `CREDITS.md` (CC0 / atribución); si la descarga falla, fallback 100% procedural — el juego debe funcionar igual.
- Idioma de la UI: español.
- Controles: WASD mover, Shift dash/esquiva, mouse mira, clic izquierdo ataque/combo, Q habilidad especial, Esc pausa.
- Límite de enemigos vivos simultáneos: 25.
- Desktop + teclado/mouse solamente (sin táctil).
- Git: commits atómicos directos a `main` del repo `traderxael/oriental-arena-warriors`.
- Paleta UI: rojo lacre `#a0342c`, dorado `#d4af37`, papel `#f3e9d2`, tinta `#1a1a1a`.

## Review Focus
1. **Three.js CDN inalcanzable o versión desalineada con GLTFLoader** → pantalla de error legible en español ("No se pudo cargar el motor 3D…") en vez de pantalla negra, y prueba manual de carga con el CDN real. (Task 1, Task 9)
2. **GLB ausente/corrupto o CORS falla en local/Pages** → `js/assets.js` debe caer al builder procedural por personaje/prop sin romper la escena; consola con warning claro. Test manual con asset inexistente. (Task 3, Task 4)
3. **Hordas infinitas sin techo (rendimiento o oleadas imposibles)** → `waveComposition(wave)` acotado: composición e HP escalados con clamp, máximo 25 enemigos vivos, spawn escalonado (no burst de 50). Tests en `logic.test`. (Task 2, Task 6, Task 7)
4. **localStorage con best score inválido/corrupto o bloqueado (modo incógnito)** → `readBest()/writeBest()` con try/catch y valores saneados (número ≥ 0). Tests en `logic.test`. (Task 7)
5. **Combo/hitbox registra daño a través de paredes o a rango absurdo** → golpes sólo en rango y arco frontal definidos por héroe; test de `inArc(attacker, target, range, arc)` en `logic.test`. (Task 5)

---

### Task 1: Scaffold del repo y menú principal

**Files:**
- Create: `index.html`, `css/style.css`, `js/main.js`, `js/ui.js`, `README.md`, `CREDITS.md`, `.gitignore`
- Test: manual (navegador)

**Interfaces:**
- Produces: `ui.showScreen(id)` — muestra sólo la pantalla `#screen-{id}` (`title`, `mode`, `hero`, `map`, `pause`, `gameover`, `hud`); `ui.setHeroCards(heroes)`; `ui.showGameOver(stats)`; `state` global en `main.js` con valores `TITLE|MODE|HERO|MAP|PLAY|PAUSE|GAMEOVER`.

- [ ] **Step 1: Crear estructura y `.gitignore`** (`node_modules/`, `.DS_Store`, `*.log`). Verificar: `git status` lista archivos nuevos.
- [ ] **Step 2: `index.html`** con las 7 pantallas DOM (`#screen-title`, `#screen-mode`, `#screen-hero`, `#screen-map`, `#screen-pause`, `#screen-gameover`, `#hud`). Título: "Oriental Arena Warriors". Menú con botones: JUGAR → modo (Hordas/Supervivencia(próximamente, deshabilitado)/Duelo(próximamente, deshabilitado)) → héroe → mapa (Coliseo habilitado; Templo/Pagoda/Jardines marcados "próximamente") → jugar. Botones deshabilitados con clase `disabled` y tooltip "Disponible en la próxima versión".
- [ ] **Step 3: `css/style.css`** con la paleta global (`--rojo:#a0342c; --dorado:#d4af37; --papel:#f3e9d2; --tinta:#1a1a1a`), layout de menú centrado, tarjetas de héroe/mapa, HUD (barra HP arriba-izq, qi/especial, oleada y score arriba-der), tipografía serif con fallback.
- [ ] **Step 4: `js/main.js`** con máquina de estados mínima (cambio de pantalla vía `ui.showScreen`) y `js/ui.js` implementando `showScreen`. Sin Three.js todavía — al hacer click en "JUGAR" en flujo completo, mostrar HUD vacío con botón "Volver".
- [ ] **Step 5: `README.md`** — qué es, controles, cómo servir local (`python -m http.server 8000` o `npx serve .`), nota de GitHub Pages. **`CREDITS.md`** con sección de assets (vacío por ahora, se llena en Task 3).
- [ ] **Step 6: Verificación manual** — servir el repo, abrir en navegador, recorrer título → modo → héroe → mapa → jugar → volver. Sin errores en consola (excepto 404s previstos aún). Si WebGL no está disponible, `index.html` muestra mensaje claro en español.
- [ ] **Step 7: Verificar CDN** — incluir `<script src="https://unpkg.com/three@0.160.0/build/three.min.js">` y comprobar en consola que `THREE.REVISION === '160'`. Si unpkg falla, probar jsdelivr y dejar el que funcione fijado con comentario de versión. Si **ambos** fallan, commitear `lib/three.min.js` descargado de otra fuente confiable o usar el build UMD de GitHub (`three.js` release) y documentarlo en README (nunca `file://` modules).
- [ ] **Step 8: Commit** `git add -A && git commit -m "feat: scaffold repo and main menu flow"` y push.

### Task 2: Lógica pura testeable (`js/logic.js`)

**Files:**
- Create: `js/logic.js`, `tests/logic.test.mjs`, `package.json` (sólo scripts `test`, sin dependencias)
- Test: `node --test tests/logic.test.mjs`

**Interfaces:**
- Produces (consumed by Tasks 5–7):
  - `waveComposition(wave: number) -> {ronin: number, bandido: number, lancero: number, brute: number, maxAlive: number}` — escala con clamp; oleada 1: `{ronin:3,bandido:0,lancero:0,brute:0}`; oleada 5+ incluye lanceros; múltiplos de 5 incluyen 1 brute; `maxAlive` = min(6 + wave*2, 25); counts totales siempre ≤ 25.
  - `enemyStats(type: 'ronin'|'bandido'|'lancero'|'brute', wave: number) -> {hp, speed, damage, range, attackCooldown}` — hp/damage crecen ×(1 + 0.12*(wave-1)) con clamp hp ≤ 800.
  - `comboDamage(base: number, hitsInCombo: number) -> number` — hits 1..3: multiplicadores 1.0 / 1.15 / 1.4.
  - `inArc(angleToTarget: number, facing: number, arcRad: number, dist: number, range: number) -> boolean` — true si dist ≤ range y |ángulo normalizado| ≤ arcRad/2.
  - `scoreFor(wave: number, kills: number, timeSeconds: number) -> number` — `kills*10 + wave*50 + floor(timeSeconds)`; enteros ≥ 0.
  - `readBest(storage: StorageLike|null) -> number` y `writeBest(storage, value) -> void` — try/catch, saneo a entero ≥ 0, tolera `null`/excepciones.

- [ ] **Step 1: Write failing tests** en `tests/logic.test.mjs` con `node:test` + `assert/strict` cubriendo: oleada 1 exacta; oleada 5 incluye lancero y 1 brute; oleada 20 no supera 25 vivos; hp de brute > hp de ronin en oleada 1; `comboDamage(100,1|2|3)` = 100/115/140; `inArc` true en rango/frontal, false fuera de rango y detrás; `scoreFor(3, 12, 95)` = 120+150+95 = 365; `readBest(null)` = 0; `readBest` con JSON corrupto = 0; `writeBest` no lanza si storage lanza. Exportar `logic.js` como UMD-lite: `if (typeof module!=='undefined') module.exports = {...}` y adjuntar a `window.Logic` en navegador.
- [ ] **Step 2: Run** `node --test tests/logic.test.mjs` — Expected: FAIL (módulo no existe / funciones undefined).
- [ ] **Step 3: Implementar** `js/logic.js` con las 6 funciones puras.
- [ ] **Step 4: Run** `node --test tests/logic.test.mjs` — Expected: PASS todas.
- [ ] **Step 5: Commit** `feat: add pure wave/combat/scoring logic with tests` + push.

### Task 3: Carga de assets con fallback + Coliseo

**Files:**
- Create: `js/assets.js`, `js/maps.js`, `assets/` (GLBs si se descargan), `CREDITS.md` (llenar)
- Test: manual navegador + consola

**Interfaces:**
- Consumes: `THREE`, `GLTFLoader` (Task 1 CDN).
- Produces: `Assets.loadGLB(path, fallbackBuilder) -> Promise<THREE.Group>` (nunca rechaza: loguea warning y devuelve `fallbackBuilder()`); `Maps.buildColosseum(scene) -> {bounds: {minX,maxX,minZ,maxZ}, spawnPoints: Vector3[], radius: number}` — arena circular radio 38 con muro, arcos de coliseo (anillo de pilares/arcos), antorchas (PointLight + llama cono animada), suelo de arena con círculos, gradas; colisión circular: el jugador/enemigo no puede salir de `radius`.

- [ ] **Step 1: Intentar descargar props CC0** de Poly Pizza / Kenney / Quaternius: antorcha/llama, columnas/arcos, cascos/armas (katana odachi), cerezo (para jardines futuros). Guardar en `assets/props/` y llenar `CREDITS.md` con autor, título, fuente URL y licencia (CC0). Si la red o las fuentes fallan: documentar en CREDITS.md "assets procedurales; GLB pendientes" y seguir — el fallback es parte del diseño, no un error.
- [ ] **Step 2: Implementar `js/assets.js`** con `loadGLB(path, fallbackBuilder)`: carga vía GLTFLoader; en `onError` o timeout (8s) devuelve `fallbackBuilder()`; siempre `console.warn` descriptivo.
- [ ] **Step 3: Implementar `js/maps.js` → `buildColosseum(scene)`**: suelo circular (`CircleGeometry` arena `#c9a86a` con anillos oscuros), muro perimetral (cilindro abierto o anillo de cajas), 2 niveles de arcadas (torares: pilares `BoxGeometry` + arcos `TorusGeometry` medio), y 2 antorchas con PointLight + llama (cono animado), puerta principal y 2 laterales (spawnPoints), gradas en 3 anillos (cajas). Sombras activadas. Devuelve `{bounds, spawnPoints, radius:38}`.
- [ ] **Step 4: Verificación manual** — escena con sólo el Coliseo cargados en `#hud` vacío: cámara orbitando lento, sin errores de consola; forzar fallo de GLB (URL rota temporal) y confirmar que el fallback procedural aparece y no hay pantalla negra.
- [ ] **Step 5: Commit** `feat: add asset loader with procedural fallback and colosseum map` + push.

### Task 4: Héroes Akane y Goro (builders) + controlador de jugador

**Files:**
- Create: `js/heroes.js`, `js/player.js`
- Test: manual navegador

**Interfaces:**
- Consumes: `Assets`, `Maps`, `THREE`.
- Produces: `HEROES` — array con 2 objetos completos de héroe: `{id:'akane', name:'Akane', theme:'Samurái', weapon:'Katana', story:'…', stats:{hp:100, speed:6.2, damage:18, range:2.6, comboWindow:0.55}, special:{name:'Desenvaine Relámpago', cooldown:8, desc:'Corte instantáneo en línea…'}, colors:{…}, builder: buildAkane}` y `goro` idéntica forma (`hp:140, speed:4.6, damage:34, range:3.0, special:'Tajo Giratorio'`). `createPlayer(heroId, scene, map) -> {group, update(dt, input, camera), dash(), hp, alive}`. `buildAkane/buildGoro`: personaje procedural low-poly (torso, cabeza, kasa, armadura de color, katana/odachi en mano) — o GLB vía `Assets.loadGLB` si existe en `assets/heroes/`.

- [ ] **Step 1: Definir `HEROES`** en `js/heroes.js` con historia ≤ 280 caracteres (sección "Historia" del personaje legible en la tarjeta de selección; copiar/adaptar del spec: Akane = ronin exiliada; Goro = último samurái).
- [ ] **Step 2: Builders procedurales** — `buildAkane()`: grupo con piernas, torso (armadura lacada roja/negra), cabeza + kasa, katana; `buildGoro()`: más ancho, odachi grande, armadura azul/acero. Ambos ~1.8m alto, `castShadow`. Si hay GLBs, `Assets.loadGLB` devuelve el GLB con materiales tal cual (o fallback a estos builders).
- [ ] **Step 3: `js/player.js`** — `createPlayer`: movimiento WASD relativo a cámara, rotación hacia dirección de movimiento, dash con Shift (impulso + i-frames 0.35s + cooldown 1.2s), clamp circular a `map.radius`. Cámara tercera persona: detrás del jugador (offset ~ (0, 4.2, 6.5)), `lookAt` al jugador, sin atravesar el muro (clamp).
- [ ] **Step 4: Conectar en `main.js`** — al elegir héroe y confirmar "JUGAR", se construye Coliseo + jugador en `PLAY`. Estado `PAUSE` con Esc (congela update, muestra `#screen-pause`).
- [ ] **Step 5: Verificación manual** — elegir Akane y Goro; ambos aparecen visualmente distintos; WASD mueve, Shift dasha, Esc pausa/reanuda; no sale de la arena.
- [ ] **Step 6: Commit** `feat: add akane and goro heroes with player controller` + push.

### Task 5: Combate — combos, hitboxes, daño, especial

**Files:**
- Create: `js/combat.js`
- Modify: `js/player.js`, `js/main.js`
- Test: `node --test tests/logic.test.mjs` (funciones ya testeadas en Task 2) + manual

**Interfaces:**
- Consumes: `Logic.inArc`, `Logic.comboDamage`, `HEROES`, `createPlayer` return.
- Produces: `Combat.tryAttack(player, enemies, now) -> {hits: Enemy[]}` (clic izquierdo; cadena combo 1→2→3 dentro de `comboWindow`, luego reinicia; hitbox = `inArc` con `range`/`arcRad` del héroe, arco 100°); `Combat.trySpecial(player, enemies, now) -> void` (Q; Akane: daño rectilíneo 60 a todos en línea 8m; Goro: AoE 360° radio 3.5m, 50 daño + knockback; cooldown por héroe); eventos `combat:hit` → partículas en `main.js`.

- [ ] **Step 1: Implementar `Combat.tryAttack`** — gestión de `comboStep` y timestamps en el objeto jugador; animación placeholder (rotación de brazo/arma, tween simple por tiempo).
- [ ] **Step 2: Implementar `Combat.trySpecial`** con los dos especiales MVP; mostrar cooldown en HUD (`#hud-special`).
- [ ] **Step 3: Damage flotante** — sprites DOM o `THREE.Sprite` con número que sube y se desvanece (≤ 20 simultáneos).
- [ ] **Step 4: Verificación manual** — en un mapa con 2 dummies (cubos enemigos de prueba), clics producen combo 1/2/3 con daño 18/21/25 (Akane); sin targets detrás; Q ejecuta especial y entra en cooldown; HUD refleja HP.
- [ ] **Step 5: Commit** `feat: add combo combat and hero specials` + push.

### Task 6: Enemigos — ronin y bandido + IA

**Files:**
- Create: `js/enemies.js`
- Modify: `js/main.js`
- Test: manual + `node --test` (ya cubierto `waveComposition`/`enemyStats`)

**Interfaces:**
- Consumes: `Logic.enemyStats`, `Assets.loadGLB`, `Maps` spawnPoints, `Combat` (recibir daño).
- Produces: `Enemies.spawn(type, wave, map, scene) -> Enemy` (`{group, hp, maxHp, type, attackCooldownUntil, takeDamage(n), update(dt, playerPos, now)}`); `Enemies.updateAll(list, dt, playerPos, now)` — persecución directa con separación simple (repulsión entre enemigos, radio 0.9m), ataque al estar a `range` (daño al jugador tras 0.4s de windup), tope `maxAlive` respetado por el spawner. Constructores procedurales distintos por tipo (ronin: gris/ocre con katana; bandido: naranja/sucio, machete, más rápido) — GLB con fallback como en Task 3.

- [ ] **Step 1: Implementar builds procedurales de `ronin` y `bandido`** (reutilizar patrón de `heroes.js`, recolor).
- [ ] **Step 2: Implementar `update`** — mover hacia jugador si `dist > range*0.8`; si en rango y `now > attackCooldownUntil`, windup 0.4s y aplica daño al jugador (flash rojo en pantalla); separación entre enemigos.
- [ ] **Step 3: Integrar spawn por oleadas** en `main.js`/`modes.js`: al iniciar oleada, spawn según `waveComposition(wave)` escalonado cada 0.8s desde spawnPoints aleatorios, respetando 25 vivos.
- [ ] **Step 4: Verificación manual** — oleada 1 spawna 3 ronin; persiguen, atacan (HP del jugador baja), al morir desaparecen con partículas; separación evita stacking perfecto.
- [ ] **Step 5: Commit** `feat: add ronin and bandido enemies with chase AI` + push.

### Task 7: Modo Hordas Infinitas — oleadas, HUD, scoring, game over

**Files:**
- Create: `js/modes.js`
- Modify: `js/main.js`, `js/ui.js`, `index.html`/`css/style.css` (HUD ids)
- Test: `node --test tests/logic.test.mjs` + manual

**Interfaces:**
- Consumes: `Logic.waveComposition/enemyStats/scoreFor/readBest/writeBest`, `Enemies`, `Combat`, `ui`.
- Produces: `Modes.startHorde(ctx)` con loop de oleadas: contador de oleada/kills/tiempo, pausa 3s entre oleadas con banner "OLEADA N", dificultad por `enemyStats(type, wave)`, game over al HP=0 → `ui.showGameOver({wave, kills, time, score, best, isRecord})` + `writeBest`.

- [ ] **Step 1: HUD en `index.html`/`css`** — `#hud-hp` (barra), `#hud-special` (icono + cooldown), `#hud-wave`, `#hud-score`, `#hud-timer`, `#banner-wave` (flash central), `#vignette-damage` (flash rojo).
- [ ] **Step 2: Implementar `Modes.startHorde`** — estado de oleada (spawning → active → intermission), conteo de enemigos vivos, siguiente oleada al matar todos + 3s; banner animado; score acumulado en vivo (`scoreFor`).
- [ ] **Step 3: Game over** — pantalla `#screen-gameover` con stats, mejor puntaje (localStorage `oa_best_horde`), badge "¡NUEVO RÉCORD!" si supera; botones Reintentar / Menú principal.
- [ ] **Step 4: Manejo de `localStorage` bloqueado** — `readBest/writeBest` ya toleran fallos (Task 2); la UI muestra "Mejor: —" si no hay best.
- [ ] **Step 5: Verificación manual** — jugar hasta oleada 3+; oleada 2 incluye bandidos; oleada 5 incluye lancero+brute; morir → resultados correctos; récord persiste tras recargar; en incógnito no rompe.
- [ ] **Step 6: Commit** `feat: add endless horde mode with scoring and game over` + push.

### Task 8: SFX procedurales (Web Audio) y pulido de menú

**Files:**
- Create: `js/audio.js`
- Modify: `js/main.js`, `js/combat.js`, `js/enemies.js`, `js/ui.js`, `index.html`

**Interfaces:**
- Produces: `Audio.init()` (on first user gesture), `Audio.play('slash'|'hit'|'dash'|'special'|'enemyDie'|'waveStart'|'uiClick'|'gameOver'|'hurt')` — osciladores/ruido con envelopes; sin archivos externos.

- [ ] **Step 1: Implementar `js/audio.js`** — `play()` con mapa nombre→síntesis (ruido+bandpass para slash, seno descendente para hit, etc.). Volumen maestro 0.5, `try/catch` silencioso si AudioContext falla.
- [ ] **Step 2: Conectar SFX** en ataque (slash al swing, hit al impactar), dash, especial, muerte de enemigo, banner de oleada, daño recibido, game over, clicks de UI.
- [ ] **Step 3: Pulido de menú** — fondo de título con gradiente animado + silueta de torii/pagoda en CSS, transiciones fade entre pantallas, botones con hover dorado, tarjeta de héroe con stats (barras) e historia.
- [ ] **Step 4: Verificación manual** — cada SFX suena en su evento; nada crashea si el navegador bloquea audio antes de gesto; menú se ve completo a 1280×720 y 1920×1080.
- [ ] **Step 5: Commit** `feat: add procedural audio and menu polish` + push.

### Task 9: Verificación E2E + GitHub Pages

**Files:**
- Modify: `README.md` (sección Pages)

- [ ] **Step 1: Checklist E2E manual** — abrir servido; flujo completo título→jugar→oleada 2→morir→resultados→reintentar; elegir ambos héroes; DevTools sin errores (warnings de GLB aceptables si fallback activo); 30fps+ sostenibles en Coliseo con 15 enemigos.
- [ ] **Step 2: Activar GitHub Pages** — vía `gh api repos/traderxael/oriental-arena-warriors/pages -X POST -f "source[branch]=main" -f "source[path]=/"` (o MCP/web si gh no está autenticado; si falla, indicar al dueño: Settings → Pages → Deploy from branch → main → /). Verificar URL pública `https://traderxael.github.io/oriental-arena-warriors/` carga y es jugable (assets relativos, no absolutos).
- [ ] **Step 3: Actualizar `README.md`** con URL de Pages + instrucciones locales + controles + créditos. Commit + push.
- [ ] **Step 4: Reportar** al dueño: URL pública, qué quedó del MVP, qué falta para la fase 1 (Templo/Pagoda/Jardines, 4 héroes restantes, Duelo y Supervivencia).

## Self-review notes
- Cobertura del spec MVP: scaffold/menús (T1), lógica+tests (T2), mapas+assets (T3), héroes (T4), combate (T5), enemigos (T6), modo hordas (T7), audio/UI (T8), Pages+verificación (T9). Supervivencia, Duelo, 4 héroes y 3 mapas restantes: explícitamente Fase 1, no en este plan.
- Consistencia de tipos: `waveComposition/enemyStats/inArc/comboDamage/scoreFor/readBest/writeBest` se definen en Task 2 y se consumen con esas firmas en Tasks 5–7. `createPlayer` devuelve `{group, update, dash, hp, alive}` y Task 5/7 usan `player.hp`. `ui.showGameOver` y `ui.showScreen` definidos en Task 1 y usados después.
