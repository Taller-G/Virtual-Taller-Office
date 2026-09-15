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
from dataclasses import dataclass
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
from tileset_pieces import (  # noqa: E402
    blank_lines,
    cut_sides,
    ink_fraction,
    sheet_rect,
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
#: row of offices. The one between the arrival hall and the desks stops at row
#: 6, so you can walk straight from where you land to a desk without going
#: round through the gallery.
STUBS_NORTH = [(10, range(2, 7)), (22, range(2, 9))]
STUBS_SOUTH = [(12, range(17, 22)), (21, range(17, 22))]
#: Free-standing columns framing the gallery.
PILLARS = [(6, 11), (6, 14), (17, 11), (17, 14), (28, 11), (28, 14)]

#: Zones: name and rectangle in tiles (col0, row0, col1, row1), inclusive.
ZONES = [
    ('Arrival Hall', 1, 2, 9, 10),
    ('Focus Desks', 11, 2, 21, 10),
    ('Archive', 23, 2, 32, 10),
    ('Gallery', 1, 11, 32, 14),
    ('The Pit', 1, 15, 11, 21),
    ('War Room', 13, 15, 20, 21),
    ('Night Café', 22, 15, 32, 21),
]

# The door goes in the north wall, the only one seen face-on: the other three
# are a thin line (seen edge-on) and an opening cut into them would not read.
#: Door back to the First Office, against the arrival hall's north wall.
DOOR_TILE = (2, 2)
#: Where you land coming from the First Office: two tiles in, back to the door.
ARRIVAL_TILE = (2, 4)
#: World entrance, for whoever opens the app straight into Chiron.
ENTRY_TILE = (5, 3)

#: The world's name in light on the north wall, left-hand column of the six
#: letter tiles. It sits beside the doorway, not over it, so from the arrival
#: point you see the mark and the way back in the same glance.
MARK_TILE = (4, 1)

#: The six focus desks: left-hand column of each three-tile desk unit, and the
#: rows their seats are on. Each unit draws its chair one tile above the seat
#: and its desk on the two tiles below, so a bank occupies rows seat-1..seat+2:
#: the north bank fills rows 2-5 and the south bank rows 7-10.
#:
#: That leaves **row 6 empty from col 11 to col 21** — the one thing this alcove
#: has to have. The desk area is nine rows deep and two banks of workstations
#: want eight of them, so there is exactly one row to spend, and spending it
#: between the banks rather than behind them is what decides whether crossing
#: the desks means walking through the seats. It used to be spent behind: the
#: only way east was along the row the south bank sits in, so three people at
#: their desks were three people in the corridor.
#:
#: The gaps between the units (cols 14 and 18) run unbroken from the north wall
#: to the gallery and cross that corridor, so every seat is a pocket you step
#: into off a lane, and nobody sitting down is in anybody's way.
DESK_COLS = (11, 15, 19)
DESK_SEAT_ROWS = (3, 8)
#: The lane the arrival hall's chevrons point down: the row that comes through
#: the gap beside the stub wall and meets the corridor. Not the seat row.
DESK_LANE_ROW = 7

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

    # Technical grating: the Archive, and the whole floor of the desks, which
    # is what tells the focus alcove apart from the arrival hall next to it.
    grate = [['grate_a', 'grate_b'], ['grate_c', 'grate_d']]
    floor.motif(range(23, 33), range(3, 10), grate)
    floor.motif(range(11, 22), range(3, 11), grate)

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

    # One over where you land, and one over every focus desk: in a world this
    # dark, lighting a seat is what says it is meant to be used.
    pool(ARRIVAL_TILE[0] - 1, ARRIVAL_TILE[1] - 1)
    for row in DESK_SEAT_ROWS:
        for col in DESK_COLS:
            pool(col, row - 1)
    for col, row in [(5, 18), (16, 17), (26, 19)]:
        pool(col, row)

    # Single lamps: warm over the gallery, cold over the Archive.
    for col in (4, 10, 16, 22, 28):
        lights.put(col, 12, 'spot')
    for col, row in [(25, 6), (29, 6), (24, 9), (30, 9)]:
        lights.put(col, row, 'spot_cold')

    # Threshold of the door back: the light coming in from the other world.
    lights.put(DOOR_TILE[0], DOOR_TILE[1], 'threshold')

    # Signposting, so nobody arriving has to wander: a chevron between where
    # you land and the door you came through, and a line of them along the lane
    # that leads east into the desks — the lane, not the row the desks' chairs
    # are on, or the signs would be walking people into somebody's seat.
    lights.put(DOOR_TILE[0], DOOR_TILE[1] + 1, 'arrow_n')
    for col in range(6, 10):
        lights.put(col, DESK_LANE_ROW, 'arrow_e')
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
    A grid of gids drawn with its top-left corner at (col, row). A 0 leaves the
    tile empty. Raw: this is what `Piece.at()` is built on, and what the tiles
    of our own dark tileset (the doorway, the letters of the mark) use — they
    are single tiles by design and have no piece to be part of.
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


# ---------------------------------------------------------------------------
# The furniture palette
# ---------------------------------------------------------------------------
#
# Every piece comes from the packs the First Office already uses (absolute
# gids: the tilesets are the same and start at the same firstgid), and every
# one of them is stated as the WHOLE object, not as however many of its tiles
# happen to be wanted. These sheets draw one sofa across six tiles and park an
# unrelated lamp in the seventh, so a block picked by eye is a coin toss that
# loses quietly: the map still renders, it just renders half a chair. Half of
# this palette used to be exactly that.
#
# `tools/tileset_pieces.py` is what settles it, and `check_palette()` below
# runs it on every piece at build time, so a cut one cannot be committed.


@dataclass(frozen=True)
class Piece:
    """
    One object of furniture: the tiles that draw it, and which of them block.

    `solid_rows` counts rows from the bottom — a cabinet three rows tall blocks
    only the row it stands on, so avatars pass behind it (the First Office's
    idiom; blocking all of it would wall a room off). Within those rows only
    the tiles that are actually drawn on become solid, which is what keeps the
    other half of the bargain: no invisible body over bare floor.
    """

    name: str
    #: Sheet it is cut from; the build checks the piece against this one.
    sheet: str
    grid: list[list[int]]
    #: How many rows, counted from the bottom, stand on the floor.
    solid_rows: int = 0
    #: Sides where the sheet packs the next object flush against this one, with
    #: no transparent seam. Only the sofa row of `Basement` does this. Listing
    #: a side here says "I have looked at this one"; a cut anywhere else fails
    #: the build.
    abuts: tuple[str, ...] = ()
    #: Fraction of a tile that has to be drawn on before it may block the way.
    #: Low, because what it has to keep out is the empty corner of a bounding
    #: box, not the overhanging end of a bench: a fifth of a tile of ink is a
    #: piece of furniture you would expect to walk into.
    ink: float = 0.2

    @property
    def width(self) -> int:
        return len(self.grid[0])

    @property
    def height(self) -> int:
        return len(self.grid)

    def at(self, col: int, row: int) -> list[dict]:
        """The objects that put this piece with its top-left corner at (col, row)."""
        firstgid, columns = SHEETS[self.sheet]
        out: list[dict] = []
        for j, line in enumerate(self.grid):
            solid_row = j >= self.height - self.solid_rows
            for i, gid in enumerate(line):
                solid = solid_row and ink_fraction(self.sheet, firstgid, columns, gid) >= self.ink
                out += block(col + i, row + j, [[gid]], solid=solid)
        return out


#: Where each sheet starts and how wide it is, read off the First Office's own
#: tilesets at build time (see `sheets_from`), so the palette cannot drift out
#: of step with the map it is written into.
SHEETS: dict[str, tuple[int, int]] = {}


def sheets_from(source: dict) -> None:
    for tileset in source['tilesets']:
        SHEETS[tileset['name']] = (tileset['firstgid'], tileset['columns'])


BASEMENT = 'Basement'
GENERIC = 'Generic'
OFFICE = 'Modern_Office_Black_Shadow'

#: Wall screen, switched off. Goes on the wall, which already blocks the way.
SCREEN = Piece('screen', BASEMENT, [[5164, 5165], [5180, 5181]])
#: Three-seat sofa. The sheet parks the next sofa flush against its right and
#: the armchairs flush under its base; both have been looked at.
SOFA = Piece(
    'sofa',
    BASEMENT,
    [[4691, 4692, 4693], [4707, 4708, 4709]],
    solid_rows=2,
    abuts=('right', 'bottom'),
)
#: Bench for the gallery and the arrival hall: cold, low, and four tiles long.
BENCH = Piece('bench', BASEMENT, [[4970, 4971, 4972, 4973], [4986, 4987, 4988, 4989]], solid_rows=1)
#: Round wooden table. Drawn in the middle of its three-by-three, so only the
#: tiles it actually stands on end up blocking.
LOW_TABLE = Piece(
    'low table',
    BASEMENT,
    [[4784, 4785, 4786], [4800, 4801, 4802], [4816, 4817, 4818]],
    solid_rows=2,
)
COLD_ARMCHAIR = Piece('cold armchair', BASEMENT, [[5222, 5223], [5238, 5239]], solid_rows=2)
WARM_ARMCHAIR = Piece('warm armchair', BASEMENT, [[5224, 5225], [5240, 5241]], solid_rows=2)
POOL_TABLE = Piece(
    'pool table',
    BASEMENT,
    [[5140, 5141, 5142, 5143], [5156, 5157, 5158, 5159], [5172, 5173, 5174, 5175]],
    solid_rows=2,
)
#: Glass-fronted cabinet: what the Archive is furnished with, over and over.
#: Pale, so the Archive's cold spots have something to catch.
CABINET = Piece('cabinet', BASEMENT, [[5034, 5035], [5050, 5051]], solid_rows=1)
#: Kitchen run for the Night Café, and the sink unit that goes beside it.
COUNTER = Piece(
    'counter',
    GENERIC,
    [[4536, 4537, 4538], [4552, 4553, 4554], [4568, 4569, 4570]],
    solid_rows=2,
)
SINK_UNIT = Piece('sink unit', GENERIC, [[4563, 4564], [4579, 4580]], solid_rows=2)
VENDING = Piece(
    'vending machines',
    BASEMENT,
    [[5344, 5345, 5346, 5347], [5360, 5361, 5362, 5363], [5376, 5377, 5378, 5379]],
    solid_rows=1,
)
CAFE_TABLE = Piece(
    'cafe table',
    BASEMENT,
    [[4902, 4903, 4904, 4905], [4918, 4919, 4920, 4921], [4934, 4935, 4936, 4937]],
    solid_rows=2,
)
STOOL = Piece('stool', BASEMENT, [[5006], [5022]], solid_rows=1)
#: Tall plant: drawn over three tiles, blocking only the one it stands in, so
#: you can walk behind it. Same piece the First Office uses.
PLANT = Piece('plant', OFFICE, [[2782], [2798], [2814]], solid_rows=1)

PALETTE = [
    SCREEN,
    SOFA,
    BENCH,
    LOW_TABLE,
    COLD_ARMCHAIR,
    WARM_ARMCHAIR,
    POOL_TABLE,
    CABINET,
    COUNTER,
    SINK_UNIT,
    VENDING,
    CAFE_TABLE,
    STOOL,
    PLANT,
]


def check_palette() -> None:
    """
    Every piece has to be a whole object of its sheet. Three ways it can fail,
    all of which have actually happened in this map:

    - its tiles are not one rectangle of the sheet (the Night Café's counter
      was a worktop glued to a sink from eleven columns away);
    - a whole column or row of it is blank (the Archive's cabinets were a
      three-wide slice of a two-wide locker, so every one of them had an empty
      column);
    - ink crosses its border (both armchairs were one half of a chair).
    """
    for piece in PALETTE:
        firstgid, columns = SHEETS[piece.sheet]
        where = f'{piece.name} ({piece.sheet} {piece.grid[0][0]})'
        try:
            sheet_rect(firstgid, columns, piece.grid)
        except ValueError as wrong:
            raise SystemExit(f'{where}: {wrong}') from wrong
        blank = blank_lines(piece.sheet, firstgid, columns, piece.grid)
        if blank:
            raise SystemExit(
                f'{where}: nothing is drawn on its {", ".join(blank)} — the block covers '
                'more tiles than the object does'
            )
        cuts = {
            side: n
            for side, n in cut_sides(piece.sheet, firstgid, columns, piece.grid).items()
            if side not in piece.abuts
        }
        if cuts:
            raise SystemExit(
                f'{where}: the block is drawn through on its {", ".join(cuts)} — it is a '
                'piece of an object, not an object. Run '
                f'`python3 tools/tileset_pieces.py {piece.sheet} {firstgid} {columns} '
                f'{piece.grid[0][0]}` to see the whole one.'
            )
        if piece.solid_rows > piece.height:
            raise SystemExit(f'{where}: it is {piece.height} rows tall, not {piece.solid_rows}')


def furniture(source: dict, firstgid: int) -> tuple[list[dict], list[dict]]:
    """All the furniture in the world; returns (decorative, solid)."""
    check_palette()
    objects: list[dict] = []

    # Pieces reused from the First Office: the same assets, already assembled.
    # `piece()` copies whole objects, so unlike a block of gids these cannot
    # come out cut — only over-collected, which is what its filters are for.
    meeting_table = piece(source, 28, 32, 8, 5)  # table with its six chairs
    # A workstation for one: the First Office desk cut short of its second
    # chair, so the chair that is left is unambiguously *this* desk's seat.
    focus_desk = piece(source, 25, 14, 3, 3)

    # --- Arrival hall: the doorway and the world's name on the north wall,
    # plants framing the way in, and the middle kept clear, because that is
    # where people appear.
    objects += portal(DOOR_TILE[0], 0, firstgid)
    objects += mark(MARK_TILE[0], MARK_TILE[1], firstgid)
    objects += PLANT.at(DOOR_TILE[0] - 1, 3)
    objects += PLANT.at(DOOR_TILE[0] + 1, 3)
    # Everything else hugs the edges: a hall you arrive in has to read as open
    # floor, and the lane east to the desks must not be furnished shut. The
    # lounge stops at col 6 on purpose: rows 9-10 are the only way from the
    # hall into the gallery, and one more armchair would halve it.
    objects += BENCH.at(6, 3)
    objects += SOFA.at(1, 9)
    objects += LOW_TABLE.at(4, 8)

    # --- Focus desks: six workstations in two banks of three, each with its
    # own seat, under a wall of screens. What the banks are placed around is
    # the circulation rather than the furniture — see DESK_SEAT_ROWS.
    for col in DESK_COLS:
        objects += SCREEN.at(col, 0)
        for row in DESK_SEAT_ROWS:
            objects += place(focus_desk, col, row)

    # --- Archive: one cabinet repeated, against the north wall and then as two
    # islands with an aisle between them. Row upon row of the same unit is what
    # an archive looks like; three different cupboards would read as a junk room.
    for col in (23, 26, 29):
        objects += CABINET.at(col, 2)
    for col in (24, 28):
        objects += CABINET.at(col, 6)

    # --- The Pit: the lounge, on the rug, with the pool table to the east.
    objects += SOFA.at(2, 16)
    objects += LOW_TABLE.at(4, 18)
    objects += COLD_ARMCHAIR.at(1, 19)
    objects += WARM_ARMCHAIR.at(8, 16)
    objects += POOL_TABLE.at(7, 18)

    # --- War Room: the table, facing the gallery. Eight tiles wide, which is
    # exactly the span between the two stub walls — the nine-wide one the First
    # Office uses puts its end chair inside the stub at col 12.
    objects += place(meeting_table, 13, 16)

    # --- Gallery: benches and plants between the columns, so the axis is not
    # an empty 32-tile corridor. Both keep clear of the pillars (cols 6, 17, 28).
    for col in (9, 20, 31):
        objects += PLANT.at(col, 12)
    for col in (2, 12, 23):
        objects += BENCH.at(col, 12)

    # --- Night Café: the counter run along the north side and the table with
    # its stools below it, so the whole café reads as one place to stand and
    # one place to sit rather than as furniture dropped on a floor.
    objects += COUNTER.at(23, 15)
    objects += SINK_UNIT.at(26, 16)
    objects += VENDING.at(29, 15)
    objects += CAFE_TABLE.at(25, 19)
    objects += STOOL.at(24, 19)
    objects += STOOL.at(29, 19)
    objects += PLANT.at(32, 19)

    decor = [o for o in objects if not o['_solid']]
    solid = [o for o in objects if o['_solid']]
    return decor, solid


def seats() -> list[dict]:
    """
    One `seat` object per focus desk: the tile the chair stands on, which is
    also where whoever sits is pinned. `dir` is `down` because every chair is
    drawn above its desk, so sitting means facing south, into the work.

    They are map data, like the doors: the app has no list of its own, and
    moving a desk in Tiled moves the seat with it.
    """
    out = []
    for row in DESK_SEAT_ROWS:
        for col in DESK_COLS:
            out.append(
                {
                    'name': f'Focus desk {len(out) + 1}',
                    'type': 'seat',
                    # The chair is the middle column of the three-tile unit.
                    'x': (col + 1) * TILE,
                    'y': row * TILE,
                    'width': TILE,
                    'height': TILE,
                    'properties': [{'name': 'dir', 'type': 'string', 'value': 'down'}],
                }
            )
    return out


def mark(col: int, row: int, firstgid: int) -> list[dict]:
    """
    The world's name in light on the wall: one glowing letter per tile, drawn
    as decorative furniture over the wall (which already blocks the way), the
    same way the doorway is. This is the Chiron mark.
    """
    letters = [[firstgid + INDEX[f'mark_{glyph}'] for glyph in 'chiron']]
    return block(col, row, letters)


def portal(col: int, row: int, firstgid: int) -> list[dict]:
    """
    The doorway between worlds, drawn as decorative furniture on top of the
    wall (which already blocks the way). It is not the door itself: that is the
    `door` rectangle, on the floor, right in front of the opening.
    """
    return block(col, row, [[firstgid + INDEX['portal_top']], [firstgid + INDEX['portal_bottom']]])


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
    sheets_from(source)

    # The First Office's tilesets, so its furniture can be copied by gid --
    # except its copy of ours (it embeds ChironDark for the doorway). Two
    # tilesets with the same name in one map is a trap: Phaser registers the
    # name once, every gid of the second one then resolves against the first,
    # and the tiles come out as whatever happens to sit at that index.
    tilesets = [dict(ts) for ts in source['tilesets'] if ts['name'] != TILESET_NAME]
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

    desk_seats = numbered(seats())

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
        'nextlayerid': 10,
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
            object_layer(7, 'Seats', desk_seats, collides=None),
            object_layer(8, 'Doors', doors, collides=None),
            object_layer(9, 'Spawn', spawns, collides=None),
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
