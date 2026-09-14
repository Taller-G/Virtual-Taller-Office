#!/usr/bin/env python3
"""
Generates the map of the "Chiron Office" world: a dark office, smaller than the
First Office, connected to it by a door.

Development only: the result is committed in
`apps/client/public/assets/map/chiron-office.json` and is then edited in Tiled
like any other map (see `docs/map.md`). This script exists so it can be remade
from scratch reproducibly.

Usage:  python3 tools/make-chiron-map.py

How it works: it takes the First Office's embedded tilesets (the same images and
the same firstgids, so gids mean the same thing in both maps), draws a
rectangular room with a dark floor, copies a couple of furniture clusters from
the First Office and adds the spawn, the return door and the zone. The darkness
is not new tiles: it is the map's `ambient` property, which the client paints
on top.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAPS = ROOT / 'apps/client/public/assets/map'
SOURCE = MAPS / 'first-office.json'
TARGET = MAPS / 'chiron-office.json'

TILE = 32
WIDTH, HEIGHT = 28, 20

# FloorAndGround tiles used for the room (gid = id + 1, firstgid 1).
FLOOR = 731  # dark carpet, no collision
WALL_TOP_LEFT, WALL_TOP, WALL_TOP_RIGHT = 29, 594, 90
WALL_UNDER_TOP = 658  # second row of the top wall
WALL_LEFT, WALL_RIGHT = 92, 154
WALL_BOTTOM_LEFT, WALL_BOTTOM, WALL_BOTTOM_RIGHT = 216, 217, 218

# Furniture clusters copied from the First Office, with the offset (in tiles)
# at which they land in Chiron's room.
CLUSTERS = [
    # The whole meeting room (table, chairs, whiteboard): the heart of the place.
    {'rect': (192, 544, 416, 224), 'offset': (1, -10)},
    # A couple of desks with computers against the top wall.
    {'rect': (928, 480, 320, 128), 'offset': (-22, -11)},
]

# Return door to the First Office and the arrival point coming from it.
DOOR_TILE = (13, 17)
ARRIVAL_TILE = (13, 15)
ENTRY_TILE = (13, 13)


def load_source() -> dict:
    return json.loads(SOURCE.read_text(encoding='utf-8'))


def build_tiles() -> tuple[list[int], list[int]]:
    """Floor layer (all carpet) and wall layer (the frame of the room)."""
    floor = [0] * (WIDTH * HEIGHT)
    walls = [0] * (WIDTH * HEIGHT)

    def put(layer: list[int], col: int, row: int, gid: int) -> None:
        layer[row * WIDTH + col] = gid

    bottom = HEIGHT - 2
    for row in range(2, bottom):
        for col in range(1, WIDTH - 1):
            put(floor, col, row, FLOOR)

    for col in range(1, WIDTH - 1):
        put(walls, col, 0, WALL_TOP)
        put(walls, col, 1, WALL_UNDER_TOP)
        put(walls, col, bottom, WALL_BOTTOM)
    for row in range(2, bottom):
        put(walls, 0, row, WALL_LEFT)
        put(walls, WIDTH - 1, row, WALL_RIGHT)
    put(walls, 0, 0, WALL_TOP_LEFT)
    put(walls, WIDTH - 1, 0, WALL_TOP_RIGHT)
    put(walls, 0, 1, WALL_LEFT)
    put(walls, WIDTH - 1, 1, WALL_RIGHT)
    put(walls, 0, bottom, WALL_BOTTOM_LEFT)
    put(walls, WIDTH - 1, bottom, WALL_BOTTOM_RIGHT)
    return floor, walls


def copy_objects(source: dict) -> tuple[list[dict], list[dict]]:
    """Furniture from the First Office moved into Chiron's room."""
    decor: list[dict] = []
    solid: list[dict] = []
    for layer in source['layers']:
        if layer['type'] != 'objectgroup':
            continue
        target = solid if layer['name'] == 'FurnitureCollision' else decor
        if layer['name'] not in ('Furniture', 'FurnitureCollision'):
            continue
        for obj in layer['objects']:
            if not obj.get('gid'):
                continue
            for cluster in CLUSTERS:
                x, y, w, h = cluster['rect']
                if not (x <= obj['x'] < x + w and y < obj['y'] <= y + h):
                    continue
                dx, dy = cluster['offset']
                moved = dict(obj)
                moved['x'] = obj['x'] + dx * TILE
                moved['y'] = obj['y'] + dy * TILE
                target.append(moved)
                break
    return decor, solid


