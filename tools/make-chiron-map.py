#!/usr/bin/env python3
"""
Genera el mapa del mundo "Chiron Office": una oficina oscura, más chica que la
First Office, conectada con ella por una puerta.

Solo desarrollo: el resultado se versiona en
`apps/client/public/assets/map/chiron-office.json` y después se edita en Tiled
como cualquier otro mapa (ver `docs/mapa.md`). Este script existe para poder
rehacerlo desde cero de forma reproducible.

Uso:  python3 tools/make-chiron-map.py

Cómo funciona: toma los tilesets embebidos de la First Office (mismas imágenes
y mismos firstgid, así los gid significan lo mismo en los dos mapas), dibuja
una sala rectangular con piso oscuro, copia un par de grupos de muebles de la
First Office y agrega spawn, puerta de vuelta y zona. Lo oscuro no son tiles
nuevos: es la propiedad `ambient` del mapa, que el cliente pinta encima.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAPS = ROOT / 'apps/client/public/assets/map'
SOURCE = MAPS / 'oficina-taller.json'
TARGET = MAPS / 'chiron-office.json'

TILE = 32
WIDTH, HEIGHT = 28, 20

# Tiles de FloorAndGround usados para la sala (gid = id + 1, firstgid 1).
FLOOR = 731  # alfombra oscura, sin colisión
WALL_TOP_LEFT, WALL_TOP, WALL_TOP_RIGHT = 29, 594, 90
WALL_UNDER_TOP = 658  # segunda fila del muro de arriba
WALL_LEFT, WALL_RIGHT = 92, 154
WALL_BOTTOM_LEFT, WALL_BOTTOM, WALL_BOTTOM_RIGHT = 216, 217, 218

# Grupos de muebles que se copian de la First Office, con el desplazamiento
# (en tiles) con el que caen en la sala de Chiron.
CLUSTERS = [
    # La sala de reunión completa (mesa, sillas, pizarra): el corazón del lugar.
    {'rect': (192, 544, 416, 224), 'offset': (1, -10)},
    # Un par de escritorios con computadora contra la pared de arriba.
    {'rect': (928, 480, 320, 128), 'offset': (-22, -11)},
]

# Puerta de vuelta a la First Office y punto de llegada desde ella.
DOOR_TILE = (13, 17)
ARRIVAL_TILE = (13, 15)
ENTRY_TILE = (13, 13)


def load_source() -> dict:
    return json.loads(SOURCE.read_text(encoding='utf-8'))


def build_tiles() -> tuple[list[int], list[int]]:
    """Capa de piso (todo alfombra) y capa de paredes (el marco de la sala)."""
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
    """Muebles de la First Office trasladados a la sala de Chiron."""
    decor: list[dict] = []
    solid: list[dict] = []
    for layer in source['layers']:
        if layer['type'] != 'objectgroup':
            continue
        target = solid if layer['name'] == 'MueblesColision' else decor
        if layer['name'] not in ('Muebles', 'MueblesColision'):
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
        'name': 'Puerta a la First Office',
        'type': 'door',
        'x': door_x,
        'y': door_y,
        'width': TILE,
        'height': TILE,
        'rotation': 0,
        'visible': True,
        'properties': [
            {'name': 'world', 'type': 'string', 'value': 'first-office'},
            {'name': 'spawn', 'type': 'string', 'value': 'desde-chiron'},
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
            'name': 'desde-first-office',
            'type': 'spawn',
            'point': True,
            'x': ARRIVAL_TILE[0] * TILE + TILE / 2,
            'y': ARRIVAL_TILE[1] * TILE + TILE / 2,
            'width': 0,
            'height': 0,
            'rotation': 0,
            'visible': True,
            # Se llega mirando hacia adentro de la sala, de espaldas a la puerta.
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
            # Color ambiente (#AARRGGBB): el cliente lo pinta encima de todo el
            # mundo. Es lo que hace que Chiron se sienta oscura.
            {'name': 'ambient', 'type': 'color', 'value': '#66070a18'},
        ],
        'tilesets': source['tilesets'],
        'layers': [
            {
                'type': 'tilelayer',
                'id': 1,
                'name': 'Piso',
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
                'name': 'Paredes',
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
                'name': 'Muebles',
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
                'name': 'MueblesColision',
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
                'name': 'Zonas',
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
                'name': 'Puertas',
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
    # Una sola línea, como guarda Tiled y como está la First Office: así los
    # diffs del mapa se leen por lo que cambió, no por el formato.
    TARGET.write_text(
        json.dumps(build(), ensure_ascii=False, separators=(',', ':')), encoding='utf-8'
    )
    print(f'escrito {TARGET.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
