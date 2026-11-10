# Oriental Arena Warriors

Juego web 3D (Three.js) de peleas contra hordas en una arena con temática oriental: samuráis, artes marciales y cultivadores.

## Qué es

Oriental Arena Warriors es un juego de navegador, sin paso de compilación: la página se sirve tal cual como sitio estático. Combate por oleadas en una arena 3D, con héroes seleccionables y una estética de papel, lacre y oro.

## Estado del proyecto

MVP implementado: flujo título → modo → héroe (Akane y Goro) → arena → HUD → resultados → reintentar. Modo Hordas infinito con oleadas acotadas (máximo 25 enemigos vivos), Coliseo del Sol Naciente 3D y fallback procedural si un GLB falta. Verificado durante el desarrollo: `node --test` 28/28 y verificación headless (Playwright, Chromium) de cada sistema; pendiente: una pasada E2E en un navegador real con GPU. Los modos «Próximamente» (Supervivencia, Duelo) y las arenas (Templo, Pagoda, Jardines) llegarán en la Fase 1.

## Motor 3D

Three.js se carga desde CDN fijado a **r160** como módulos ES con import map en `index.html` (`https://unpkg.com/three@0.160.0/build/three.module.js` y `three/addons/` para GLTFLoader, misma versión). Si unpkg deja de funcionar, index.html documenta el espejo equivalente de jsDelivr. Si el motor no carga o el navegador no soporta WebGL, la página muestra un mensaje de error en español en lugar de una pantalla negra. Los GLB de `assets/props/` caen al builder procedural automáticamente si faltan, fallan o tardan más de 8 s en cargar.

## GitHub Pages

El sitio está publicado y sirve el juego (verificado: la página carga el shell y los menús completos) en:

**https://traderxael.github.io/oriental-arena-warriors/**

Servido como sitio estático desde `main` (raíz `/`), sin workflow de build. Todos los assets se referencian con rutas relativas (`assets/...`). El motor (Three.js r160 desde CDN en tu navegador) se carga en tiempo de ejecución; si unpkg falla, usá el espejo jsDelivr documentado en `index.html` o serví el repo localmente.

## Controles

| Tecla / acción      | Función                     |
| ------------------- | --------------------------- |
| `W` `A` `S` `D`     | Mover al guerrero           |
| `Shift`             | Dash / esquiva              |
| Ratón               | Apuntar / mirar             |
| Clic izquierdo      | Ataque / combo              |
| `Q`                 | Habilidad especial          |
| `Esc`               | Pausa / reanudar            |

Sólo escritorio con teclado y ratón (sin táctil). La interfaz está en español.

## Cómo servir localmente

No hay build. Sirve el repo como sitio estático desde la raíz:

```bash
# Opción 1: Python
python -m http.server 8000

# Opción 2: Node
npx serve .
```

Luego abre <http://localhost:8000> en el navegador.

> Abrir `index.html` con doble clic (`file://`) **no** está soportado: los navegadores bloquean la carga de recursos bajo `file://`. Usa siempre un servidor estático.

## Créditos

Ver [CREDITS.md](CREDITS.md).