def build() -> dict:
    source = load_source()
    floor, walls = build_tiles()
    decor, solid = copy_objects(source)

    next_id = 1

    def renumber(objects: list[dict]) -> list[dict]:
        nonlocal next_id
        for obj in objects:
            obj['id'] = next_id
            next_id += 1
        return objects

    decor = renumber(decor)
    solid = renumber(solid)

    door_x, door_y = DOOR_TILE[0] * TILE, DOOR_TILE[1] * TILE
    door = {
        'id': next_id,
        'name': 'Door to the First Office',
        'type': 'door',
        'x': door_x,
        'y': door_y,
        'width': TILE,
        'height': TILE,
        'rotation': 0,
        'visible': True,
        'properties': [
            {'name': 'world', 'type': 'string', 'value': 'first-office'},
            {'name': 'spawn', 'type': 'string', 'value': 'from-chiron'},
        ],
    }
    next_id += 1

    spawns = [
        {
            'id': next_id,
            'name': 'spawn',
            'type': 'spawn',
            'point': True,
            'x': ENTRY_TILE[0] * TILE + TILE / 2,
            'y': ENTRY_TILE[1] * TILE + TILE / 2,
            'width': 0,
            'height': 0,
            'rotation': 0,
            'visible': True,
            'properties': [{'name': 'radius', 'type': 'int', 'value': 32}],
        },
        {
            'id': next_id + 1,
            'name': 'from-first-office',
            'type': 'spawn',
            'point': True,
            'x': ARRIVAL_TILE[0] * TILE + TILE / 2,
            'y': ARRIVAL_TILE[1] * TILE + TILE / 2,
            'width': 0,
            'height': 0,
            'rotation': 0,
            'visible': True,
            # You arrive facing into the room, with your back to the door.
            'properties': [
                {'name': 'radius', 'type': 'int', 'value': 8},
                {'name': 'dir', 'type': 'string', 'value': 'up'},
            ],
        },
    ]
    next_id += 2

    zone = {
        'id': next_id,
        'name': 'Chiron',
        'type': 'zone',
        'x': TILE,
        'y': 2 * TILE,
        'width': (WIDTH - 2) * TILE,
        'height': (HEIGHT - 4) * TILE,
        'rotation': 0,
        'visible': True,
    }
    next_id += 1

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
        'backgroundcolor': '#070a12',
        'nextlayerid': 8,
        'nextobjectid': next_id,
        'properties': [
            {'name': 'name', 'type': 'string', 'value': 'Chiron Office'},
            # Ambient colour (#AARRGGBB): the client paints it over the whole
            # world. It is what makes Chiron feel dark.
            {'name': 'ambient', 'type': 'color', 'value': '#66070a18'},
        ],
        'tilesets': source['tilesets'],
        'layers': [
            {
                'type': 'tilelayer',
                'id': 1,
                'name': 'Floor',
                'x': 0,
                'y': 0,
                'width': WIDTH,
                'height': HEIGHT,
                'opacity': 1,
                'visible': True,
                'data': floor,
            },
            {
                'type': 'tilelayer',
                'id': 2,
                'name': 'Walls',
                'x': 0,
                'y': 0,
                'width': WIDTH,
                'height': HEIGHT,
                'opacity': 1,
                'visible': True,
                'data': walls,
            },
            {
                'type': 'objectgroup',
                'id': 3,
                'name': 'Furniture',
                'draworder': 'topdown',
                'opacity': 1,
                'visible': True,
                'x': 0,
                'y': 0,
                'objects': decor,
                'properties': [{'name': 'collides', 'type': 'bool', 'value': False}],
            },
            {
                'type': 'objectgroup',
                'id': 4,
                'name': 'FurnitureCollision',
                'draworder': 'topdown',
                'opacity': 1,
                'visible': True,
                'x': 0,
                'y': 0,
                'objects': solid,
                'properties': [{'name': 'collides', 'type': 'bool', 'value': True}],
            },
            {
                'type': 'objectgroup',
                'id': 5,
                'name': 'Zones',
                'draworder': 'topdown',
                'opacity': 1,
                'visible': True,
                'x': 0,
                'y': 0,
                'objects': [zone],
            },
            {
                'type': 'objectgroup',
                'id': 6,
                'name': 'Doors',
                'draworder': 'topdown',
                'opacity': 1,
                'visible': True,
                'x': 0,
                'y': 0,
                'objects': [door],
            },
            {
                'type': 'objectgroup',
                'id': 7,
                'name': 'Spawn',
                'draworder': 'topdown',
                'opacity': 1,
                'visible': True,
                'x': 0,
                'y': 0,
                'objects': spawns,
            },
        ],
    }


def main() -> None:
    # A single line, the way Tiled saves it and the way the First Office is:
    # that way the map's diffs read by what changed, not by the formatting.
    TARGET.write_text(
        json.dumps(build(), ensure_ascii=False, separators=(',', ':')), encoding='utf-8'
    )
    print(f'written {TARGET.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
