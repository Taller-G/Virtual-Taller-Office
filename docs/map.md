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
the spawn points green (with their radius), the **doors** purple, with the world and the spawn they
lead to, and the **seats** teal, with their name and facing.

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
  (pictures, rugs, chairs: chairs do not block, which is what lets you stand on one to sit down --
  see ["Seats"](#seats-focus-desks)).
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

### Seats (focus desks)

A rectangle with class `seat` is a place to **sit down**, and sitting down is what puts someone in
the **Focused** state: their avatar is drawn seated, the people list shows them as "Focused", and
nobody can open a conversation bubble with them until they stand up again. A seat is therefore a
place in the world, not a feature of the app: adding one is adding an object to the map.

- The rectangle is the tile whoever wants to sit has to stand on — in practice, the chair's own
  tile. Whoever sits is pinned to its centre.
- Property `dir` (string: `up`, `down`, `left`, `right`, optional, `down` by default): which way the
  person faces once seated, which should be **towards the desk**. The Chiron Office draws its chairs
  above their desks, so its seats all face `down`.
- The object's **Name** is required and has to be unique in the map: it is what identifies the seat
  everywhere (it travels in the messages and in `player.seatId`), and it is what a name in a log or
  an error message refers to. `Focus desk 3` reads better than an id.
- Put it on walkable floor, with nothing solid on it: a seat under a wall or under a colliding piece
  of furniture is a seat nobody can reach. The tests check this for every seat.
- Chairs themselves stay **decorative** (`collides: false`), which is what makes it possible to
  stand on them in the first place.
- Sitting is decided by the **server**: a seat somebody else is in cannot be taken, and the seat is
  freed when the person stands up, walks away, marks themselves away, loses the connection or
  leaves the world. Nothing in the map says any of that.

In `?debug` the seats are drawn in teal with their name and facing, over the same view that shows
the collision bodies: a seat with a collision body on it is visible at a glance.

### Ambient (optional)

A property of the **map** (not of a layer), `ambient`, of type colour (`#AARRGGBB`): the client
paints that colour over the whole world. The opacity is the `AA` part. In the Chiron Office it is
deliberately low (`#4d080d1a`): what is dark there are the tiles, not the veil, and the veil only
has to tone down the furniture, which comes from bright packs. Raising it too far dims the avatars
as well.

### Zones (recommended)

- Rectangles with class `zone` and a name (`Reception`, `Desks`, `Kitchen & Lounge`, `Focus Room`,
  `West Meeting Room`...). The app shows the name as a label in the top-left corner of each zone.
- A room's zone covers the **whole room**, wall to wall. That is what makes the label land inside it
  and what a meeting means when it says which room it is in: the seats of a meeting room are the
  `seat` objects inside its zone.
- The server's tests require the First Office's four minimum zones (a reception, the desks, a
  kitchen and the meeting rooms), that every zone is named, that none of the names is repeated, and
  that **every** zone can be reached on foot from the spawn: a room without a walkable door makes
  the tests fail. For the Chiron Office they require the same plus that the `Arrival Hall` and the
  `Focus Desks` exist.
- The label is white on a `#1b1f2acc` plate, so it reads the same over a bright floor as over a dark
  one; nothing needs changing to make a dark world.

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
| Collision of a tile   | Tileset → tile → property      | `collides: true` (bool)                                  |
| Collision of a prop   | Object or its layer → property | `collides: true`; the object wins over the layer         |
| World entrance        | Object (point or rectangle)    | class `spawn` **without a name**; optional `radius`; one |
| Arrival point         | Object (point or rectangle)    | class `spawn` + unique name; optional `radius` and `dir` |
| Door to another world | Rectangle object               | class `door` + `world` (id) and `spawn` (name) of target |
| Named zone            | Rectangle object               | class `zone` + name                                      |
| Seat (focus desk)     | Rectangle object               | class `seat` + unique name; optional `dir`               |
| World ambient         | Map → property                 | `ambient` (colour `#AARRGGBB`)                           |
| Tilesets              | Map                            | embedded, images relative to the map file                |
| Format                | File                           | Tiled JSON, orthogonal, fixed size (not infinite)        |

The constants for these names live in `packages/shared/src/map.ts`, used by client and server alike.

## Checking a map

```bash
npm test -w apps/server      # real maps of every world: spawns, doors, zones, tilesets
```

To **look** at a map instead of reading its tile ids — which is the only way to answer "is this
piece of furniture whole, and is it where I meant it" — there is an offline renderer that draws a
world exactly as the client does:

```bash
python3 tools/render-map.py first-office --grid -o /tmp/first.png
python3 tools/render-map.py first-office --debug -o /tmp/first-debug.png
```

`--grid` writes the tile coordinates over it and `--debug` paints what `?debug` paints in the app:
colliding tiles yellow, solid furniture blue, zones, seats, doors and spawns outlined.

If a map does not meet the contract, `npm run dev` fails while starting the server with the detail
(`The map "…" is not valid: …`), and the client shows a message if it cannot load the file or a
tileset image. If a door does not match up, the message is
`There are doors that lead nowhere: …` with the name of the door and what is missing.

## The worlds there are today

| World           | File                 | Zones                                                                                |
| --------------- | -------------------- | ------------------------------------------------------------------------------------ |
| `first-office`  | `first-office.json`  | Reception, Kitchen & Lounge, Focus Room, Desks, Meeting Wing and three Meeting Rooms |
| `chiron-office` | `chiron-office.json` | Arrival Hall, Focus Desks, Archive, Gallery, The Pit, War Room and Night Café        |

They are connected by **a pair of doors**, one at each end:

| From            | Door (tile) | Leads to        | Arrival point (tile)       |
| --------------- | ----------- | --------------- | -------------------------- |
| `first-office`  | (16, 2)     | `chiron-office` | `from-first-office` (2, 4) |
| `chiron-office` | (2, 2)      | `first-office`  | `from-chiron` (16, 4)      |

Both sit in their world's reception / arrival hall, against the north wall, and both have an **opening**
above them (two tiles of the `ChironDark` tileset, drawn as decorative furniture on the wall) so it
is clear you leave through there: in the First Office it is a dark hole cut into the bright wall;
in Chiron it is the same hole seen from the inside.

### The First Office

The world everybody lands in, and the first thing anyone sees of the product. Its plan is a front of
house, a work floor and a meeting wing, one after the other from north to south on a 40×40 canvas:

```
      +--------------------------------------------------+
      | Kitchen & Lounge |   RECEPTION    |  Focus Room   |  rows 2-10
      |                  |  (door, spawn) |               |
      +------- opening --+--- the aisle --+-- opening ----+  rows 11-12
      |   OPEN DESK AREA -- two banks either side of a    |  rows 13-23
      |   four-tile aisle that runs the length of it      |
      +---------------------- opening --------------------+  rows 24-25
      |            meeting-wing corridor                  |  rows 26-27
      +---- door ------------- door -------- door --------+  rows 28-29
      | West Meeting  |  Centre Meeting  |  East Meeting  |  rows 30-37
      +--------------------------------------------------+
```

The **aisle** (cols 18-21) is the spine: it starts at the lobby, crosses the desk area without
touching a desk and ends at the corridor the meeting rooms open onto, so the walk from the door to a
meeting never squeezes past anybody's chair.

The rooms, their zones and what you can sit on in each:

| Room                  | Zone (tiles)  | Seats                              |
| --------------------- | ------------- | ---------------------------------- |
| `Reception`           | 14-26 × 2-10  | — (the spawn, the door, the logo)  |
| `Kitchen & Lounge`    | 1-12 × 2-10   | —                                  |
| `Focus Room`          | 28-38 × 2-10  | 4 · `Focus desk 1…4`               |
| `Desks`               | 1-38 × 13-23  | 12 · `Desk 1…12`                   |
| `Meeting Wing`        | 1-38 × 26-27  | — (the corridor)                   |
| `West Meeting Room`   | 1-11 × 30-37  | 10 · `West Meeting Room seat 1…10` |
| `Centre Meeting Room` | 14-25 × 30-37 | 10 · `Centre Meeting Room seat …`  |
| `East Meeting Room`   | 28-38 × 30-37 | 10 · `East Meeting Room seat …`    |

Every **meeting room** is the same room: one table eight tiles long, four chairs along each side and
one at each end — **ten seats**, every one facing the table, numbered round it (north side, then
south, then the two ends). That is the seam the scheduled meetings rely on: a meeting is assigned to
a room **by the name of its zone**, and its seats are the ten `seat` objects inside that zone.

The walls between the meeting rooms are **two tiles thick** on purpose. A conversation bubble is two
tiles across and knows nothing about walls, so a one-tile wall would put two people either side of
it in the same conversation. Three tiles apart, they are not.

To rebuild the world from scratch:

```bash
python3 tools/make-first-office-map.py
```

The plan is stated at the top of that script in rooms, bands and corridors; the furniture comes from
`tools/office_pieces.py`, the palette it shares with the Chiron Office. The script refuses to write
a map in which two pieces of furniture land on the same tile, and checks every piece against the
tileset image first (see `tools/tileset_pieces.py`). After that the map is edited in Tiled like any
other; re-running the script overwrites those edits.

### The Chiron Office

The second world: dark, cold and open-plan, and the one you go to in order to work. The floor plan
deliberately looks nothing like the First Office's — over there rooms are stacked in bands across a
square 40×40 canvas around one straight aisle; here the canvas is landscape (34×24) and everything
gives onto an east-west **gallery**, with alcoves separated by short stub walls and pillars, and no
interior doors.

You arrive in the **Arrival Hall**, the north-west alcove: the world's name is spelled out in light
on the wall beside the doorway you came through (the Chiron mark), so which of the two offices you
are standing in is never in doubt, and both the mark and the way back are on screen without moving.
Chevrons on the floor point back at the door and east along the clear lane that leads to the desks.

Next to it, the **Focus Desks**: six workstations in two banks of three, each with its own chair,
each chair a `seat`. Sitting at one is what makes a person "Focused" (see ["Seats"](#seats-focus-desks)).
The banks are laid out with a clear gap between every pair of desks, so the way through from the
gallery to the north wall never runs past somebody's chair — nobody sitting down blocks a corridor.

The darkness **is in the tiles**, not in a veil: the Chiron Office is painted with its own tileset,
`ChironDark.png`, generated by `python3 tools/make-chiron-tileset.py`. That script takes from
`FloorAndGround` the very tiles the First Office is built from (so the walls fit together the same
way) and runs them through a cold duotone, and it also draws a few light tiles: overhead pools, an
LED strip at the foot of the north wall and the doorway. The map has a `Lights` layer between the
floor and the walls holding those tiles; they do not block the way.

To rebuild the whole world from scratch:

```bash
python3 tools/make-chiron-tileset.py   # the dark tileset
python3 tools/make-chiron-map.py       # the map, which uses it
```

The tile vocabulary (which tile is which, where it comes from and with which palette) lives in
`tools/chiron_tiles.py`, shared by both scripts. After that the map is edited in Tiled like any
other; re-running the scripts overwrites those edits.

## Adding a world

1. **Make the map.** A new Tiled JSON in `apps/client/public/assets/map/`, with its tilesets
   embedded, its entrance spawn and whatever zones you want. (If you want a world with a different
   mood, look at how the Chiron Office's own tileset is made, above.)
2. **Register the world** in `packages/shared/src/worlds.ts`: a stable id (`chiron-office`), the
   visible name (`Chiron Office`) and the map's file. Client and server read that registry: the
   server brings up one room per world and the client loads the map when someone crosses its door.
3. **Connect both ends.** In the new map, a named arrival point (for example `from-first-office`)
   and a return door; in the map of the world you arrive from, the outbound door and its own
   arrival point.
4. **Try it.** `npm test -w apps/server` validates both maps and the doors between them; if
   something does not match up, the server does not start and says what is missing.

## Origin

The First Office started from the [SkyOffice](https://github.com/kevinshen56714/SkyOffice) map
(MIT), reworked for Taller's office and then grown by accretion — rows appended to the south for two
more meeting rooms and a focus room, furniture cloned in piece by piece. It has since been
**redesigned** (see `tools/make-first-office-map.py`) around what it is for now: an arrival, a work
floor, and a wing of interchangeable meeting rooms one straight walk from the door. The furniture is
the same LimeZu packs it always used.

The Chiron Office's floor plan is our own (see `tools/make-chiron-map.py`). Both worlds are
furnished from one palette, `tools/office_pieces.py`: the pieces cut from the sheets (checked against
the images themselves) and the two assemblies that were solved once in Tiled and are reused whole —
the meeting table and the workstation.

The graphics are by LimeZu; see `docs/asset-licenses.md`.
