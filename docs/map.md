# The worlds' maps

Every **world** of the office (the First Office, the Chiron Office...) is a place with its own map,
its own people and its own chat, and you get from one to another by **walking through a door**. A
map is **data, not code**: a [Tiled](https://www.mapeditor.org/) file in
`apps/client/public/assets/map/`. Anyone on the team can open it in Tiled, move desks around, add a
room, change where people appear or put a door to another world, save, and the app picks it up
without a line of code being touched. This document says what the app expects of those files.

Which worlds exist and which file each one uses is declared in
[`packages/shared/src/worlds.ts`](../packages/shared/src/worlds.ts) (see
["Adding a world"](#adding-a-world)).

## Opening and editing

1. Install Tiled (free, <https://www.mapeditor.org/>). Tested with Tiled 1.11.
2. `File → Open…` and pick the map of the world you want to edit, for example
   `apps/client/public/assets/map/first-office.json` (the First Office). Tiled opens JSON maps
   directly; always save to the same file and in JSON format (not `.tmx`).
3. The tilesets' images are in `apps/client/public/assets/tilesets/`. The map references them with
   relative paths (`../tilesets/X.png`), so do not move or rename that folder.
4. Save and reload the browser. In development, the server reads the maps at startup: if you
   changed a spawn point or a door, restart `npm run dev` so it picks them up.

To see the collisions inside the app, open the client with `?debug` in the URL
(`http://localhost:5173/?debug`): the blocking tiles are painted yellow, the solid furniture blue,
the spawn points green (with their radius) and the **doors** purple, with the world and the spawn
they lead to.

## What the app expects

The app **does not depend on the layer names**. It walks every layer in the order they have in Tiled
(from bottom to top) and decides by the layer's type and by the custom properties. The names in
place today (`Floor`, `Walls`, `Furniture`, `FurnitureCollision`, `Zones`, `Doors`, `Spawn`) are a
convention so the file reads well, not a requirement.

### Tile layers (floor and walls)

- They are drawn in Tiled's order. You can have as many as you like.
- A tile **blocks the way** if in the tileset it has the property `collides` (bool) set to `true`.
  The property goes on the tileset (select the tile → Custom Properties), not on the map: that way
  every wall you paint collides on its own. In `FloorAndGround` every wall tile is already marked.
- Convention: `Floor` for what is walkable and `Walls` for what blocks. Keeping them apart makes the
  file easy to read and to review in a PR.

### Object layers (furniture)

The furniture are **tile objects** (Tiled's "Insert Tile" tool) in object layers:

- Each object is drawn as a sprite at its position. Its depth is its bottom edge, so avatars pass in
  front of a desk when they are further down and behind it when they are further up.
- An object **blocks the way** if its `collides` property is `true`. If the object does not have it,
  it inherits the `collides` property of **its layer**. If neither has it, it does not block.
- Convention: layer `FurnitureCollision` with `collides = true` for what is solid (desks, tables,
  counters, large plants) and layer `Furniture` with `collides = false` for what is decorative
  (pictures, rugs, chairs: chairs do not block so that "sitting down" is possible later on).
- For a one-off exception, put `collides` on the object: it wins over the layer.
- Objects can be flipped (horizontally/vertically) and scaled; that is respected.
- The chairs keep the `direction` property (`up/down/left/right`) inherited from SkyOffice, and
  chairs, computers and whiteboards have the classes `chair`, `computer`, `whiteboard`. The app does
  not use them today; they are there for the interaction work.

### Spawn points (required)

Objects with class `spawn` (the object's _Class_ field; in the JSON it is `type`). They can be a
point or a rectangle (the centre is used).

- **The world's entrance**: exactly **one** spawn without a name (the one that already existed is
  called `spawn` and also counts as unnamed). It is where whoever enters that world from the app
  appears.
- **Arrival points**: the other spawns carry a **name** (the object's _Name_ field). They are the
  destination of doors in other worlds, and the name is what those doors mention. Names are not
  repeated within a map.
- Optional property `radius` (int, px): players appear scattered at random within that radius so
  they do not pile up. If missing, 32 px. For an arrival point a small radius (8 px) works best,
  placed **outside** the area of the return door, so you do not go straight back the way you came.
- Optional property `dir` (string: `up`, `down`, `left`, `right`): which way whoever appears there
  faces. On an arrival point it is used to end up **with your back to the door** you came through.
  If missing, `down`.
- The server reads them at startup and it is the one that assigns each player their initial
  position. If the entrance is missing, there is more than one, a name is repeated or one falls on a
  colliding tile, **the server does not start** and says why.

### Doors to other worlds

A rectangle with class `door` is a door: it is **crossed by walking**, with no key press and no
confirmation. As soon as the feet enter the area, the player leaves this world and appears in the
other one.

- Property `world` (string, required): id of the destination world, exactly as it appears in
  `packages/shared/src/worlds.ts` (for example `chiron-office`).
- Property `spawn` (string, required): name of the arrival point **in that world**.
- The object's _Name_ is for people (it shows up in error messages and in `?debug`); over the door
  the app shows the visible name of the world it leads to.
- Put the door on walkable floor, right up against the wall that acts as the threshold: if it falls
  on a colliding tile it cannot be stepped on.
- **Both ends**: for it to be possible to go and come back, the other map needs its own return door
  and its arrival point. A world without a way out is a world you cannot leave.
- At startup, the server validates **every** door of **every** world: if one leads to a world or a
  spawn that does not exist, it does not start and names the door and the missing destination.

### Ambient (optional)

A property of the **map** (not of a layer), `ambient`, of type colour (`#AARRGGBB`): the client
paints that colour over the whole world. It is what makes the Chiron Office feel dark without
needing to draw new tiles. The opacity is the `AA` part: with `#66070a18` it looks dark but
everything is still legible; raising it too far dims the avatars as well.

### Zones (recommended)

- Rectangles with class `zone` and a name (`Reception`, `Desks`, `Meeting Room`,
  `Kitchen & Lounge`, `South Meeting Room`, `East Meeting Room`, `Focus Room`...). The app shows the
  name as a label in the top-left corner of each zone.
- The server's tests require at least those four zones, plus the three rooms in the south wing, and
  that **every** zone can be reached on foot from the spawn: a room without a walkable door makes
  the tests fail.

### Tilesets

- They have to be **embedded** in the map (when adding a tileset tick "Embed in map"; if one already
  exists, use the "Embed tileset" button in the Tilesets panel). The app does not load external
  `.tsx` files.
- To add a new tileset: copy the PNG to `apps/client/public/assets/tilesets/`, add it in Tiled with
  its tile size, and that is it: the client loads it on its own by reading the map. Document the
  licence in `docs/asset-licenses.md` (see there which licences are acceptable).
- The map's tile size: 32x32. Furniture tilesets can have a different size (chairs are 32x64, desks
  with a computer 96x64).

## Summary of the contract

| What                  | Where                          | How                                                      |
| --------------------- | ------------------------------ | -------------------------------------------------------- |
| Collision of a tile   | Tileset → tile → property      | `collides: true` (bool)                                   |
| Collision of a prop   | Object or its layer → property | `collides: true`; the object wins over the layer          |
| World entrance        | Object (point or rectangle)    | class `spawn` **without a name**; optional `radius`; one  |
| Arrival point         | Object (point or rectangle)    | class `spawn` + unique name; optional `radius` and `dir`  |
| Door to another world | Rectangle object               | class `door` + `world` (id) and `spawn` (name) of target  |
| Named zone            | Rectangle object               | class `zone` + name                                       |
| World ambient         | Map → property                 | `ambient` (colour `#AARRGGBB`)                            |
| Tilesets              | Map                            | embedded, images relative to the map file                 |
| Format                | File                           | Tiled JSON, orthogonal, fixed size (not infinite)         |

The constants for these names live in `packages/shared/src/map.ts`, used by client and server alike.

## Checking a map

```bash
npm test -w apps/server      # real maps of every world: spawns, doors, zones, tilesets
```

If a map does not meet the contract, `npm run dev` fails while starting the server with the detail
(`The map "…" is not valid: …`), and the client shows a message if it cannot load the file or a
tileset image. If a door does not match up, the message is
`There are doors that lead nowhere: …` with the name of the door and what is missing.

## Adding a world

1. **Make the map.** A new Tiled JSON in `apps/client/public/assets/map/`, with its tilesets
   embedded, its entrance spawn and whatever zones you want. (The Chiron Office is generated with
   `python3 tools/make-chiron-map.py` and then edited in Tiled like any other.)
2. **Register the world** in `packages/shared/src/worlds.ts`: a stable id (`chiron-office`), the
   visible name (`Chiron Office`) and the map's file. Client and server read that registry: the
   server brings up one room per world and the client loads the map when someone crosses its door.
3. **Connect both ends.** In the new map, a named arrival point (for example `from-first-office`)
   and a return door; in the map of the world you arrive from, the outbound door and its own
   arrival point.
4. **Try it.** `npm test -w apps/server` validates both maps and the doors between them; if
   something does not match up, the server does not start and says what is missing.

## Origin

The floor plan starts from the [SkyOffice](https://github.com/kevinshen56714/SkyOffice) map (MIT),
reworked for Taller's office: a reception with the spawn, a kitchen and lounge with a counter, sink,
fridge and vending machine, a meeting room with a table and a whiteboard, and a desk room with extra
workstations. The south wing (rows 25-39) was added later, hanging off the vertical corridor:
`South Meeting Room`, `East Meeting Room` and `Focus Room`, each with its door to the corridor.
The graphics are by LimeZu; see `docs/asset-licenses.md`.
