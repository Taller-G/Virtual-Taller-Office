#!/usr/bin/env python3
"""
Builds the map of the "Chiron Office" world: a dark, landscape, open-plan
office connected to the First Office by a door.

Usage:  python3 tools/make-chiron-tileset.py   # the tileset first
        python3 tools/make-chiron-map.py       # then the map

Development only: the result is committed to
`apps/client/public/assets/map/chiron-office.json` and edited in Tiled from
there like any other map (see `docs/map.md`). This script exists so the world
can be rebuilt from scratch reproducibly.

The plan deliberately looks nothing like the First Office's. Over there closed
rooms hang off a vertical corridor on a square canvas; here the canvas is
landscape and an east-west **gallery** crosses the whole world, with open
alcoves giving onto it, separated by short stub walls and pillars. There are no
interior doors: from the gallery you see the whole world.

Floors and walls come from `ChironDark.png` (see
`tools/make-chiron-tileset.py`): they are dark in the tile, not under a veil.
The furniture does come from the same packs as the First Office — the same
assets — but arranged in a new plan; individual assemblies are copied from over
there by rectangle, so we do not have to work out again how a desk fits
together.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from chiron_tiles import (  # noqa: E402
    INDEX,
    SHEET_COLUMNS,
    SHEET_ROWS,
    TILE,
    TILES,
    TILESET_IMAGE,
    TILESET_NAME,
    collides_tiles,
)

ROOT = Path(__file__).resolve().parent.parent
MAPS = ROOT / 'apps/client/public/assets/map'
SOURCE = MAPS / 'first-office.json'
TARGET = MAPS / 'chiron-office.json'

WIDTH, HEIGHT = 34, 24

# --- The plan --------------------------------------------------------------
# The north wall takes rows 0 (cap) and 1 (body), and row 2 is the shadow band
# at its foot, which is already walkable. The last walkable row is 21 and the
# south wall is row 22.
FIRST_ROW = 2
FIRST_COL, LAST_COL = 1, WIDTH - 2
BOTTOM_WALL = HEIGHT - 2

#: The gallery: the world's east-west axis, always clear.
HALL_ROWS = range(11, 15)

#: Partitions between alcoves. Short on purpose: they let you cut across
#: behind them, and they make the place read as a warehouse rather than as a
#: row of offices.
STUBS_NORTH = [(11, range(2, 9)), (22, range(2, 9))]
STUBS_SOUTH = [(12, range(17, 22)), (21, range(17, 22))]
#: Free-standing columns framing the gallery.
PILLARS = [(6, 11), (6, 14), (17, 11), (17, 14), (28, 11), (28, 14)]

#: Zones: name and rectangle in tiles (col0, row0, col1, row1), inclusive.
ZONES = [
    ('Lobby', 1, 2, 10, 10),
    ('Monitors', 12, 2, 21, 10),
    ('Archive', 23, 2, 32, 10),
    ('Gallery', 1, 11, 32, 14),
    ('The Pit', 1, 15, 11, 21),
    ('War Room', 13, 15, 20, 21),
    ('Night Café', 22, 15, 32, 21),
]

# The door goes in the north wall, the only one seen face-on: the other three
# are a thin line (seen edge-on) and an opening cut into them would not read.
#: Door back to the First Office, against the Lobby's north wall.
DOOR_TILE = (5, 2)
#: Where you land coming from the First Office: two tiles in, back to the door.
ARRIVAL_TILE = (5, 4)
#: World entrance, for whoever opens the app straight into Chiron.
ENTRY_TILE = (5, 7)

#: Ambient colour (#AARRGGBB). Low on purpose: floors and walls are already
#: dark, so the veil only has to tone down the furniture, which comes from
#: bright packs. Raising it dims the avatars too.
AMBIENT = '#4d080d1a'


# ---------------------------------------------------------------------------
# Tile layers
# ---------------------------------------------------------------------------


class TileGrid:
    """A tile layer written by tile name rather than by raw gid."""

    def __init__(self, firstgid: int) -> None:
        self.data = [0] * (WIDTH * HEIGHT)
        self.firstgid = firstgid

    def put(self, col: int, row: int, name: str) -> None:
        if not (0 <= col < WIDTH and 0 <= row < HEIGHT):
            raise IndexError(f'({col},{row}) falls outside the map')
        self.data[row * WIDTH + col] = self.firstgid + INDEX[name]

    def fill(self, cols: range, rows: range, name: str) -> None:
        for row in rows:
            for col in cols:
                self.put(col, row, name)

    def motif(self, cols: range, rows: range, names: list[list[str]]) -> None:
        """Repeats a motif (the 3×2 rug, say) over a rectangle."""
        for j, row in enumerate(rows):
            for i, col in enumerate(cols):
                self.put(col, row, names[j % len(names)][i % len(names[0])])


def build_walls(firstgid: int) -> list[int]:
    walls = TileGrid(firstgid)
    inner = range(FIRST_COL, LAST_COL + 1)

    # North wall: cap and body.
    walls.put(0, 0, 'wall_tl')
    walls.put(WIDTH - 1, 0, 'wall_tr')
    walls.fill(inner, range(0, 1), 'wall_top')
    walls.put(0, 1, 'wall_left')
    walls.put(WIDTH - 1, 1, 'wall_right')
    walls.fill(inner, range(1, 2), 'wall_body')

    # East and west walls.
    for row in range(FIRST_ROW, BOTTOM_WALL):
        walls.put(0, row, 'wall_left')
        walls.put(WIDTH - 1, row, 'wall_right')

    # South wall.
    walls.put(0, BOTTOM_WALL, 'wall_bl')
    walls.put(WIDTH - 1, BOTTOM_WALL, 'wall_br')
    walls.fill(inner, range(BOTTOM_WALL, BOTTOM_WALL + 1), 'wall_bottom')

    # Partitions and columns.
    for col, rows in STUBS_NORTH + STUBS_SOUTH:
        for row in rows:
            walls.put(col, row, 'stub_v')
    for col, row in PILLARS:
        walls.put(col, row, 'stub_v')
    return walls.data


def build_floor(firstgid: int) -> list[int]:
    floor = TileGrid(firstgid)
    inner = range(FIRST_COL, LAST_COL + 1)

    # Shadow band at the foot of the north wall, then the general floor.
    floor.put(FIRST_COL, FIRST_ROW, 'shadow_l')
    floor.fill(range(FIRST_COL + 1, LAST_COL + 1), range(FIRST_ROW, FIRST_ROW + 1), 'shadow')
    for row in range(FIRST_ROW + 1, BOTTOM_WALL):
        floor.put(FIRST_COL, row, 'floor_l')
        floor.fill(range(FIRST_COL + 1, LAST_COL + 1), range(row, row + 1), 'floor')

    # The gallery, a shade apart: the axis reads without needing a wall.
    floor.fill(inner, HALL_ROWS, 'hall')

    # Technical grating in the Archive and the Monitors.
    grate = [['grate_a', 'grate_b'], ['grate_c', 'grate_d']]
    floor.motif(range(23, 33), range(3, 10), grate)
    floor.motif(range(12, 22), range(8, 11), grate)

    # The rug in The Pit.
    rug = [['rug_a', 'rug_b', 'rug_c'], ['rug_d', 'rug_e', 'rug_f']]
    floor.motif(range(2, 8), range(17, 21), rug)
    return floor.data


def build_lights(firstgid: int) -> list[int]:
    """
    The lights layer: above the floor and below everything else. It is the only
    brightness in this world, so it is also what shows where to walk.
    """
    lights = TileGrid(firstgid)

    # LED strip at the foot of the north wall, end to end.
    lights.fill(range(FIRST_COL, LAST_COL + 1), range(FIRST_ROW, FIRST_ROW + 1), 'led')
    lights.fill(range(FIRST_COL, LAST_COL + 1), range(FIRST_ROW + 1, FIRST_ROW + 2), 'led_glow')

    # Overhead pools of light (2×2) over what matters in each alcove.
    def pool(col: int, row: int) -> None:
        lights.put(col, row, 'pool_tl')
        lights.put(col + 1, row, 'pool_tr')
        lights.put(col, row + 1, 'pool_bl')
        lights.put(col + 1, row + 1, 'pool_br')

    for col, row in [(4, 3), (13, 4), (16, 4), (19, 4), (5, 18), (15, 17), (26, 17)]:
        pool(col, row)

    # Single lamps: warm over the gallery, cold over the Archive.
    for col in (4, 10, 16, 22, 28):
        lights.put(col, 12, 'spot')
    for col, row in [(25, 6), (29, 6), (24, 9), (30, 9)]:
        lights.put(col, row, 'spot_cold')

    # Threshold of the door back: the light coming in from the other world.
    lights.put(DOOR_TILE[0], DOOR_TILE[1], 'threshold')
    return lights.data


# ---------------------------------------------------------------------------
# Furniture
# ---------------------------------------------------------------------------


def piece(source: dict, col0: int, row0: int, cols: int, rows: int) -> list[dict]:
    """
    Copies a piece of furniture out of the First Office: every tile object
    whose anchor falls inside the rectangle (in tiles), with positions relative
    to (col0, row0). That way a desk or a counter that already works is reused
    instead of re-stacking by hand the layers of sprites that make it up.

    `FloorAndGround` objects are skipped: they are that map's wall decoration
    (the white skirting strip) and mean nothing here.
    """
    x0, y0 = col0 * TILE, row0 * TILE
    x1, y1 = (col0 + cols) * TILE, (row0 + rows) * TILE
    out: list[dict] = []
    for layer in source['layers']:
        if layer['type'] != 'objectgroup' or layer['name'] not in ('Furniture', 'FurnitureCollision'):
            continue
        for obj in layer['objects']:
            if not obj.get('gid'):
                continue
            if not (x0 <= obj['x'] < x1 and y0 < obj['y'] <= y1):
                continue
            if obj['gid'] & 0x1FFFFFFF < 2561:  # FloorAndGround
                continue
            moved = dict(obj)
            moved['x'] = obj['x'] - x0
            moved['y'] = obj['y'] - y0
            moved['_solid'] = layer['name'] == 'FurnitureCollision'
            out.append(moved)
    if not out:
        raise ValueError(f'the piece at ({col0},{row0}) {cols}×{rows} has no objects')
    return out


def place(objects: list[dict], col: int, row: int) -> list[dict]:
    """The piece, moved to (col, row) of the Chiron Office."""
    out = []
    for obj in objects:
        moved = dict(obj)
        moved['x'] = obj['x'] + col * TILE
        moved['y'] = obj['y'] + row * TILE
        out.append(moved)
    return out


def block(col: int, row: int, grid: list[list[int]], solid: bool = False) -> list[dict]:
    """
    A piece of furniture described as a grid of gids, with its top-left corner
    at (col, row). A 0 leaves the tile empty.
    """
    out = []
    for j, line in enumerate(grid):
        for i, gid in enumerate(line):
            if not gid:
                continue
            out.append(
                {
                    'gid': gid,
                    'x': (col + i) * TILE,
                    'y': (row + j + 1) * TILE,
                    'width': TILE,
                    'height': TILE,
                    '_solid': solid,
                }
            )
    return out


# Furniture from the packs the First Office already uses (absolute gids: the
# tilesets are the same and start at the same firstgid).
DARK_SCREEN = [[5180, 5181], [5196, 5197]]  # wall screen, switched off
LIT_SCREEN = [[5178, 5179], [5196, 5197]]  # wall screen, switched on
SOFA = [[4691, 4692, 4693], [4707, 4708, 4709]]
BENCH = [[4823, 4824, 4825], [4839, 4840, 4841]]
LOW_TABLE = [[4801, 4802], [4817, 4818]]
COLD_ARMCHAIR = [[5223], [5239]]
WARM_ARMCHAIR = [[5224], [5240]]
POOL_TABLE = [[5140, 5141, 5142, 5143], [5156, 5157, 5158, 5159], [5172, 5173, 5174, 5175]]
CABINET = [[4772, 4773, 4774], [4788, 4789, 4790], [4804, 4805, 4806]]
CABINET_2 = [[4776, 4777, 4778], [4792, 4793, 4794], [4808, 4809, 4810]]
COUNTER = [[4536, 4537], [4563, 4564]]  # base unit with sink and microwave
VENDING = [[5360, 5361], [5376, 5377]]
CAFE_TABLE = [[4919, 4920, 4921], [4935, 4936, 4937]]
RED_STOOL = [[5099], [5115]]
BLUE_STOOL = [[5100], [5116]]


def furniture(source: dict, firstgid: int) -> tuple[list[dict], list[dict]]:
    """All the furniture in the world; returns (decorative, solid)."""
    objects: list[dict] = []

    # Pieces reused from the First Office: the same assets, already assembled.
    long_table = piece(source, 8, 19, 9, 5)  # meeting table with its chairs
    desk = piece(source, 25, 14, 3, 5)  # desk with a PC and a chair

    # --- Lobby: the opening in the north wall, and the middle left clear,
    # because that is where people appear.
    objects += portal(DOOR_TILE[0], 0, firstgid)
    objects += block(8, 1, LIT_SCREEN)
    objects += block(2, 6, COLD_ARMCHAIR)
    objects += block(8, 6, WARM_ARMCHAIR)
    objects += block(4, 8, BENCH, solid=True)
    objects += plant(1, 3)
    objects += plant(9, 3)

    # --- Monitors: three workstations in a row under a wall of screens.
    for col in (12, 15, 18):
        objects += place(desk, col, 4)
        objects += block(col, 1, DARK_SCREEN)
    objects += plant(21, 7)

    # --- Archive: cabinets against the wall and two islands with an aisle.
    for col in (23, 26, 29):
        objects += shelf(col, 1, CABINET)
    for col in (24, 28):
        objects += block(col, 6, CABINET_2, solid=True)

    # --- The Pit: the lounge, on the rug, with the pool table to the east.
    objects += block(2, 16, SOFA, solid=True)
    objects += block(5, 18, LOW_TABLE, solid=True)
    objects += block(1, 19, COLD_ARMCHAIR)
    objects += block(8, 16, WARM_ARMCHAIR)
    objects += block(7, 18, POOL_TABLE, solid=True)

    # --- War Room: the long table, facing the gallery.
    objects += place(long_table, 12, 16)
    objects += plant(13, 20)
    objects += plant(20, 20)

    # --- Gallery: benches and plants between the columns, so the axis is not
    # an empty 32-tile corridor.
    for col in (9, 20, 31):
        objects += plant(col, 12)
    for col in (3, 13, 24):
        objects += block(col, 12, BENCH, solid=True)

    # --- Night Café: the counter to the east and a table with stools.
    objects += block(23, 16, COUNTER, solid=True)
    objects += block(25, 16, COUNTER, solid=True)
    objects += block(28, 16, VENDING, solid=True)
    objects += block(23, 19, RED_STOOL)
    objects += block(25, 19, BLUE_STOOL)
    objects += block(27, 19, CAFE_TABLE, solid=True)
    objects += block(26, 19, BLUE_STOOL)
    objects += block(30, 19, RED_STOOL)
    objects += plant(32, 16)

    decor = [o for o in objects if not o['_solid']]
    solid = [o for o in objects if o['_solid']]
    return decor, solid


def portal(col: int, row: int, firstgid: int) -> list[dict]:
    """
    The doorway between worlds, drawn as decorative furniture on top of the
    wall (which already blocks the way). It is not the door itself: that is the
    `door` rectangle, on the floor, right in front of the opening.
    """
    return block(col, row, [[firstgid + INDEX['portal_top']], [firstgid + INDEX['portal_bottom']]])


def plant(col: int, row: int) -> list[dict]:
    """
    A tall plant: drawn over two tiles and blocking only the bottom one, so you
    can walk behind it. Same piece the First Office uses.
    """
    return block(col, row, [[2782], [2798]]) + block(col, row + 2, [[2814]], solid=True)


def shelf(col: int, row: int, grid: list[list[int]]) -> list[dict]:
    """
    A tall cabinet: the body is drawn but does not block (avatars pass in front
    of it and behind it) and only its base cuts the way, as in the First
    Office. Blocking the whole thing would kill three rows of tiles.
    """
    body = block(col, row, grid[:-1])
    base = block(col, row + len(grid) - 1, [grid[-1]], solid=True)
    return body + base


# ---------------------------------------------------------------------------
# Assembling the file
# ---------------------------------------------------------------------------


def chiron_tileset(firstgid: int) -> dict:
    return {
        'name': TILESET_NAME,
        'firstgid': firstgid,
        'image': TILESET_IMAGE,
        'imagewidth': SHEET_COLUMNS * TILE,
        'imageheight': SHEET_ROWS * TILE,
        'tilewidth': TILE,
        'tileheight': TILE,
        'tilecount': SHEET_COLUMNS * SHEET_ROWS,
        'columns': SHEET_COLUMNS,
        'margin': 0,
        'spacing': 0,
        # Wall collision travels in the tileset, not in the map: that way any
        # wall painted in Tiled blocks on its own (see `docs/map.md`).
        'tiles': [
            {'id': i, 'properties': [{'name': 'collides', 'type': 'bool', 'value': True}]}
            for i in collides_tiles()
        ],
    }


def tile_layer(layer_id: int, name: str, data: list[int]) -> dict:
    return {
        'type': 'tilelayer',
        'id': layer_id,
        'name': name,
        'x': 0,
        'y': 0,
        'width': WIDTH,
        'height': HEIGHT,
        'opacity': 1,
        'visible': True,
        'data': data,
    }


def object_layer(layer_id: int, name: str, objects: list[dict], collides: bool | None) -> dict:
    layer = {
        'type': 'objectgroup',
        'id': layer_id,
        'name': name,
        'draworder': 'topdown',
        'opacity': 1,
        'visible': True,
        'x': 0,
        'y': 0,
        'objects': objects,
    }
    if collides is not None:
        layer['properties'] = [{'name': 'collides', 'type': 'bool', 'value': collides}]
    return layer


def build() -> dict:
    source = json.loads(SOURCE.read_text(encoding='utf-8'))

    tilesets = [dict(ts) for ts in source['tilesets']]
    last = max(tilesets, key=lambda ts: ts['firstgid'])
    firstgid = last['firstgid'] + last['tilecount']
    tilesets.append(chiron_tileset(firstgid))

    decor, solid = furniture(source, firstgid)
    next_id = 1

    def numbered(objects: list[dict]) -> list[dict]:
        nonlocal next_id
        out = []
        for obj in objects:
            clean = {k: v for k, v in obj.items() if k != '_solid'}
            clean['id'] = next_id
            clean.setdefault('rotation', 0)
            clean.setdefault('visible', True)
            clean.setdefault('name', '')
            next_id += 1
            out.append(clean)
        return out

    decor, solid = numbered(decor), numbered(solid)

    zones = numbered(
        [
            {
                'name': name,
                'type': 'zone',
                'x': c0 * TILE,
                'y': r0 * TILE,
                'width': (c1 - c0 + 1) * TILE,
                'height': (r1 - r0 + 1) * TILE,
            }
            for name, c0, r0, c1, r1 in ZONES
        ]
    )

    doors = numbered(
        [
            {
                'name': 'Door to the First Office',
                'type': 'door',
                'x': DOOR_TILE[0] * TILE,
                'y': DOOR_TILE[1] * TILE,
                'width': TILE,
                'height': TILE,
                'properties': [
                    {'name': 'world', 'type': 'string', 'value': 'first-office'},
                    {'name': 'spawn', 'type': 'string', 'value': 'from-chiron'},
                ],
            }
        ]
    )

    spawns = numbered(
        [
            {
                'name': 'spawn',
                'type': 'spawn',
                'point': True,
                'x': ENTRY_TILE[0] * TILE + TILE / 2,
                'y': ENTRY_TILE[1] * TILE + TILE / 2,
                'width': 0,
                'height': 0,
                'properties': [{'name': 'radius', 'type': 'int', 'value': 24}],
            },
            {
                'name': 'from-first-office',
                'type': 'spawn',
                'point': True,
                'x': ARRIVAL_TILE[0] * TILE + TILE / 2,
                'y': ARRIVAL_TILE[1] * TILE + TILE / 2,
                'width': 0,
                'height': 0,
                # You arrive looking into the room, with your back to the
                # opening (in the north wall, two tiles up).
                'properties': [
                    {'name': 'radius', 'type': 'int', 'value': 8},
                    {'name': 'dir', 'type': 'string', 'value': 'down'},
                ],
            },
        ]
    )

    return {
        'type': 'map',
        'version': '1.10',
        'tiledversion': '1.11.2',
        'orientation': 'orthogonal',
        'renderorder': 'right-down',
        'compressionlevel': -1,
        'infinite': False,
        'width': WIDTH,
        'height': HEIGHT,
        'tilewidth': TILE,
        'tileheight': TILE,
        'backgroundcolor': '#05070d',
        'nextlayerid': 9,
        'nextobjectid': next_id,
        'properties': [
            {'name': 'name', 'type': 'string', 'value': 'Chiron Office'},
            {'name': 'ambient', 'type': 'color', 'value': AMBIENT},
        ],
        'tilesets': tilesets,
        'layers': [
            tile_layer(1, 'Floor', build_floor(firstgid)),
            tile_layer(2, 'Lights', build_lights(firstgid)),
            tile_layer(3, 'Walls', build_walls(firstgid)),
            object_layer(4, 'Furniture', decor, collides=False),
            object_layer(5, 'FurnitureCollision', solid, collides=True),
            object_layer(6, 'Zones', zones, collides=None),
            object_layer(7, 'Doors', doors, collides=None),
            object_layer(8, 'Spawn', spawns, collides=None),
        ],
    }


def main() -> None:
    if TILES[0].name != 'wall_tl':
        raise SystemExit('the tile vocabulary changed: check tools/chiron_tiles.py')
    # A single line, the way Tiled saves it and the way the First Office is
    # stored: map diffs then read as what changed, not as reformatting.
    TARGET.write_text(
        json.dumps(build(), ensure_ascii=False, separators=(',', ':')), encoding='utf-8'
    )
    print(f'wrote {TARGET.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
