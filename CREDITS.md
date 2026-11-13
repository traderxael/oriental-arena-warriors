# Créditos — Oriental Arena Warriors

## Assets 3D

Descargados de [Poly Pizza](https://poly.pizza) el 2026-11-10 y commiteados bajo `assets/props/`.
Los props se cargan en tiempo de ejecución con fallback procedural automático: si un GLB falta,
falla o tarda más de 8 s en cargar, el juego usa un builder procedural equivalente (ver `js/assets.js`).

### Torch (assets/props/torch.glb)
- Autor: Quaternius
- Título: Torch
- Fuente (URL): https://poly.pizza/m/Gq38E7hFZw — https://static.poly.pizza/0dcdbabb-629d-4eee-af16-7c49f6ba6e5e.glb
- Licencia: Public Domain (CC0) — https://creativecommons.org/publicdomain/zero/1.0/
- Cambios realizados: ninguno (se escala/posiciona en runtime)

### Column (assets/props/column.glb)
- Autor: Quaternius
- Título: Column
- Fuente (URL): https://poly.pizza/m/wLubNpOTX4 — https://static.poly.pizza/5239f88f-e30b-452b-a19e-89745d580b1e.glb
- Licencia: Public Domain (CC0) — https://creativecommons.org/publicdomain/zero/1.0/
- Cambios realizados: ninguno (Coliseo, Templo y Pagoda; con colisionadores circulares)

### Arch (assets/props/arch.glb)
- Autor: Quaternius
- Título: Arch
- Fuente (URL): https://poly.pizza/m/QwWdOcNIMh — https://static.poly.pizza/b4f2ce7f-e692-4b4c-aa2e-0d6b6e42d552.glb
- Licencia: Public Domain (CC0) — https://creativecommons.org/publicdomain/zero/1.0/
- Cambios realizados: ninguno (se escala/posiciona en runtime sobre la puerta principal)

### Katana (assets/props/katana.glb)
- Autor: Pichuliru
- Título: Katana
- Fuente (URL): https://poly.pizza/m/15A7InejC7 — https://static.poly.pizza/3ea3ea0b-6eba-4809-af0a-c8aea9220f7f.glb
- Licencia: Public Domain (CC0) — https://creativecommons.org/publicdomain/zero/1.0/
- Cambios realizados: ninguno (se usa como arma de los héroes; el builder procedural queda como fallback)

### Cherry tree (assets/props/cherry-tree.glb)
- Autor: Poly by Google
- Título: Cherry tree
- Fuente (URL): https://poly.pizza/m/1FSDzk-LRdA — https://static.poly.pizza/9deb3271-411a-476b-a01b-e82e27077e72.glb
- Licencia: CC-BY 3.0 — https://creativecommons.org/licenses/by/3.0/ (atribución: "Cherry tree" by Poly by Google)
- Cambios realizados: ninguno (Coliseo y Jardines; con colisionadores circulares)

## Personajes generados con IA (assets/characters/)

Generados el 2026-11-11 con [Hyper3D Rodin](https://hyper3d.ai) (API v2, tier Gen-2.5-Low)
a partir de prompts de texto propios del proyecto, y riggeados con el endpoint de
rigging de Rodin (plantilla humana, 52 huesos, clips de animación incluidos).
Los outputs de Rodin son propiedad del usuario de la cuenta según sus términos de
servicio; se commitean aquí como assets del proyecto.

- `akane.glb` — ronin femenina (héroe jugable). 21.0k tris, 1.6 MB.
- `goro.glb` — samurái pesado (héroe jugable). 21.0k tris, 1.6 MB.
- `ashigaru.glb` — base enemiga compartida (bandido/lancero/ronin por tinte). 9.5k tris, 0.9 MB.
- `oni.glb` — brute enemigo. 12.5k tris, 1.0 MB.

Cambios realizados tras la generación: rigging (52 huesos + clips
`HumanSpOffensiveIdle`, `HumanSpJogging`/`HumanSpWalking`, `HumanSpDying`),
fusión de influencias de skin a 4 por vértice (requisito de Three.js),
simplificación de malla (meshoptimizer, modo permisivo + compactación), cuantización de atributos
(KHR_mesh_quantization) y texturas WebP (1024 héroes / 512 enemigos).
Presupuesto total de descarga: 5.1 MB (tope del plan: 10 MB).
Coste en créditos Rodin: 4.0 de un tope de 12 (4 generaciones × 0.5 + 4 rigs × 0.5).
Las armas siguen siendo procedurales / `assets/props/katana.glb`.
Si un GLB de personaje falta o falla, el juego usa el builder procedural
equivalente de `js/heroes.js` / `js/enemies.js` (fallback siempre jugable).

### Tsuki — conejo samurái

Tsuki está modelado proceduralmente en `js/heroes.js` con geometría básica de Three.js: pelaje claro, orejas rosadas, armadura jade, obi bermellón y cola. No usa un modelo externo. Su wakizashi reutiliza `assets/props/katana.glb`, con arma procedural si ese archivo no carga.

Política de assets del proyecto: sólo se commitean assets bajo `assets/` con licencia CC0 o atribución registrada aquí. Si la descarga de un asset falla en cualquier momento, el juego cae a un builder 100% procedural y funciona igualmente.

## Assets procedurales

El Coliseo (arena, muro, gradas, arcadas, puertas, llamas, luces) y los builders de fallback
(antorcha, arco) son 100% procedurales (Three.js, sin archivos externos): suelo de arena
`#c9a86a` con anillos, emblema central lacre/dorado, gradas en 3 anillos de cajas,
2 niveles de arcadas (BoxGeometry + TorusGeometry medio) y muro perimetral cilíndrico
con huecos de puerta.

El Templo de los Cuatro Vientos, la Pagoda de la Niebla y los Jardines del Ciruelo
se construyen con geometria y materiales procedurales de Three.js, sin descargas
nuevas. Jardines reutiliza los cerezos acreditados arriba; las columnas, edificios,
torii, faroles, estanque y caminos de estos mapas son procedurales.
