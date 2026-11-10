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
- Cambios realizados: ninguno (reservada para props de coliseo/templo; aún no se instancia en escena)

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
- Cambios realizados: ninguno (reservada para armas/personajes; aún no se instancia en escena)

### Cherry tree (assets/props/cherry-tree.glb)
- Autor: Poly by Google
- Título: Cherry tree
- Fuente (URL): https://poly.pizza/m/1FSDzk-LRdA — https://static.poly.pizza/9deb3271-411a-476b-a01b-e82e27077e72.glb
- Licencia: CC-BY 3.0 — https://creativecommons.org/licenses/by/3.0/ (atribución: "Cherry tree" by Poly by Google)
- Cambios realizados: ninguno (reservada para el mapa Jardines; aún no se instancia en escena)

Política de assets del proyecto: sólo se commitean assets bajo `assets/` con licencia CC0 o atribución registrada aquí. Si la descarga de un asset falla en cualquier momento, el juego cae a un builder 100% procedural y funciona igualmente.

## Assets procedurales

El Coliseo (arena, muro, gradas, arcadas, puertas, llamas, luces) y los builders de fallback
(antorcha, arco) son 100% procedurales (Three.js, sin archivos externos): suelo de arena
`#c9a86a` con anillos, emblema central lacre/dorado, gradas en 3 anillos de cajas,
2 niveles de arcadas (BoxGeometry + TorusGeometry medio) y muro perimetral cilíndrico
con huecos de puerta.
