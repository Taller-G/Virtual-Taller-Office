# El mapa de la oficina

El plano de la oficina es **datos, no código**: un archivo [Tiled](https://www.mapeditor.org/) en
`apps/client/public/assets/map/oficina-taller.json`. Cualquiera del equipo puede abrirlo en Tiled,
mover escritorios, agregar una sala o cambiar dónde aparece la gente, guardar, y la app lo toma sin
tocar una línea de código. Este documento dice qué espera la app de ese archivo.

## Abrir y editar

1. Instalá Tiled (gratis, <https://www.mapeditor.org/>). Probado con Tiled 1.11.
2. `File → Open…` y elegí `apps/client/public/assets/map/oficina-taller.json`. Tiled abre mapas JSON
   directamente; guardá siempre en el mismo archivo y en formato JSON (no `.tmx`).
3. Las imágenes de los tilesets están en `apps/client/public/assets/tilesets/`. El mapa las referencia
   con rutas relativas (`../tilesets/X.png`), así que no muevas ni renombres esa carpeta.
4. Guardá y recargá el navegador. En desarrollo, el servidor lee el mapa al crear la sala: si cambiaste
   el punto de aparición, reiniciá `npm run dev` para que lo tome.

Para ver las colisiones dentro de la app abrí el cliente con `?debug` en la URL
(`http://localhost:5173/?debug`): los tiles que bloquean se pintan de amarillo y los muebles sólidos
en azul.

## Qué espera la app

La app **no depende de los nombres de las capas**. Recorre todas las capas en el orden en que están en
Tiled (de abajo hacia arriba) y decide por el tipo de capa y por las propiedades personalizadas.
Los nombres que hay hoy (`Piso`, `Paredes`, `Muebles`, `MueblesColision`, `Zonas`, `Spawn`) son una
convención para que el archivo se entienda, no un requisito.

### Capas de tiles (piso y paredes)

- Se dibujan en el orden de Tiled. Podés tener las que quieras.
- Un tile **bloquea el paso** si en el tileset tiene la propiedad `collides` (bool) en `true`.
  La propiedad se pone en el tileset (seleccionar el tile → Custom Properties), no en el mapa:
  así toda pared que pintes colisiona sola. En `FloorAndGround` ya están marcados todos los tiles
  de pared.
- Convención: `Piso` para lo transitable y `Paredes` para lo que bloquea. Separarlas hace que el
  archivo sea fácil de leer y de revisar en un PR.

### Capas de objetos (muebles)

Los muebles son **objetos-tile** (herramienta "Insert Tile" de Tiled) en capas de objetos:

- Cada objeto se dibuja como un sprite en su posición. Su profundidad es su borde inferior, así los
  avatares pasan por delante de un escritorio cuando están más abajo y por detrás cuando están más
  arriba.
- Un objeto **bloquea el paso** si su propiedad `collides` es `true`. Si el objeto no la tiene,
  hereda la propiedad `collides` de **su capa**. Si ninguna la tiene, no bloquea.
- Convención: capa `MueblesColision` con `collides = true` para lo sólido (escritorios, mesas,
  mostradores, plantas grandes) y capa `Muebles` con `collides = false` para lo decorativo (cuadros,
  alfombras, sillas: las sillas no bloquean para poder "sentarse" más adelante).
- Para una excepción puntual, ponele `collides` al objeto: gana sobre la capa.
- Los objetos pueden estar volteados (flip horizontal/vertical) y escalados; se respeta.
- Las sillas conservan la propiedad `direction` (`up/down/left/right`) heredada de SkyOffice y
  las sillas, computadoras y pizarras tienen clase `chair`, `computer`, `whiteboard`. Hoy la app no
  las usa; quedan para las tareas de interacción.

### Punto de aparición (obligatorio)

- Exactamente **un** objeto con clase `spawn` (campo _Class_ del objeto; en el JSON es `type`).
  Puede ser un punto o un rectángulo (se usa el centro).
- Propiedad opcional `radius` (int, px): los jugadores aparecen repartidos al azar dentro de ese
  radio para no apilarse. Si falta, 32 px.
- El servidor lo lee al arrancar y es quien asigna la posición inicial a cada jugador. Si no hay
  spawn, hay más de uno, o cae sobre un tile que colisiona, **el servidor no arranca** y dice por qué.

### Zonas (recomendado)

- Rectángulos con clase `zone` y un nombre (`Recepción`, `Escritorios`, `Sala de reunión`,
  `Cocina y descanso`…). La app muestra el nombre como etiqueta en la esquina superior izquierda
  de cada zona.
- Las pruebas del servidor exigen que existan al menos esas cuatro zonas.

### Tilesets

- Tienen que estar **embebidos** en el mapa (al agregar un tileset marcá "Embed in map"; si ya
  existe, botón "Embed tileset" en el panel Tilesets). La app no carga archivos `.tsx` externos.
- Para agregar un tileset nuevo: copiá el PNG a `apps/client/public/assets/tilesets/`, agregalo en
  Tiled con su tamaño de tile, y listo: el cliente lo carga solo leyendo el mapa. Documentá la
  licencia en `docs/licencias-assets.md` (ver ahí qué licencias sirven).
- Tamaño de tile del mapa: 32×32. Los tilesets de muebles pueden tener otro tamaño (las sillas son
  32×64, los escritorios con computadora 96×64).

## Resumen del contrato

| Qué                   | Dónde                        | Cómo                                              |
| --------------------- | ---------------------------- | ------------------------------------------------- |
| Colisión de un tile   | Tileset → tile → propiedad   | `collides: true` (bool)                           |
| Colisión de un mueble | Objeto o su capa → propiedad | `collides: true`; el objeto pisa a la capa        |
| Punto de aparición    | Objeto (punto o rectángulo)  | clase `spawn`; opcional `radius` (int, px); único |
| Zona con nombre       | Objeto rectángulo            | clase `zone` + nombre                             |
| Tilesets              | Mapa                         | embebidos, imágenes relativas al archivo del mapa |
| Formato               | Archivo                      | Tiled JSON, ortogonal, tamaño fijo (no infinito)  |

Las constantes de estos nombres viven en `packages/shared/src/map.ts`, que usan cliente y servidor.

## Verificar un mapa

```bash
npm test -w apps/server      # incluye las pruebas del mapa real: spawn, zonas, tilesets, colisiones
```

Si un mapa no cumple el contrato, `npm run dev` falla al arrancar el servidor con el detalle
(`El mapa "…" no es válido: …`), y el cliente muestra un mensaje si no puede cargar el archivo o
una imagen de tileset.

## Usar otro mapa sin reemplazar el archivo

- Servidor: variable `MAP_FILE=/ruta/al/mapa.json`.
- Cliente: `VITE_MAP_URL=/assets/map/otro.json` en tiempo de build (las imágenes se resuelven
  relativas a esa URL).

## Origen

El plano parte del mapa de [SkyOffice](https://github.com/kevinshen56714/SkyOffice) (MIT), retocado
para la oficina de Taller: recepción con spawn, cocina y descanso con mostrador, bacha, heladera y
expendedora, sala de reunión con mesa y pizarra, y sala de escritorios con puestos adicionales.
Los gráficos son de LimeZu; ver `docs/licencias-assets.md`.
