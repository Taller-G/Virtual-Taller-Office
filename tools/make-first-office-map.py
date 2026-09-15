#!/usr/bin/env python3
"""
Builds the map of the "First Office" world: the office everybody lands in.

Usage:  python3 tools/make-first-office-map.py

Development only: the result is committed to
`apps/client/public/assets/map/first-office.json` and edited in Tiled from
there like any other map (see `docs/map.md`). This script exists so the world
can be rebuilt from scratch reproducibly, which is also what makes the plan
reviewable: the floor plan is stated here in rooms and corridors rather than in
forty thousand tile ids.

The plan is a front of house, a work floor and a meeting wing, in that order
from north to south, on the same 40x40 canvas the office always had:

      +--------------------------------------------------+
      | Kitchen & Lounge |   RECEPTION    |  Focus Room   |  rows 2-10
      |                  |  (door, spawn) |               |
      +------- opening --+--- the aisle --+-- opening ----+  rows 11-12
      |                                                   |
      |   OPEN DESK AREA -- two banks either side of a    |  rows 13-23
      |   four-tile aisle that runs the length of it      |
      +---------------------- opening --------------------+  rows 24-25
      |            meeting-wing corridor                  |  rows 26-27
      +---- door ------------- door -------- door --------+  rows 28-29
      | West Meeting  |  Centre Meeting  |  East Meeting  |  rows 30-37
      +--------------------------------------------------+

What the plan is built around, in order:

- **One walk from the door to any meeting.** The aisle starts at the lobby,
  crosses the desk area without touching a desk, and ends at the corridor the
  three meeting rooms open onto. Nobody has to squeeze between desks to get to
  a meeting, and nobody sitting down is ever in that lane.
- **Meeting rooms as rooms.** Each is a bay of the wing with one big table,
  ten seats around it, a two-tile door and walls that go all the way round.
  The walls between them are **two tiles thick**: the conversation bubble is
  two tiles across, so anything thinner and two people either side of a wall
  would be in the same conversation.
- **The arrival reads as an arrival.** You appear in the middle of the lobby,
  with the office's mark on the floor in front of you and the way back to the
  Chiron Office on the wall behind.

The furniture is the palette both offices share (`tools/office_pieces.py`).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from office_pieces import (  # noqa: E402
    BENCH,
    CABINET,
    CAFE_TABLE,
    COLD_ARMCHAIR,
    COUNTER,
    LOW_TABLE,
    PLANT,
    SCREEN,
    SINK_UNIT,
    SOFA,
    STOOL,
    TILE,
    VENDING,
    WARM_ARMCHAIR,
    WORKSTATION,
    block,
    chair,
    check_palette,
    long_table,
    place,
    sheets_from,
    whiteboard,
)

ROOT = Path(__file__).resolve().parent.parent
MAPS = ROOT / 'apps/client/public/assets/map'
TARGET = MAPS / 'first-office.json'

WIDTH, HEIGHT = 40, 40

# ---------------------------------------------------------------------------
# The plan
# ---------------------------------------------------------------------------
#
# Rows. The north wall takes rows 0 (cap) and 1 (body); every interior wall
# takes two rows as well -- the lower edge of what is above it, then its own
# face, seen by the room below. The last walkable row is 37 and row 38 is the
# south wall, which leaves row 39 outside the building.

NORTH_BAND = range(2, 11)
DESK_BAND = range(13, 24)
CORRIDOR = range(26, 28)
WING = range(30, 38)
SOUTH_WALL = 38

#: Interior walls, by the row their upper edge is on (the face is the next row).
BAND_WALLS = (11, 24, 28)

# Columns. The building is cols 1-38; col 0 and col 39 are its side walls.
FIRST_COL, LAST_COL = 1, WIDTH - 2

#: The aisle: the office's north-south axis, four tiles wide, kept clear from
#: the lobby to the meeting rooms. Every opening between bands is on it.
AISLE = range(18, 22)

#: The rooms of the north band: name, first and last column.
KITCHEN = ('Kitchen & Lounge', 1, 12)
RECEPTION = ('Reception', 14, 26)
FOCUS = ('Focus Room', 28, 38)

#: The meeting wing: name, first and last column, and the columns of its door.
#: Eleven or twelve tiles wide -- the table with its ten chairs is ten across,
#: so that is a tile of clearance and the room still reads as a room. The
#: centre bay is the wide one, and its door is on the aisle.
MEETING_ROOMS = [
    ('West Meeting Room', 1, 11, (5, 6)),
    ('Centre Meeting Room', 14, 25, (19, 20)),
    ('East Meeting Room', 28, 38, (32, 33)),
]
#: How many seats every meeting room has. Four a side, one at each end: the
#: same table in every room, so a meeting can be put in any of them.
MEETING_SEATS = 10
#: Row the meeting tables' far edge is on. The chairs on the north side are
#: drawn over that row, the two rows below it are the table itself, and the
#: chairs on the south side stand on the row below that: rows 31-35 in all,
#: which leaves row 30 clear in front of the door and rows 36-37 behind.
TABLE_ROW = 32

#: The open desk area: the rows the two banks of workstations sit on (a
#: workstation is its seat plus the two rows of desk below it), and the columns
#: of each unit, mirrored about the aisle. Rows 13, 18 and 23 stay empty: the
#: one between the banks is what keeps the way across the floor off anybody's
#: chair, and the columns between the units do the same going the other way.
DESK_SEAT_ROWS = (15, 20)
DESK_COLS = (3, 8, 13, 24, 29, 34)

#: The focus room's desks: same workstation, two banks of two.
FOCUS_SEAT_ROWS = (4, 8)
FOCUS_COLS = (30, 34)

#: Door to the Chiron Office, in the lobby's north wall, and where you land
#: coming back through it: one tile in, with your back to the opening.
DOOR_TILE = (16, 2)
ARRIVAL_TILE = (16, 4)
#: The world's entrance: the middle of the lobby, in front of the mark.
ENTRY_TILE = (20, 8)

# ---------------------------------------------------------------------------
# The tile vocabulary (FloorAndGround, the pack the office has always used)
# ---------------------------------------------------------------------------

WALL_TL, WALL_TOP, WALL_TR = 29, 594, 90
WALL_BODY = 658
#: Side walls: the strip hugs the room, so they come in a left and a right.
WALL_W, WALL_E = 152, 154
#: An interior wall seen edge-on, with a room on both sides of it.
WALL_BOTH = 92
#: The lower edge of a room, and the corners where a side wall meets it.
WALL_BOTTOM, WALL_BL, WALL_BR = 217, 216, 218
#: The face of an interior wall, seen by the room to the south, and the two
#: tiles that cap a run of it where a doorway cuts it.
FACE, FACE_L, FACE_R = 994, 993, 995

#: Floors, one per kind of place, so what a room is for can be read off the
#: ground: the lobby is the dark one you arrive on, the corridors are the grey
#: that runs through the whole office, the desks are boards, the meeting rooms
#: and the focus room are pale, the kitchen is warm.
FLOOR_LOBBY = 668
FLOOR_LOBBY_SHADOW = 604
FLOOR_CORRIDOR = 412
FLOOR_DESKS = 415
FLOOR_MEETING = 2383
FLOOR_FOCUS = 2319
FLOOR_KITCHEN = 1607

#: The doorway between worlds, in the Chiron Office's own tileset: a dark hole
#: cut into the bright wall (`tools/chiron_tiles.py`), plus the light it spills
#: on the tile you step on.
PORTAL_TOP, PORTAL_BOTTOM, THRESHOLD = 'portal_top', 'portal_bottom', 'threshold'
CHIRON_TILESET = 'ChironDark'


class TileGrid:
    """A tile layer, written by tile rather than by index."""

    def __init__(self) -> None:
        self.data = [0] * (WIDTH * HEIGHT)

    def put(self, col: int, row: int, gid: int) -> None:
        if not (0 <= col < WIDTH and 0 <= row < HEIGHT):
            raise IndexError(f'({col},{row}) falls outside the map')
        self.data[row * WIDTH + col] = gid

    def fill(self, cols, rows, gid: int) -> None:
        for row in rows:
            for col in cols:
                self.put(col, row, gid)


def build_walls() -> list[int]:
    walls = TileGrid()
    inner = range(FIRST_COL, LAST_COL + 1)

    # The shell: cap and body to the north, a side wall each side, an edge to
    # the south.
    walls.put(0, 0, WALL_TL)
    walls.put(WIDTH - 1, 0, WALL_TR)
    walls.fill(inner, range(0, 1), WALL_TOP)
    walls.fill(inner, range(1, 2), WALL_BODY)
    for row in range(1, SOUTH_WALL):
        walls.put(0, row, WALL_W)
        walls.put(WIDTH - 1, row, WALL_E)
    walls.put(0, SOUTH_WALL, WALL_BL)
    walls.put(WIDTH - 1, SOUTH_WALL, WALL_BR)
    walls.fill(inner, range(SOUTH_WALL, SOUTH_WALL + 1), WALL_BOTTOM)

    # The three walls that divide the office into bands, each with its openings.
    for row in BAND_WALLS:
        horizontal_wall(walls, row, openings_of(row))

    # The north band: two walls, with a door from the lobby into each room
    # beside it.
    for col, opening in ((KITCHEN[2] + 1, range(5, 7)), (RECEPTION[2] + 1, range(5, 7))):
        for row in NORTH_BAND:
            if row not in opening:
                walls.put(col, row, WALL_BOTH)

    # The meeting wing: two tiles of wall between one room and the next, so
    # that two people either side of it are three tiles apart and out of each
    # other's conversation.
    for _, _, last, _ in MEETING_ROOMS[:-1]:
        for col in (last + 1, last + 2):
            for row in WING:
                walls.put(col, row, WALL_BOTH)
    return walls.data


def openings_of(row: int) -> list[range]:
    """
    Where a band wall is open. The aisle goes through all of them, so the walk
    from the lobby to a meeting room never turns; the rest are what keeps the
    office from being three corridors that only meet in one place.
    """
    if row == BAND_WALLS[0]:  # the north band on to the work floor
        return [AISLE, range(6, 8)]
    if row == BAND_WALLS[1]:  # the work floor on to the meeting corridor
        return [AISLE, range(3, 5), range(35, 37)]
    return [range(c0, c1 + 1) for _, _, _, (c0, c1) in MEETING_ROOMS]


def horizontal_wall(walls: TileGrid, row: int, openings: list[range]) -> None:
    """
    An interior wall across the whole building: its upper edge on `row` (what
    the room to the north sees of it) and its face on the row below (what the
    room to the south sees), with a gap at every opening. The face is capped
    where a doorway cuts it, which is what stops the skirting ending in mid-air.
    """
    cut = {col for opening in openings for col in opening}
    for col in range(FIRST_COL, LAST_COL + 1):
        if col in cut:
            continue
        walls.put(col, row, WALL_BOTTOM)
        face = FACE
        if col - 1 in cut or col == FIRST_COL:
            face = FACE_L
        elif col + 1 in cut or col == LAST_COL:
            face = FACE_R
        walls.put(col, row + 1, face)


def build_floor(walls: list[int]) -> list[int]:
    floor = TileGrid()

    # The building, wall to wall, in the grey the corridors are made of: every
    # doorway is then floored by construction -- a doorway with no floor under
    # it is a hole in the map -- and what is painted over it is what tells one
    # room from the next. The walls take their own tiles back at the end.
    floor.fill(range(FIRST_COL, LAST_COL + 1), range(NORTH_BAND.start, SOUTH_WALL), FLOOR_CORRIDOR)

    # North band: one floor per room, and the lobby's own darker one, which is
    # what makes arriving look like arriving somewhere.
    floor.fill(range(KITCHEN[1], KITCHEN[2] + 1), NORTH_BAND, FLOOR_KITCHEN)
    floor.fill(range(FOCUS[1], FOCUS[2] + 1), NORTH_BAND, FLOOR_FOCUS)
    floor.fill(range(RECEPTION[1], RECEPTION[2] + 1), NORTH_BAND, FLOOR_LOBBY)
    # The band of shadow the north wall casts on it.
    floor.fill(range(RECEPTION[1], RECEPTION[2] + 1), range(2, 3), FLOOR_LOBBY_SHADOW)

    # The work floor, with the aisle left in the corridors' grey so that the
    # way through reads as a way through and not as a gap between desks.
    floor.fill(range(FIRST_COL, LAST_COL + 1), DESK_BAND, FLOOR_DESKS)
    floor.fill(AISLE, DESK_BAND, FLOOR_CORRIDOR)

    # The meeting rooms. The corridor they open onto is already grey.
    for _, first, last, _ in MEETING_ROOMS:
        floor.fill(range(first, last + 1), WING, FLOOR_MEETING)

    # Nothing under a wall: a wall tile is opaque, so floor beneath it is floor
    # nobody will ever see, and it would make the floor layer look, to anything
    # reading the map, like a layer that blocks the way.
    for i, gid in enumerate(walls):
        if gid:
            floor.data[i] = 0
    return floor.data




# ---------------------------------------------------------------------------
# Furniture
# ---------------------------------------------------------------------------


class Furnishing:
    """
    What is in the office, and where. Every piece is added with the rectangle
    of tiles it occupies, and two pieces may not claim the same tile: a plant
    growing through a cabinet renders perfectly happily and is only ever caught
    by looking at the map, which is exactly the kind of mistake that gets
    committed. A piece drawn on the wall (a screen, a whiteboard, the doorway)
    claims its tiles too -- the wall is not furniture, so nothing else is
    entitled to them either.
    """

    def __init__(self) -> None:
        self.objects: list[dict] = []
        self.seats: list[dict] = []
        self.taken: dict[tuple[int, int], str] = {}

    def add(self, what: str, col: int, row: int, cols: int, rows: int, objects: list[dict]) -> None:
        for c in range(col, col + cols):
            for r in range(row, row + rows):
                if (c, r) in self.taken:
                    raise SystemExit(
                        f'the {what} at ({col},{row}) lands on the {self.taken[(c, r)]} at ({c},{r})'
                    )
                self.taken[(c, r)] = what
        self.objects += objects

    def put(self, piece, col: int, row: int) -> None:
        """One piece of the palette, with its top-left corner at (col, row)."""
        self.add(piece.name, col, row, piece.width, piece.height, piece.at(col, row))

    def desks(self, cols, rows) -> None:
        """
        Workstations, and a seat for each: the tile its chair stands on. A unit
        is three tiles wide, its chair on the row it is placed on and its desk
        on the two rows below, so it reaches from one row above to two below.
        """
        for row in rows:
            for col in cols:
                self.add('workstation', col, row - 1, 3, 4, place(WORKSTATION, col, row))
                self.seats.append(
                    seat(col + 1, row, 'down')  # the chair is the middle column
                )

    def meeting_table(self, first: int, last: int) -> None:
        """
        One meeting room's table and its ten seats: four chairs along each side
        and one at each end, every one of them facing the table.

        The table is eight tiles wide, which is what four chairs a side needs:
        they sit on every other tile, so two people at neighbouring chairs are a
        tile apart and both are drawn whole. With the chairs at its ends the
        whole thing is ten tiles across and five deep, and the room is eleven or
        twelve by eight, so there is a way round it however full it is.
        """
        width = 8
        left = first + (last - first + 1 - (width + 2)) // 2 + 1
        objects = long_table(left, TABLE_ROW, width)
        seats = []

        def chair_at(col: int, row: int, facing: str) -> None:
            objects.append(chair(facing, col, row))
            seats.append(seat(col, row, facing))

        # North side first, then south, then the two ends: that is the order
        # the seats are numbered in, and the order somebody naming them would
        # go round the table.
        for col in range(left + 1, left + width, 2):
            chair_at(col, TABLE_ROW, 'down')
        for col in range(left + 1, left + width, 2):
            chair_at(col, TABLE_ROW + 3, 'up')
        chair_at(left - 1, TABLE_ROW + 2, 'right')
        chair_at(left + width, TABLE_ROW + 2, 'left')
        self.add('meeting table', left - 1, TABLE_ROW - 1, width + 2, 5, objects)
        self.seats += seats

    def name_seats(self, prefix: str) -> None:
        """
        Numbers the seats added since the last time: the name is what
        identifies a seat everywhere (it travels in `player.seatId`), so it has
        to be unique and to read as something, not as an id.
        """
        for i, one in enumerate(s for s in self.seats if 'name' not in s):
            one['name'] = f'{prefix} {i + 1}'


def seat(col: int, row: int, facing: str) -> dict:
    """The seat object for the chair at (col, row): the tile you stand on."""
    return {
        'type': 'seat',
        'x': col * TILE,
        'y': row * TILE,
        'width': TILE,
        'height': TILE,
        'properties': [{'name': 'dir', 'type': 'string', 'value': facing}],
    }


def furniture(firstgid: int) -> tuple[list[dict], list[dict], list[dict]]:
    """Everything that is drawn, and everything you can sit on."""
    check_palette()
    office = Furnishing()

    # --- The lobby. Kept open in the middle: that is where people appear, and
    # where the office's mark is painted on the floor (the client draws it from
    # the Reception zone, see `officeMap.ts`). Everything else hugs the walls --
    # the reception run along the north wall, the waiting benches to the west
    # and the lounge to the east.
    office.add('doorway', DOOR_TILE[0], 0, 1, 3, portal(DOOR_TILE[0], 0, firstgid))
    office.put(PLANT, DOOR_TILE[0] - 1, 2)
    office.put(PLANT, DOOR_TILE[0] + 1, 2)
    office.put(SCREEN, 22, 0)
    office.put(CABINET, 22, 2)
    office.put(COUNTER, 24, 2)
    # The sofa goes above its table: it is drawn facing south, so the other way
    # round it would be a sofa with its back to the people sitting at it.
    office.put(SOFA, 23, 5)
    office.put(LOW_TABLE, 23, 7)
    office.put(PLANT, 26, 8)
    office.put(BENCH, 14, 6)
    office.put(BENCH, 14, 9)

    # --- Kitchen & Lounge: the run of units along the north wall, and the
    # table and armchairs below it.
    office.put(COUNTER, 1, 2)
    office.put(SINK_UNIT, 4, 3)
    office.put(VENDING, 8, 2)
    office.put(CAFE_TABLE, 2, 6)
    office.put(STOOL, 1, 7)
    office.put(STOOL, 6, 7)
    office.put(WARM_ARMCHAIR, 9, 6)
    # The armchairs stay clear of col 12: that is the tile you step on to come
    # through the door from the lobby, and a chair there makes a two-tile
    # doorway a one-tile one.
    office.put(COLD_ARMCHAIR, 11, 8)
    office.put(PLANT, 12, 2)

    # --- Focus Room: two banks of two workstations, with the way in and the
    # lane between them on col 28, so nobody sitting down is in the way.
    office.desks(FOCUS_COLS, FOCUS_SEAT_ROWS)
    office.name_seats('Focus desk')
    office.put(PLANT, FOCUS[1], 2)
    office.put(CABINET, FOCUS[2] - 1, 2)

    # --- The open desk area: two banks either side of the aisle, and a screen
    # over each bank on the wall above.
    office.desks(DESK_COLS, DESK_SEAT_ROWS)
    office.name_seats('Desk')
    for col in DESK_COLS:
        office.put(SCREEN, col, BAND_WALLS[0])
    office.put(PLANT, FIRST_COL, DESK_BAND.stop - 3)
    office.put(PLANT, LAST_COL, DESK_BAND.stop - 3)

    # --- The corridor of the meeting wing: a bench outside the rooms and a
    # plant at either end. Both keep off the aisle, which crosses the corridor
    # at cols 18-21 and is the one lane that has to stay four tiles wide.
    office.put(BENCH, 14, CORRIDOR.start)
    office.put(BENCH, 22, CORRIDOR.start)
    office.put(PLANT, FIRST_COL, CORRIDOR.start - 1)
    office.put(PLANT, LAST_COL, CORRIDOR.start - 1)

    # --- The meeting wing: the same table and the same ten seats in every
    # room, a whiteboard on the wall behind each one, and a plant in the corner
    # the chairs do not reach.
    for name, first, last, (door_from, _) in MEETING_ROOMS:
        office.meeting_table(first, last)
        office.name_seats(f'{name} seat')
        office.add('whiteboard', door_from + 3, BAND_WALLS[2], 2, 2,
                   whiteboard(door_from + 3, BAND_WALLS[2]))
        office.put(PLANT, last, WING.stop - 3)

    decor = [o for o in office.objects if not o.get('_solid')]
    solid = [o for o in office.objects if o.get('_solid')]
    return decor, solid, office.seats


def portal(col: int, row: int, firstgid: int) -> list[dict]:
    """
    The doorway to the Chiron Office, drawn as decorative furniture on top of
    the wall (which already blocks the way): a dark opening cut into the bright
    wall, and the light it spills on the floor you step on. It is not the door
    itself -- that is the `door` rectangle, on the tile below it.
    """
    from chiron_tiles import INDEX

    return block(col, row, [[firstgid + INDEX[PORTAL_TOP]], [firstgid + INDEX[PORTAL_BOTTOM]]]) + \
        block(col, row + 2, [[firstgid + INDEX[THRESHOLD]]])


# ---------------------------------------------------------------------------
# Assembling the file
# ---------------------------------------------------------------------------


def zones() -> list[dict]:
    """
    The named places. Every room is one, its rectangle covering the whole room,
    so the label lands inside it and everybody in the room is in the same zone.

    The three rooms of the wing also carry the `meeting` property: that is what
    makes a room bookable (`findMeetingRooms` in `packages/shared/src/map.ts`),
    and it is what a scheduled meeting means when it names a room. Its seats
    are the `seat` objects inside its rectangle, which is why the rectangle
    covers the whole room and no more.
    """
    out = [
        (KITCHEN[0], KITCHEN[1], NORTH_BAND.start, KITCHEN[2], NORTH_BAND.stop - 1),
        (RECEPTION[0], RECEPTION[1], NORTH_BAND.start, RECEPTION[2], NORTH_BAND.stop - 1),
        (FOCUS[0], FOCUS[1], NORTH_BAND.start, FOCUS[2], NORTH_BAND.stop - 1),
        ('Desks', FIRST_COL, DESK_BAND.start, LAST_COL, DESK_BAND.stop - 1),
        ('Meeting Wing', FIRST_COL, CORRIDOR.start, LAST_COL, CORRIDOR.stop - 1),
    ]
    out += [(name, first, WING.start, last, WING.stop - 1) for name, first, last, _ in MEETING_ROOMS]
    meeting = {name for name, _, _, _ in MEETING_ROOMS}
    zones = []
    for name, c0, r0, c1, r1 in out:
        zone = {
            'name': name,
            'type': 'zone',
            'x': c0 * TILE,
            'y': r0 * TILE,
            'width': (c1 - c0 + 1) * TILE,
            'height': (r1 - r0 + 1) * TILE,
        }
        if name in meeting:
            zone['properties'] = [{'name': 'meeting', 'type': 'bool', 'value': True}]
        zones.append(zone)
    return zones


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
    # The tilesets are carried over from the map itself: they are embedded in
    # it (the app does not load external ones) and Tiled is where they were
    # embedded, so this is the only place they live.
    source = json.loads(TARGET.read_text(encoding='utf-8'))
    tilesets = [dict(ts) for ts in source['tilesets']]
    sheets_from(source)
    chiron = next(ts for ts in tilesets if ts['name'] == CHIRON_TILESET)

    walls = build_walls()
    decor, solid, seat_objects = furniture(chiron['firstgid'])
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
            clean.setdefault('type', '')
            next_id += 1
            out.append(clean)
        return out

    doors = [
        {
            'name': 'Door to Chiron',
            'type': 'door',
            'x': DOOR_TILE[0] * TILE,
            'y': DOOR_TILE[1] * TILE,
            'width': TILE,
            'height': TILE,
            'properties': [
                {'name': 'world', 'type': 'string', 'value': 'chiron-office'},
                {'name': 'spawn', 'type': 'string', 'value': 'from-first-office'},
            ],
        }
    ]
    spawns = [
        {
            'name': 'spawn',
            'type': 'spawn',
            'point': True,
            'x': ENTRY_TILE[0] * TILE + TILE / 2,
            'y': ENTRY_TILE[1] * TILE + TILE / 2,
            'width': 0,
            'height': 0,
            'properties': [{'name': 'radius', 'type': 'int', 'value': 48}],
        },
        {
            'name': 'from-chiron',
            'type': 'spawn',
            'point': True,
            'x': ARRIVAL_TILE[0] * TILE + TILE / 2,
            'y': ARRIVAL_TILE[1] * TILE + TILE / 2,
            'width': 0,
            'height': 0,
            # You arrive looking into the lobby, with your back to the opening.
            'properties': [
                {'name': 'radius', 'type': 'int', 'value': 8},
                {'name': 'dir', 'type': 'string', 'value': 'down'},
            ],
        },
    ]

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
        'nextlayerid': 8,
        'nextobjectid': next_id,
        'properties': [{'name': 'name', 'type': 'string', 'value': 'First Office'}],
        'tilesets': tilesets,
        'layers': [
            tile_layer(1, 'Floor', build_floor(walls)),
            tile_layer(2, 'Walls', walls),
            object_layer(3, 'Furniture', numbered(decor), collides=False),
            object_layer(4, 'FurnitureCollision', numbered(solid), collides=True),
            object_layer(5, 'Zones', numbered(zones()), collides=None),
            object_layer(6, 'Seats', numbered(seat_objects), collides=None),
            object_layer(7, 'Doors', numbered(doors), collides=None),
            object_layer(8, 'Spawn', numbered(spawns), collides=None),
        ],
    }


def main() -> None:
    # A single line, the way Tiled saves it: map diffs then read as what
    # changed, not as reformatting.
    TARGET.write_text(
        json.dumps(build(), ensure_ascii=False, separators=(',', ':')), encoding='utf-8'
    )
    print(f'wrote {TARGET.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
