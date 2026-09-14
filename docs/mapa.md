# Los mapas de los mundos

Cada **mundo** de la oficina (la First Office, la Chiron Office…) es un lugar con su propio mapa,
su propia gente y su propio chat, y se llega de uno a otro **caminando por una puerta**. Un mapa es
**datos, no código**: un archivo [Tiled](https://www.mapeditor.org/) en
`apps/client/public/assets/map/`. Cualquiera del equipo puede abrirlo en Tiled, mover escritorios,
agregar una sala, cambiar dónde aparece la gente o poner una puerta a otro mundo, guardar, y la app
lo toma sin tocar una línea de código. Este documento dice qué espera la app de esos archivos.

Qué mundos existen y qué archivo usa cada uno se declara en
[`packages/shared/src/worlds.ts`](../packages/shared/src/worlds.ts) (ver
["Agregar un mundo"](#agregar-un-mundo)).

## Abrir y editar

1. Instalá Tiled (gratis, <https://www.mapeditor.org/>). Probado con Tiled 1.11.
2. `File → Open…` y elegí el mapa del mundo que quieras editar, por ejemplo
   `apps/client/public/assets/map/oficina-taller.json` (la First Office). Tiled abre mapas JSON
   directamente; guardá siempre en el mismo archivo y en formato JSON (no `.tmx`).
3. Las imágenes de los tilesets están en `apps/client/public/assets/tilesets/`. El mapa las referencia
   con rutas relativas (`../tilesets/X.png`), así que no muevas ni renombres esa carpeta.
4. Guardá y recargá el navegador. En desarrollo, el servidor lee los mapas al arrancar: si cambiaste
   un punto de aparición o una puerta, reiniciá `npm run dev` para que los tome.

Para ver las colisiones dentro de la app abrí el cliente con `?debug` en la URL
(`http://localhost:5173/?debug`): los tiles que bloquean se pintan de amarillo, los muebles sólidos
en azul, los puntos de aparición en verde (con su radio) y las **puertas** en violeta, con el mundo
y el spawn a los que llevan.

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

### Puntos de aparición (obligatorio)

Objetos con clase `spawn` (campo _Class_ del objeto; en el JSON es `type`). Pueden ser un punto o
un rectángulo (se usa el centro).

- **La entrada del mundo**: exactamente **un** spawn sin nombre (el que ya existía se llama `spawn`
  y también cuenta como sin nombre). Es donde aparece quien entra a ese mundo desde la app.
- **Puntos de llegada**: los demás spawns llevan **nombre** (el campo _Name_ del objeto). Son el
  destino de las puertas de otros mundos, y el nombre es lo que esas puertas mencionan. Los nombres
  no se repiten dentro de un mapa.
- Propiedad opcional `radius` (int, px): los jugadores aparecen repartidos al azar dentro de ese
  radio para no apilarse. Si falta, 32 px. Para un punto de llegada conviene un radio chico (8 px)
  y ubicarlo **fuera** del área de la puerta de vuelta, para no volver por donde se vino.
- Propiedad opcional `dir` (string: `up`, `down`, `left`, `right`): hacia dónde queda mirando quien
  aparece ahí. En un punto de llegada se usa para quedar **de espaldas a la puerta** por la que se
  entró. Si falta, `down`.
- El servidor los lee al arrancar y es quien asigna la posición inicial a cada jugador. Si falta la
  entrada, hay más de una, se repite un nombre o alguno cae sobre un tile que colisiona, **el
  servidor no arranca** y dice por qué.

### Puertas a otros mundos

Un rectángulo con clase `door` es una puerta: **se cruza caminando**, sin tecla ni confirmación. En
cuanto los pies entran en el área, el jugador sale de este mundo y aparece en el otro.

- Propiedad `world` (string, obligatoria): id del mundo destino, tal como figura en
  `packages/shared/src/worlds.ts` (por ejemplo `chiron-office`).
- Propiedad `spawn` (string, obligatoria): nombre del punto de llegada **en ese mundo**.
- El _Name_ del objeto es para las personas (aparece en los mensajes de error y en `?debug`); la app
  muestra sobre la puerta el nombre visible del mundo al que lleva.
- Poné la puerta sobre piso transitable, pegada a la pared que haga de umbral: si cae sobre un tile
  que colisiona no se puede pisar.
- **Las dos puntas**: para que se pueda ir y volver, el otro mapa necesita su propia puerta de
  vuelta y su punto de llegada. Un mundo sin puerta de salida es un mundo del que no se sale.
- Al arrancar, el servidor valida **todas** las puertas de **todos** los mundos: si una lleva a un
  mundo o a un spawn que no existe, no arranca y nombra la puerta y el destino que falta.

### Ambiente (opcional)

Propiedad del **mapa** (no de una capa) `ambient`, de tipo color (`#AARRGGBB`): el cliente pinta ese
color encima de todo el mundo. La opacidad es la parte `AA`. En la Chiron Office está bajo
(`#4d080d1a`) a propósito: lo oscuro son los tiles, no el velo, y el velo solo apaga los muebles,
que vienen de packs claros. Subirlo mucho apaga también a los avatares.

### Zonas (recomendado)

- Rectángulos con clase `zone` y un nombre (`Recepción`, `Escritorios`, `Sala de reunión`,
  `Cocina y descanso`, `Sala de reunión Sur`, `Sala de reunión Este`, `Sala de foco`…). La app
  muestra el nombre como etiqueta en la esquina superior izquierda de cada zona.
- Las pruebas del servidor exigen que existan al menos esas cuatro zonas, más las tres salas del
  ala sur, y que se llegue caminando desde el spawn a **todas** las zonas: una sala sin puerta
  transitable hace fallar las pruebas. En la Chiron Office exigen lo mismo (todas sus zonas
  alcanzables, con nombre y sin repetir) más que exista el `Vestíbulo`.
- La etiqueta es blanca sobre una placa `#1b1f2acc`, así que se lee igual sobre un piso claro que
  sobre uno oscuro; no hace falta tocar nada al hacer un mundo oscuro.

### Tilesets

- Tienen que estar **embebidos** en el mapa (al agregar un tileset marcá "Embed in map"; si ya
  existe, botón "Embed tileset" en el panel Tilesets). La app no carga archivos `.tsx` externos.
- Para agregar un tileset nuevo: copiá el PNG a `apps/client/public/assets/tilesets/`, agregalo en
  Tiled con su tamaño de tile, y listo: el cliente lo carga solo leyendo el mapa. Documentá la
  licencia en `docs/licencias-assets.md` (ver ahí qué licencias sirven).
- Tamaño de tile del mapa: 32×32. Los tilesets de muebles pueden tener otro tamaño (las sillas son
  32×64, los escritorios con computadora 96×64).

## Resumen del contrato

| Qué                   | Dónde                        | Cómo                                                         |
| --------------------- | ---------------------------- | ------------------------------------------------------------ |
| Colisión de un tile   | Tileset → tile → propiedad   | `collides: true` (bool)                                      |
| Colisión de un mueble | Objeto o su capa → propiedad | `collides: true`; el objeto pisa a la capa                   |
| Entrada del mundo     | Objeto (punto o rectángulo)  | clase `spawn` **sin nombre**; opcional `radius` (int); único |
| Punto de llegada      | Objeto (punto o rectángulo)  | clase `spawn` + nombre único; opcional `radius` y `dir`      |
| Puerta a otro mundo   | Objeto rectángulo            | clase `door` + `world` (id) y `spawn` (nombre) del destino   |
| Zona con nombre       | Objeto rectángulo            | clase `zone` + nombre                                        |
| Ambiente del mundo    | Mapa → propiedad             | `ambient` (color `#AARRGGBB`)                                |
| Tilesets              | Mapa                         | embebidos, imágenes relativas al archivo del mapa            |
| Formato               | Archivo                      | Tiled JSON, ortogonal, tamaño fijo (no infinito)             |

Las constantes de estos nombres viven en `packages/shared/src/map.ts`, que usan cliente y servidor.

## Verificar un mapa

```bash
npm test -w apps/server      # mapas reales de todos los mundos: spawns, puertas, zonas, tilesets
```

Si un mapa no cumple el contrato, `npm run dev` falla al arrancar el servidor con el detalle
(`El mapa "…" no es válido: …`), y el cliente muestra un mensaje si no puede cargar el archivo o
una imagen de tileset. Si una puerta no cierra, el mensaje es
`Hay puertas que no llevan a ninguna parte: …` con el nombre de la puerta y lo que falta.

## Los mundos que hay hoy

| Mundo           | Archivo               | Zonas                                                                                   |
| --------------- | --------------------- | --------------------------------------------------------------------------------------- |
| `first-office`  | `oficina-taller.json` | Recepción, Cocina y descanso, Escritorios, Sala de reunión (+ Sur, Este) y Sala de foco |
| `chiron-office` | `chiron-office.json`  | Vestíbulo, Los Monitores, Archivo, Galería, El Pozo, Sala de mando y Café nocturno      |

Están conectados por **un par de puertas**, una en cada punta:

| Desde           | Puerta (tile) | Lleva a         | Punto de llegada (tile)       |
| --------------- | ------------- | --------------- | ----------------------------- |
| `first-office`  | (25, 3)       | `chiron-office` | `desde-first-office` — (5, 4) |
| `chiron-office` | (5, 2)        | `first-office`  | `desde-chiron` — (25, 4)      |

Las dos están en la **recepción / vestíbulo** de su mundo, contra el muro norte, y las dos tienen
encima un **vano** (dos tiles del tileset `ChironDark`, dibujados como mueble decorativo sobre la
pared) para que se vea que ahí se sale a otro lado: en la First Office es un hueco oscuro recortado
en la pared clara; en Chiron, el mismo hueco visto desde adentro.

### La Chiron Office

Es el segundo mundo: oscuro, frío y de planta abierta. El plano no se parece al de la First Office
a propósito — allá hay salas cerradas colgadas de un pasillo vertical en un lienzo cuadrado de
40×40; acá el lienzo es apaisado (34×24) y todo da a una **galería** este-oeste, con alcobas
separadas por tabiques cortos y columnas, sin puertas interiores.

Lo oscuro **está en los tiles**, no en un velo: la Chiron Office se pinta con su propio tileset,
`ChironDark.png`, que se genera con `python3 tools/make-chiron-tileset.py`. Ese script toma de
`FloorAndGround` los mismos tiles con los que está armada la First Office (así las paredes encastran
igual) y los pasa por un duotono frío, y dibuja además unos tiles de luz: charcos cenitales, una
tira LED al pie del muro norte y el vano de la puerta. El mapa tiene una capa `Luces` entre el piso
y las paredes con esos tiles; no bloquean el paso.

Para rehacer el mundo entero desde cero:

```bash
python3 tools/make-chiron-tileset.py   # el tileset oscuro
python3 tools/make-chiron-map.py       # el mapa, que lo usa
```

El vocabulario de tiles (qué tile es qué, de dónde sale y con qué paleta) está en
`tools/chiron_tiles.py`, compartido por los dos scripts. Después el mapa se edita en Tiled como
cualquier otro; volver a correr los scripts pisa esas ediciones.

## Agregar un mundo

1. **Hacé el mapa.** Un Tiled JSON nuevo en `apps/client/public/assets/map/`, con sus tilesets
   embebidos, su spawn de entrada y las zonas que quieras. (Si querés un mundo con otro clima,
   mirá cómo se hace el tileset propio de la Chiron Office, más arriba.)
2. **Registrá el mundo** en `packages/shared/src/worlds.ts`: un id estable (`chiron-office`), el
   nombre visible (`Chiron Office`) y el archivo del mapa. Cliente y servidor leen ese registro: el
   servidor levanta una sala por mundo y el cliente carga el mapa cuando alguien cruza su puerta.
3. **Conectalo en las dos puntas.** En el mapa nuevo, un punto de llegada con nombre (por ejemplo
   `desde-first-office`) y una puerta de vuelta; en el mapa del mundo del que se llega, la puerta de
   ida y su propio punto de llegada.
4. **Probalo.** `npm test -w apps/server` valida los dos mapas y las puertas entre ellos; si algo no
   cierra, el servidor no arranca y dice qué falta.

## Origen

El plano parte del mapa de [SkyOffice](https://github.com/kevinshen56714/SkyOffice) (MIT), retocado
para la oficina de Taller: recepción con spawn, cocina y descanso con mostrador, bacha, heladera y
expendedora, sala de reunión con mesa y pizarra, y sala de escritorios con puestos adicionales.
El ala sur (filas 25-39) se agregó después colgando del pasillo vertical: `Sala de reunión Sur`,
`Sala de reunión Este` y `Sala de foco`, cada una con su puerta al pasillo.

El plano de la Chiron Office es propio (ver `tools/make-chiron-map.py`); sus muebles salen de los
mismos packs y algunas piezas ya armadas —la mesa de reunión, el escritorio con PC— se copian de la
First Office por rectángulo, para no volver a resolver cómo encastran.

Los gráficos son de LimeZu; ver `docs/licencias-assets.md`.
