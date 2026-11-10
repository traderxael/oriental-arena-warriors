# Oriental Arena Warriors — Diseño

Fecha: 2026-11-10
Repo: https://github.com/traderxael/oriental-arena-warriors

## Intención / por qué
Un juego web 3D de acción cuerpo a cuerpo con temática oriental, jugable en el navegador, pensado para partidas rápidas de peleas contra oleadas y duelos. Inspirado en Dynasty Warriors (hordas), juegos de arena 1v1, y fantasía wuxia/xianxia china y japonesa. Debe verse estilizado y coherente sin depender de servidores externos en runtime.

## Objetivos
- Juego completo y jugable en el navegador, Three.js por CDN, sin build step para el usuario final.
- Tres modos de batalla: **Hordas Infinitas** (oleadas cada vez más difíciles, puntuación), **Supervivencia Mundo Abierto** (arena grande, exploración ligera + oleadas que se intensifican), **Duelo 1v1** (jugador vs IA en coliseo/templo).
- Selección de personaje con menú principal completo: título → modo → personaje → mapa → jugar → game over/resultados.
- 6 héroes jugables (2 por temática), cada uno con historia, stats y habilidad especial distintos.
- 4 mapas: Coliseo (decoración romana), Templo, Pagoda, Jardines.
- Assets 3D gratuitos (CC0: Quaternius / Poly Pizza / Kenney) descargados y commiteados al repo (no hotlinks); con **fallback procedural** (personajes low-poly construidos con primitivas) si un GLB no carga o no existe.

## No-objetivos / anti-objetivos
- No multijugador online, no cuentas, no backend, no monetización.
- No modelos fotorrealistas ni cinemáticas.
- No soporte móvil/táctil en esta versión (desktop + teclado/mouse).
- No audio con assets con copyright; SFX generados proceduralmente (Web Audio API) o CC0.

## Héroes (6)
| Héroe | Temática | Arma | Estilo / rol | Historia (resumen) |
|---|---|---|---|---|
| **Akane** | Samurái | Katana (2 cortes + desenvainado) | Equilibrada, daño medio, esquiva rápida | Ronin mujer exiliada de clan Satsuma; busca redenición en la arena |
| **Goro** | Samurái | Odachi (gran katana) | Lento, mucho daño, poca movilidad | Último samurái de su dominio; pelea por honor tras la caída de su señor |
| **Li Wei** | Artes Marciales | Puños + báculo (staff) | Rápido, combos, corto alcance | Monje de Shaolin caído en desgracia que busca al verdadero enemigo |
| **Mei** | Artes Marciales | Espada de mariposa doble / fan + puntapiés | Movilidad extrema, daño bajo, combos de aire | Jongladora/luchadora de wushu callejera, pelea por su distrito |
| **Shen** | Cultivador | Espada de qi (ranged de energía) | Control a distancia media, carga de qi | Cultivador de espadas xianxia; ascendió demasiado rápido y perdió su secta |
| **Yan** | Cultivador | Cuerdas/talismanes de fuego | Burst AoE, gran daño, enfriamiento largo | Alquimista rebelde que dominó las llamas prohibidas |

Cada héroe: HP, velocidad, daño, alcance de combo básico, habilidad especial única (Q) con enfriamiento, y pasiva simple. Habilidad especial ejemplo: Akane = desenvainado instantáneo en línea; Goro = tajo giratorio AoE; Li Wei = palma de qi empuje; Mei = salto triple con puntapié; Shen = ráfaga de proyectiles de qi; Yan = explosión de llamas AoE.

## Enemigos
- **Ronin sin amo** (melee básico), **Bandido/Berserker** (carga), **Lancero** (alcance), **Brute/Oni** (tanque, golpes lentos devastadores). Variantes por mapa con recolor (coliseo: gladiadores; templo/pagoda: sectarios rebeldes; jardines: bandidos).
- IA simple: spawn en bordes/puertas, persecución, ataque en rango, cooldowns, raycast de golpe. Oleadas con composición escalada.

## Modos
1. **Hordas Infinitas**: en un mapa de arena (coliseo/templo/pagoda/jardines seleccionable), oleadas infinitas; cada 5 oleadas aparece un Brute/mini-boss. Puntuación = enemigos derrotados + oleada alcanzada + tiempo. Game over al morir → pantalla de resultados con stats y récord en localStorage.
2. **Supervivencia Mundo Abierto**: mapa más grande (jardines/templato con zonas abiertas), oleadas que aparecen en anillos crecientes, power-ups (orbes de qi, curación, buff de daño) que spawnan; dificultad progresiva; objetivo: sobrevivir el mayor tiempo posible.
3. **Duelo 1v1**: jugador vs 1 héroe IA (seleccionable o aleatorio) en coliseo/templo, HP completo, primero en vaciar la vida gana. IA con la misma lógica de combate; dificultad normal.

## Arquitectura y archivos
Sin build. `index.html` en la raíz del repo, Three.js por CDN (unpkg/jsdelivr, pinned version). Estructura:

