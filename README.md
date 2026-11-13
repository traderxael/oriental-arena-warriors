# Oriental Arena Warriors

Juego de combate 3D para navegador, hecho con Three.js r160 y servido como sitio estático. La interfaz está en español y el arte combina samuráis low-poly, piedra, laca roja y oro.

## Estado actual

- Tres guerreros seleccionables: Akane, Goro y Tsuki, un conejo samurái con armadura jade y wakizashi.
- Tres modos jugables: Hordas, Supervivencia por oleadas con power-ups y Duelo contra el Maestro.
- Cuatro mapas seleccionables: Coliseo del Sol Naciente, Templo de los Cuatro Vientos, Pagoda de la Niebla y Jardines del Ciruelo.
- Cada mapa tiene iluminación y decoración propias, puntos de aparición despejados y colisiones para sus obstáculos.
- Cielos y texturas procedurales, árboles de cerezo, columnas, pétalos, estelas de dash, partículas y bloom.
- Modelos GLB riggeados para Akane, Goro y enemigos. Tsuki usa un builder procedural y sigue disponible sin descargas de personaje.
- Calidad Alta, Media y Baja; se puede fijar con `?quality=alta`, `?quality=media` o `?quality=baja`.

## Verificación local

```bash
npm test
npm run test:e2e
```

La suite E2E usa Chromium headless con SwiftShader y guarda capturas en `tests/e2e/shots/`. El 13 de noviembre de 2026 pasaron 53 tests unitarios y las 5 suites E2E; la prueba no sustituye una verificación en una GPU física.

## Motor y publicación

Three.js se carga desde el CDN fijado a r160 en `index.html`, con un espejo jsDelivr documentado. El motor y WebGL deben estar disponibles para jugar; si falta un GLB, el personaje o prop correspondiente usa su builder procedural.

GitHub Pages sirve la raíz de `main` en [traderxael.github.io/oriental-arena-warriors](https://traderxael.github.io/oriental-arena-warriors/). Los cambios locales de esta rama requieren un push aprobado para aparecer en el sitio publicado.

## Controles

| Tecla / acción | Función |
| --- | --- |
| `W` `A` `S` `D` | Mover al guerrero |
| `Shift` | Dash / esquiva |
| Ratón | Apuntar / mirar |
| Clic izquierdo | Ataque / combo |
| `Q` | Habilidad especial |
| `Esc` | Pausa / reanudar |

## Servir localmente

No hay paso de compilación. Desde la raíz del proyecto ejecuta:

```bash
python -m http.server 8000
```

Abre <http://localhost:8000>. No abras `index.html` con `file://`: el navegador debe servir la página por HTTP.

## Créditos

Consulta [CREDITS.md](CREDITS.md) para la procedencia y licencias de los assets.
