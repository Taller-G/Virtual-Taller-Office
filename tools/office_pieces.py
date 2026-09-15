"""
The furniture both offices are built from: which tiles draw each piece, which
of them block the way, and the handful of assemblies that were solved once in
Tiled and are reused whole.

Both map generators (`make-first-office-map.py`, `make-chiron-map.py`) build
their furniture from here, so a piece that is right in one world is right in
the other, and a piece that is wrong is wrong in one place only.

Two ways of stating a piece live here, and the difference matters:

- **`Piece`**: the tiles of a sheet that draw one object, as a grid of gids.
  Every one is checked at build time (`check_palette`) against the PNG itself
  with `tools/tileset_pieces.py`: LimeZu's sheets pack unrelated objects flush
  against each other, so a block picked by eye renders half a chair and
  nothing complains. This is how a new piece is added.
- **Assemblies**: objects copied verbatim out of the map, as data. A
  workstation is a stack of a dozen sprites (desk, shadow, screen, chair, and
  the 96x64 computer) that nobody wants to reason about twice. They were cut
  out of the First Office as it stood before the layout was redesigned --
  `MEETING_TABLE_6` from the rectangle at (28,32) 8x5 and `WORKSTATION` from
  (25,14) 3x3 -- and they are frozen here rather than read back out of the map
  so that moving a desk in either world cannot quietly change the other.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tileset_pieces import (  # noqa: E402
    blank_lines,
    cut_sides,
    ink_fraction,
    sheet_rect,
)

TILE = 32

#: Where each sheet starts and how wide it is, read off a map's own tilesets at
#: build time (see `sheets_from`), so the palette cannot drift out of step with
#: the map it is written into.
SHEETS: dict[str, tuple[int, int]] = {}


def sheets_from(source: dict) -> None:
    """Registers the tilesets of a map, by name -> (firstgid, columns)."""
    for tileset in source['tilesets']:
        SHEETS[tileset['name']] = (tileset['firstgid'], tileset['columns'])


BASEMENT = 'Basement'
GENERIC = 'Generic'
OFFICE = 'Modern_Office_Black_Shadow'


def block(col: int, row: int, grid: list[list[int]], solid: bool = False) -> list[dict]:
    """
    A grid of gids drawn with its top-left corner at (col, row). A 0 leaves the
    tile empty. Raw: this is what `Piece.at()` is built on, and what single
    tiles with no piece to belong to (a doorway, a letter of a sign) use.
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