```
index.html            — markup + menús (UI DOM overlay) + carga de scripts
css/style.css         — estilos de menús y HUD (estética oriental: rojo sello, dorado, tinta, papel)
js/main.js            — bootstrap, game loop, estados (MENU → SELECT → PLAY → GAMEOVER)
js/assets.js          — carga GLTF con fallback procedural
js/maps.js            — construcción procedural de los 4 mapas (colisiones simples)
js/heroes.js          — definiciones de héroes/stats/historia
js/enemies.js         — tipos de enemigos e IA
js/modes.js           — lógica de los 3 modos (oleadas, scoring, win/lose)
js/combat.js          — combos, hitboxes, daño, habilidades especiales
js/ui.js              — menús DOM, HUD (HP, qi, oleada, score), resultados
assets/               — GLBs CC0 descargados (personajes, props) + créditos en CREDITS.md
README.md             — cómo jugar, controles, cómo correr local (python -m http.server / npx serve)
```

Alternativa considerada (descartada): single-file único — se eligió multi-archivo por mantenibilidad, sigue siendo "abrir index.html vía servidor local", ideal para GitHub Pages (documentado en README).

## Visual y audio
- Estilo low-poly estilizado con niebla, luz cálida de sol/atardecer, sombras. Coliseo: estructura de arcos + antorchas; Templo: salón + linternas + torii; Pagoda: torre de varios pisos + cerezos; Jardines: lago, puente, piedras.
- UI con tipografía serif/estilo caligráfico (fuentes del sistema o Google Fonts CDN — opcional, degradación elegante), paleta rojo lacre `#a0342c`, dorado `#d4af37`, papel `#f3e9d2`, tinta `#1a1a1a`.
- SFX: Web Audio API (golpes, cortes, explosiones de qi, rugido de oleada, UI clicks). Música: pads ambientales simples generados proceduralmente.

## Controles
- WASD mover, Shift esquiva/dash, mouse mira, clic izquierdo ataque/combo, clic derecho o espacio habilidad, Q habilidad especial (Ultimate), Esc pausa/menú.

## Restricciones y riesgos
- Assets CC0 reales pueden no cubrir 6 héroes con animaciones consistentes → mitigación: personajes **procedurales con armadura/colores distintivos** + props GLB (armas, árboles, linternas, torii, arcos de coliseo) descargados de Poly Pizza/Kenney/Quaternius. Si los GLB no se pueden descargar en el entorno, se commitea igualmente el juego con fallback 100% procedural y CREDITS.md documenta los assets previstos.
- Performance: instanciar enemigos con `InstancedMesh` donde se pueda o clonar grupos con bajo poly; límite de enemigos vivos simultáneos (~25) con spawn por oleadas.
- CORS/archivos locales: README indica servir con un servidor estático simple; GitHub Pages soportado.

## Respuestas del dueño (2026-11-10)
- **Alcance: MVP primero.** Entregar un corte vertical jugable y verificado (1–2 héroes, 1 mapa, modo Hordas Infinitas funcionando end-to-end), y expandir después en iteraciones siguientes (más héroes, mapas, modos). Esto reordena el plan de trabajo: MVP primero, contenido después.
- **GitHub Pages: activado.** Parte de "terminado" incluye habilitar Pages en el repo y verificar la URL pública jugable (con GLBs sirviendo con MIME correctos por ser estático — sin build).
- Three.js vía CDN pinned confirmado por el dueño (la sección "Intención" queda matizada: el juego requiere conexión al CDN de Three.js; los assets 3D del juego **sí** van commiteados al repo, y Google Fonts es opcional con degradación elegante).
- Git: commits atómicos directo a `main` del repo `traderxael/oriental-arena-warriors` (repo nuevo, dueño único).
- Granularidad del plan: a nivel tarea con verificación por tarea (no sólo fases).

## Enfoques considerados
- **A. Todo procedural, sin GLBs:** máximo control y cohesión, pero menos "modelo 3D de verdad".
- **B. Assets GLB CC0 + fallback procedural (elegido por el dueño del repo):** visualmente más rico; riesgo de inconsistencia de estilo/animaciones, mitigado con fallback por personaje y props compartidos.
- **C. Single-file HTML:** más simple de distribuir, peor de mantener; descartado por tamaño del proyecto.

## Plan de trabajo (alto nivel) — MVP primero
**Fase 0 (MVP / corte vertical, juegable y verificado):**
1. Scaffold repo: README, CREDITS.md, estructura, index.html con menú principal (título → modo → personaje → mapa → jugar).
2. Sistemas base: loop, estados, cámara 3ra persona, colisiones circulares, HUD.
3. 1 mapa (Coliseo, el más icónico) + assets GLB CC0 o fallback procedural.
4. 1–2 héroes jugables (Akane + Goro) con stats e historia visibles en el menú.
5. Combate (combos, dash, especial) + 2 enemigos + IA + oleadas.
6. Modo Hordas Infinitas completo + scoring + game over + localStorage.
7. SFX básicos + verificación en navegador + commit/push.
8. Activar GitHub Pages + verificar URL pública.

**Fase 1 (expansión, tras aprobación del MVP):** 4 héroes restantes, mapas Templo/Pagoda/Jardines, modos Duelo 1v1 y Supervivencia Mundo Abierto, power-ups, pulido de UI/animaciones/música.

## Lo que queda a criterio del builder
Nombres exactos de archivos internos, detalles de tuning de dificultad, fórmulas de daño, y selección final de GLBs concretos (respetando CC0 + atribución + fallback).