@dataclass(frozen=True)
class Piece:
    """
    One object of furniture: the tiles that draw it, and which of them block.

    `solid_rows` counts rows from the bottom -- a cabinet three rows tall
    blocks only the row it stands on, so avatars pass behind it (the First
    Office's idiom; blocking all of it would wall a room off). Within those
    rows only the tiles that are actually drawn on become solid, which is what
    keeps the other half of the bargain: no invisible body over bare floor.
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

    def at(self, col: int, row: int, grid: list[list[int]] | None = None) -> list[dict]:
        """The objects that put this piece with its top-left corner at (col, row)."""
        firstgid, columns = SHEETS[self.sheet]
        out: list[dict] = []
        rows = grid or self.grid
        for j, line in enumerate(rows):
            solid_row = j >= len(rows) - self.solid_rows
            for i, gid in enumerate(line):
                solid = solid_row and ink_fraction(self.sheet, firstgid, columns, gid) >= self.ink
                out += block(col + i, row + j, [[gid]], solid=solid)
        return out


# ---------------------------------------------------------------------------
# The palette
# ---------------------------------------------------------------------------
#
# Every piece is stated as the WHOLE object, not as however many of its tiles
# happen to be wanted. These sheets draw one sofa across six tiles and park an
# unrelated lamp in the seventh, so a block picked by eye is a coin toss that
# loses quietly: the map still renders, it just renders half a chair. Half of
# this palette used to be exactly that (`chiron-memory/gotchas.md`).

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
#: Bench: cold, low, and four tiles long. The waiting seat of a lobby.
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
#: Glass-fronted cabinet.
CABINET = Piece('cabinet', BASEMENT, [[5034, 5035], [5050, 5051]], solid_rows=1)
#: Kitchen run, and the sink unit that goes beside it.
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
#: you can walk behind it.
PLANT = Piece('plant', OFFICE, [[2782], [2798], [2814]], solid_rows=1)
#: The meeting table, as the sheet draws it: a left end, a middle that is meant
#: to repeat, and a right end. Only the two lower rows block; the top one is
#: the far edge of the table, and the chairs on the north side are drawn over
#: it -- which is what makes the seat on that side walkable at all.
MEETING_TABLE = Piece(
    'meeting table',
    OFFICE,
    [[2595, 2596, 2597], [2611, 2612, 2613], [2627, 2628, 2629]],
    solid_rows=2,
)

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
    MEETING_TABLE,
]


def check_palette(pieces: list[Piece] | None = None) -> None:
    """
    Every piece has to be a whole object of its sheet. Three ways it can fail,
    all of which have actually happened in these maps:

    - its tiles are not one rectangle of the sheet (the Night Cafe's counter
      was a worktop glued to a sink from eleven columns away);
    - a whole column or row of it is blank (the Archive's cabinets were a
      three-wide slice of a two-wide locker, so every one of them had an empty
      column);
    - ink crosses its border (both armchairs were one half of a chair).
    """
    for piece in pieces or PALETTE:
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


# ---------------------------------------------------------------------------
# Tables and chairs
# ---------------------------------------------------------------------------

#: The chairs of the `chair` sheet, by the way the person sitting on one faces.
#: They are 32x64 sprites: one object, two rows tall, and the LOWER row is the
#: tile the person stands on -- which is why a chair is placed by its seat.
CHAIR_GID = {'down': 2562, 'left': 2563, 'right': 2564, 'up': 2566}


def chair(facing: str, col: int, row: int) -> dict:
    """
    A chair whose seat is the tile (col, row), for somebody facing `facing`.

    `direction` is the property the pack's own chairs carry, kept so that every
    chair in the map reads the same in Tiled. What makes it a place to sit is
    not this object but the `seat` next to it (see `docs/map.md`): chairs are
    deliberately decorative, which is what lets an avatar stand on one.
    """
    return {
        'gid': CHAIR_GID[facing],
        'x': col * TILE,
        'y': (row + 1) * TILE,
        'width': TILE,
        'height': 2 * TILE,
        'type': 'chair',
        'properties': [{'name': 'direction', 'type': 'string', 'value': facing}],
        '_solid': False,
    }


def long_table(col: int, row: int, columns: int) -> list[dict]:
    """
    The meeting table, `columns` tiles wide, with its top-left corner at
    (col, row): the sheet's left end, its middle repeated, and its right end.

    Stretching it is not a liberty taken with the art -- the middle column is
    drawn to tile, which is what `MEETING_TABLE`'s three-by-three block is for.
    Anything narrower than three tiles would be an end without a middle.
    """
    if columns < 3:
        raise ValueError(f'a table {columns} tiles wide has no middle')
    grid = [[line[0]] + [line[1]] * (columns - 2) + [line[2]] for line in MEETING_TABLE.grid]
    return MEETING_TABLE.at(col, row, grid)


# ---------------------------------------------------------------------------
# Assemblies copied out of the map
# ---------------------------------------------------------------------------


def place(objects: list[dict], col: int, row: int) -> list[dict]:
    """The assembly, moved so its origin lands on (col, row)."""
    out = []
    for obj in objects:
        moved = dict(obj)
        moved['x'] = obj['x'] + col * TILE
        moved['y'] = obj['y'] + row * TILE
        out.append(moved)
    return out


#: The six-wide meeting table with its eight chairs, as the First Office had it
#: before the redesign and as Chiron's War Room still uses it. Its origin is
#: the tile above the table's left end. (`id` is overwritten when the map is
#: written; it is kept so the object reads the same as it did in Tiled.)
MEETING_TABLE_6 = [
    {'id': 426, 'name': '', 'type': '', 'rotation': 0, 'visible': True, 'gid': 2595, 'width': 32, 'height': 32, 'x': 32, 'y': 64, '_solid': False},
    {'id': 429, 'name': '', 'type': '', 'rotation': 0, 'visible': True, 'gid': 2596, 'width': 32, 'height': 32, 'x': 64, 'y': 64, '_solid': False},
    {'id': 432, 'name': '', 'type': '', 'rotation': 0, 'visible': True, 'gid': 2596, 'width': 32, 'height': 32, 'x': 96, 'y': 64, '_solid': False},
    {'id': 435, 'name': '', 'type': '', 'rotation': 0, 'visible': True, 'gid': 2596, 'width': 32, 'height': 32, 'x': 128, 'y': 64, '_solid': False},
    {'id': 438, 'name': '', 'type': '', 'rotation': 0, 'visible': True, 'gid': 2596, 'width': 32, 'height': 32, 'x': 160, 'y': 64, '_solid': False},
    {'id': 441, 'name': '', 'type': '', 'rotation': 0, 'visible': True, 'gid': 2597, 'width': 32, 'height': 32, 'x': 192, 'y': 64, '_solid': False},
    {'id': 444, 'name': '', 'type': 'chair', 'rotation': 0, 'visible': True, 'gid': 2562, 'width': 32, 'height': 64, 'x': 64, 'y': 64, 'properties': [{'name': 'direction', 'type': 'string', 'value': 'down'}], '_solid': False},
    {'id': 445, 'name': '', 'type': 'chair', 'rotation': 0, 'visible': True, 'gid': 2562, 'width': 32, 'height': 64, 'x': 128, 'y': 64, 'properties': [{'name': 'direction', 'type': 'string', 'value': 'down'}], '_solid': False},
    {'id': 446, 'name': '', 'type': 'chair', 'rotation': 0, 'visible': True, 'gid': 2562, 'width': 32, 'height': 64, 'x': 192, 'y': 64, 'properties': [{'name': 'direction', 'type': 'string', 'value': 'down'}], '_solid': False},
    {'id': 447, 'name': '', 'type': 'chair', 'rotation': 0, 'visible': True, 'gid': 2566, 'width': 32, 'height': 64, 'x': 64, 'y': 160, 'properties': [{'name': 'direction', 'type': 'string', 'value': 'up'}], '_solid': False},
    {'id': 448, 'name': '', 'type': 'chair', 'rotation': 0, 'visible': True, 'gid': 2566, 'width': 32, 'height': 64, 'x': 128, 'y': 160, 'properties': [{'name': 'direction', 'type': 'string', 'value': 'up'}], '_solid': False},
    {'id': 449, 'name': '', 'type': 'chair', 'rotation': 0, 'visible': True, 'gid': 2566, 'width': 32, 'height': 64, 'x': 192, 'y': 160, 'properties': [{'name': 'direction', 'type': 'string', 'value': 'up'}], '_solid': False},
    {'id': 450, 'name': '', 'type': 'chair', 'rotation': 0, 'visible': True, 'gid': 2563, 'width': 32, 'height': 64, 'x': 224, 'y': 128, 'properties': [{'name': 'direction', 'type': 'string', 'value': 'left'}], '_solid': False},
    {'id': 451, 'name': '', 'type': 'chair', 'rotation': 0, 'visible': True, 'gid': 2564, 'width': 32, 'height': 64, 'x': 0, 'y': 128, 'properties': [{'name': 'direction', 'type': 'string', 'value': 'right'}], '_solid': False},
    {'id': 427, 'name': '', 'type': '', 'rotation': 0, 'visible': True, 'gid': 2611, 'width': 32, 'height': 32, 'x': 32, 'y': 96, '_solid': True},
    {'id': 428, 'name': '', 'type': '', 'rotation': 0, 'visible': True, 'gid': 2627, 'width': 32, 'height': 32, 'x': 32, 'y': 128, '_solid': True},
    {'id': 430, 'name': '', 'type': '', 'rotation': 0, 'visible': True, 'gid': 2612, 'width': 32, 'height': 32, 'x': 64, 'y': 96, '_solid': True},
    {'id': 431, 'name': '', 'type': '', 'rotation': 0, 'visible': True, 'gid': 2628, 'width': 32, 'height': 32, 'x': 64, 'y': 128, '_solid': True},
    {'id': 433, 'name': '', 'type': '', 'rotation': 0, 'visible': True, 'gid': 2612, 'width': 32, 'height': 32, 'x': 96, 'y': 96, '_solid': True},
    {'id': 434, 'name': '', 'type': '', 'rotation': 0, 'visible': True, 'gid': 2628, 'width': 32, 'height': 32, 'x': 96, 'y': 128, '_solid': True},
    {'id': 436, 'name': '', 'type': '', 'rotation': 0, 'visible': True, 'gid': 2612, 'width': 32, 'height': 32, 'x': 128, 'y': 96, '_solid': True},
    {'id': 437, 'name': '', 'type': '', 'rotation': 0, 'visible': True, 'gid': 2628, 'width': 32, 'height': 32, 'x': 128, 'y': 128, '_solid': True},
    {'id': 439, 'name': '', 'type': '', 'rotation': 0, 'visible': True, 'gid': 2612, 'width': 32, 'height': 32, 'x': 160, 'y': 96, '_solid': True},
    {'id': 440, 'name': '', 'type': '', 'rotation': 0, 'visible': True, 'gid': 2628, 'width': 32, 'height': 32, 'x': 160, 'y': 128, '_solid': True},
    {'id': 442, 'name': '', 'type': '', 'rotation': 0, 'visible': True, 'gid': 2613, 'width': 32, 'height': 32, 'x': 192, 'y': 96, '_solid': True},
    {'id': 443, 'name': '', 'type': '', 'rotation': 0, 'visible': True, 'gid': 2629, 'width': 32, 'height': 32, 'x': 192, 'y': 128, '_solid': True},
]

#: A workstation for one: desk, screen, its shadows and its chair, three tiles
#: wide. Its origin is the seat -- the tile the chair stands on -- so placing
#: one is saying where somebody sits, and the desk follows on the two rows
#: below (which are the ones that block).
WORKSTATION = [
    {'gid': 2587, 'height': 32, 'id': 338, 'name': '', 'rotation': 0, 'type': '', 'visible': True, 'width': 32, 'x': 64, 'y': 32, '_solid': False},
    {'gid': 2586, 'height': 32, 'id': 339, 'name': '', 'rotation': 0, 'type': '', 'visible': True, 'width': 32, 'x': 32, 'y': 32, '_solid': False},
    {'gid': 2585, 'height': 32, 'id': 340, 'name': '', 'rotation': 0, 'type': '', 'visible': True, 'width': 32, 'x': 0, 'y': 32, '_solid': False},
    {'gid': 2835, 'height': 32, 'id': 341, 'name': '', 'rotation': 0, 'type': '', 'visible': True, 'width': 32, 'x': 0, 'y': 32, '_solid': False},
    {'gid': 2568, 'height': 64, 'id': 343, 'name': '', 'properties': [{'name': 'direction', 'type': 'string', 'value': 'down'}], 'rotation': 0, 'type': 'chair', 'visible': True, 'width': 32, 'x': 32, 'y': 32, '_solid': False},
    {'gid': 4680, 'height': 64, 'id': 344, 'name': '', 'rotation': 0, 'type': 'computer', 'visible': True, 'width': 96, 'x': 0, 'y': 96, '_solid': False},
    {'gid': 2619, 'height': 32, 'id': 345, 'name': '', 'rotation': 0, 'type': '', 'visible': True, 'width': 32, 'x': 64, 'y': 64, '_solid': True},
    {'gid': 2618, 'height': 32, 'id': 346, 'name': '', 'rotation': 0, 'type': '', 'visible': True, 'width': 32, 'x': 32, 'y': 64, '_solid': True},
    {'gid': 2617, 'height': 32, 'id': 347, 'name': '', 'rotation': 0, 'type': '', 'visible': True, 'width': 32, 'x': 0, 'y': 64, '_solid': True},
    {'gid': 3021, 'height': 32, 'id': 348, 'name': '', 'rotation': 0, 'type': '', 'visible': True, 'width': 32, 'x': 64, 'y': 64, '_solid': True},
    {'gid': 3021, 'height': 32, 'id': 349, 'name': '', 'rotation': 0, 'type': '', 'visible': True, 'width': 32, 'x': 32, 'y': 64, '_solid': True},
    {'gid': 3037, 'height': 32, 'id': 350, 'name': '', 'rotation': 0, 'type': '', 'visible': True, 'width': 32, 'x': 64, 'y': 96, '_solid': True},
    {'gid': 3037, 'height': 32, 'id': 351, 'name': '', 'rotation': 0, 'type': '', 'visible': True, 'width': 32, 'x': 32, 'y': 96, '_solid': True},
    {'gid': 3020, 'height': 32, 'id': 352, 'name': '', 'rotation': 0, 'type': '', 'visible': True, 'width': 32, 'x': 0, 'y': 64, '_solid': True},
    {'gid': 3036, 'height': 32, 'id': 353, 'name': '', 'rotation': 0, 'type': '', 'visible': True, 'width': 32, 'x': 0, 'y': 96, '_solid': True},
    {'gid': 2592, 'height': 32, 'id': 354, 'name': '', 'rotation': 0, 'type': '', 'visible': True, 'width': 32, 'x': 64, 'y': 64, '_solid': True},
    {'gid': 2591, 'height': 32, 'id': 355, 'name': '', 'rotation': 0, 'type': '', 'visible': True, 'width': 32, 'x': 32, 'y': 64, '_solid': True},
    {'gid': 2590, 'height': 32, 'id': 356, 'name': '', 'rotation': 0, 'type': '', 'visible': True, 'width': 32, 'x': 0, 'y': 64, '_solid': True},
    {'gid': 2624, 'height': 32, 'id': 357, 'name': '', 'rotation': 0, 'type': '', 'visible': True, 'width': 32, 'x': 64, 'y': 96, '_solid': True},
    {'gid': 2623, 'height': 32, 'id': 358, 'name': '', 'rotation': 0, 'type': '', 'visible': True, 'width': 32, 'x': 32, 'y': 96, '_solid': True},
    {'gid': 2622, 'height': 32, 'id': 359, 'name': '', 'rotation': 0, 'type': '', 'visible': True, 'width': 32, 'x': 0, 'y': 96, '_solid': True},
    {'gid': 2850, 'height': 32, 'id': 360, 'name': '', 'rotation': 0, 'type': '', 'visible': True, 'width': 32, 'x': 64, 'y': 64, '_solid': True},
    {'gid': 2866, 'height': 32, 'id': 361, 'name': '', 'rotation': 0, 'type': '', 'visible': True, 'width': 32, 'x': 64, 'y': 96, '_solid': True},
]

#: The whiteboard that hangs on a wall: one 64x64 sprite, two tiles wide and
#: two tall, drawn over the wall it hangs on (which already blocks the way).
WHITEBOARD_GID = 4687


def whiteboard(col: int, row: int) -> list[dict]:
    """The whiteboard with its top-left corner at (col, row)."""
    return [
        {
            'gid': WHITEBOARD_GID,
            'x': col * TILE,
            'y': (row + 2) * TILE,
            'width': 2 * TILE,
            'height': 2 * TILE,
            'type': 'whiteboard',
            '_solid': False,
        }
    ]
