#!/usr/bin/env python3
"""
Genera el mapa del mundo "Chiron Office": una oficina oscura, apaisada y de
planta abierta, conectada con la First Office por una puerta.

Uso:  python3 tools/make-chiron-tileset.py   # primero el tileset
      python3 tools/make-chiron-map.py       # después el mapa

Solo desarrollo: el resultado se versiona en
`apps/client/public/assets/map/chiron-office.json` y después se edita en Tiled
como cualquier otro mapa (ver `docs/mapa.md`). Este script existe para poder
rehacerlo desde cero de forma reproducible.

El plano, a propósito, no se parece al de la First Office. Allá hay salas
cerradas colgadas de un pasillo vertical, en un lienzo cuadrado; acá hay un
lienzo apaisado con una **galería** este-oeste que cruza todo el mundo y
alcobas abiertas que dan a ella, separadas por tabiques cortos y columnas. No
hay puertas interiores: desde la galería se ve el mundo entero.

Los pisos y las paredes salen de `ChironDark.png` (ver
`tools/make-chiron-tileset.py`): están oscuros en el tile, no por un velo. Los
muebles sí se toman de los mismos packs que la First Office —son los mismos
assets— pero armados en un plano nuevo; las piezas se copian de allá por
rectángulo para no volver a resolver cómo encastra un escritorio.
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
SOURCE = MAPS / 'oficina-taller.json'
TARGET = MAPS / 'chiron-office.json'

WIDTH, HEIGHT = 34, 24

# --- El plano -------------------------------------------------------------
# Filas del muro norte (0 el remate, 1 el cuerpo) y de la franja de sombra a
# su pie (2), que ya se camina. La última fila transitable es la 21 y el muro
# sur es la 22.
FIRST_ROW = 2
FIRST_COL, LAST_COL = 1, WIDTH - 2
BOTTOM_WALL = HEIGHT - 2

#: La galería: el eje este-oeste del mundo, siempre despejado.
HALL_ROWS = range(11, 15)

#: Tabiques entre alcobas. Cortos a propósito: dejan pasar por atrás y hacen
#: que el lugar se lea como un galpón, no como una fila de oficinas.
STUBS_NORTH = [(11, range(2, 9)), (22, range(2, 9))]
STUBS_SOUTH = [(12, range(17, 22)), (21, range(17, 22))]
#: Columnas sueltas que enmarcan la galería.
PILLARS = [(6, 11), (6, 14), (17, 11), (17, 14), (28, 11), (28, 14)]

#: Zonas: nombre y rectángulo en tiles (col0, row0, col1, row1), inclusive.
ZONES = [
    ('Vestíbulo', 1, 2, 10, 10),
    ('Los Monitores', 12, 2, 21, 10),
    ('Archivo', 23, 2, 32, 10),
    ('Galería', 1, 11, 32, 14),
    ('El Pozo', 1, 15, 11, 21),
    ('Sala de mando', 13, 15, 20, 21),
    ('Café nocturno', 22, 15, 32, 21),
]

# La puerta va en el muro norte, el único que se ve de frente: los otros tres
# son una línea fina (se ven de canto) y un vano recortado ahí no se leería.
#: Puerta de vuelta a la First Office, contra el muro norte del Vestíbulo.
DOOR_TILE = (5, 2)
#: Se llega acá desde la First Office: dos tiles adentro, de espaldas al vano.
ARRIVAL_TILE = (5, 4)
#: Entrada al mundo para quien abre la app directamente en Chiron.
ENTRY_TILE = (5, 7)

#: Color ambiente (#AARRGGBB). Bajo a propósito: los pisos y las paredes ya
#: son oscuros, así que el velo solo tiene que apagar los muebles, que vienen
#: de packs claros. Subirlo apaga también a los avatares.
AMBIENT = '#4d080d1a'


# ---------------------------------------------------------------------------
# Capas de tiles
# ---------------------------------------------------------------------------


class TileGrid:
    """Una capa de tiles que se escribe por nombre de tile, no por gid."""

    def __init__(self, firstgid: int) -> None:
        self.data = [0] * (WIDTH * HEIGHT)
        self.firstgid = firstgid

    def put(self, col: int, row: int, name: str) -> None:
        if not (0 <= col < WIDTH and 0 <= row < HEIGHT):
            raise IndexError(f'({col},{row}) cae fuera del mapa')
        self.data[row * WIDTH + col] = self.firstgid + INDEX[name]

    def fill(self, cols: range, rows: range, name: str) -> None:
        for row in rows:
            for col in cols:
                self.put(col, row, name)

    def motif(self, cols: range, rows: range, names: list[list[str]]) -> None:
        """Repite un motivo (por ejemplo la alfombra de 3×2) sobre un rectángulo."""
        for j, row in enumerate(rows):
            for i, col in enumerate(cols):
                self.put(col, row, names[j % len(names)][i % len(names[0])])


def build_walls(firstgid: int) -> list[int]:
    walls = TileGrid(firstgid)
    inner = range(FIRST_COL, LAST_COL + 1)

    # Muro norte: remate y cuerpo.
    walls.put(0, 0, 'wall_tl')
    walls.put(WIDTH - 1, 0, 'wall_tr')
    walls.fill(inner, range(0, 1), 'wall_top')
    walls.put(0, 1, 'wall_left')
    walls.put(WIDTH - 1, 1, 'wall_right')
    walls.fill(inner, range(1, 2), 'wall_body')

    # Muros este y oeste.
    for row in range(FIRST_ROW, BOTTOM_WALL):
        walls.put(0, row, 'wall_left')
        walls.put(WIDTH - 1, row, 'wall_right')

    # Muro sur.
    walls.put(0, BOTTOM_WALL, 'wall_bl')
    walls.put(WIDTH - 1, BOTTOM_WALL, 'wall_br')
    walls.fill(inner, range(BOTTOM_WALL, BOTTOM_WALL + 1), 'wall_bottom')

    # Tabiques y columnas.
    for col, rows in STUBS_NORTH + STUBS_SOUTH:
        for row in rows:
            walls.put(col, row, 'stub_v')
    for col, row in PILLARS:
        walls.put(col, row, 'stub_v')
    return walls.data


def build_floor(firstgid: int) -> list[int]:
    floor = TileGrid(firstgid)
    inner = range(FIRST_COL, LAST_COL + 1)

    # Franja de sombra al pie del muro norte, y después el piso general.
    floor.put(FIRST_COL, FIRST_ROW, 'shadow_l')
    floor.fill(range(FIRST_COL + 1, LAST_COL + 1), range(FIRST_ROW, FIRST_ROW + 1), 'shadow')
    for row in range(FIRST_ROW + 1, BOTTOM_WALL):
        floor.put(FIRST_COL, row, 'floor_l')
        floor.fill(range(FIRST_COL + 1, LAST_COL + 1), range(row, row + 1), 'floor')

    # La galería, un tono aparte: el eje se lee sin necesidad de una pared.
    floor.fill(inner, HALL_ROWS, 'hall')

    # Rejilla técnica del Archivo y de Los Monitores.
    grate = [['grate_a', 'grate_b'], ['grate_c', 'grate_d']]
    floor.motif(range(23, 33), range(3, 10), grate)
    floor.motif(range(12, 22), range(8, 11), grate)

    # Alfombra del Pozo.
    rug = [['rug_a', 'rug_b', 'rug_c'], ['rug_d', 'rug_e', 'rug_f']]
    floor.motif(range(2, 8), range(17, 21), rug)
    return floor.data


def build_lights(firstgid: int) -> list[int]:
    """
    Capa de luces: va encima del piso y debajo de todo lo demás. Es la única
    claridad del mundo, así que también es lo que guía por dónde se camina.
    """
    lights = TileGrid(firstgid)

    # Tira LED al pie del muro norte, de punta a punta.
    lights.fill(range(FIRST_COL, LAST_COL + 1), range(FIRST_ROW, FIRST_ROW + 1), 'led')
    lights.fill(range(FIRST_COL, LAST_COL + 1), range(FIRST_ROW + 1, FIRST_ROW + 2), 'led_glow')

    # Charcos de luz cenital (2×2) sobre lo que importa de cada alcoba.
    def pool(col: int, row: int) -> None:
        lights.put(col, row, 'pool_tl')
        lights.put(col + 1, row, 'pool_tr')
        lights.put(col, row + 1, 'pool_bl')
        lights.put(col + 1, row + 1, 'pool_br')

    for col, row in [(4, 3), (13, 4), (16, 4), (19, 4), (5, 18), (15, 17), (26, 17)]:
        pool(col, row)

    # Luminarias sueltas: cálidas sobre la galería, frías sobre el Archivo.
    for col in (4, 10, 16, 22, 28):
        lights.put(col, 12, 'spot')
    for col, row in [(25, 6), (29, 6), (24, 9), (30, 9)]:
        lights.put(col, row, 'spot_cold')

    # Umbral de la puerta de vuelta: la luz que entra del otro mundo.
    lights.put(DOOR_TILE[0], DOOR_TILE[1], 'threshold')
    return lights.data


# ---------------------------------------------------------------------------
# Muebles
# ---------------------------------------------------------------------------


def piece(source: dict, col0: int, row0: int, cols: int, rows: int) -> list[dict]:
    """
    Copia una pieza de mobiliario de la First Office: todos los objetos-tile
    cuyo ancla cae en el rectángulo (en tiles), con sus posiciones relativas a
    (col0, row0). Así se reusa un escritorio o un mostrador ya resuelto sin
    volver a apilar a mano las capas de sprites que lo forman.

    Se saltean los objetos de `FloorAndGround`: son la decoración de las
    paredes de allá (la franja blanca del zócalo) y no tienen sentido acá.
    """
    x0, y0 = col0 * TILE, row0 * TILE
    x1, y1 = (col0 + cols) * TILE, (row0 + rows) * TILE
    out: list[dict] = []
    for layer in source['layers']:
        if layer['type'] != 'objectgroup' or layer['name'] not in ('Muebles', 'MueblesColision'):
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
            moved['_solid'] = layer['name'] == 'MueblesColision'
            out.append(moved)
    if not out:
        raise ValueError(f'la pieza en ({col0},{row0}) {cols}×{rows} no tiene objetos')
    return out


def place(objects: list[dict], col: int, row: int) -> list[dict]:
    """La pieza, trasladada a (col, row) de la Chiron Office."""
    out = []
    for obj in objects:
        moved = dict(obj)
        moved['x'] = obj['x'] + col * TILE
        moved['y'] = obj['y'] + row * TILE
        out.append(moved)
    return out


def block(col: int, row: int, grid: list[list[int]], solid: bool = False) -> list[dict]:
    """
    Un mueble descrito como una grilla de gid, con su esquina superior
    izquierda en (col, row). Un 0 deja el tile vacío.
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


# Muebles de los packs que ya usa la First Office (gid absolutos: los
# tilesets son los mismos y arrancan en los mismos firstgid).
TV_OSCURA = [[5180, 5181], [5196, 5197]]  # pantalla apagada, de pared
PANTALLA = [[5178, 5179], [5196, 5197]]  # pantalla encendida, de pared
SOFA = [[4691, 4692, 4693], [4707, 4708, 4709]]
BANCO = [[4823, 4824, 4825], [4839, 4840, 4841]]
MESA_BAJA = [[4801, 4802], [4817, 4818]]
SILLON_FRIO = [[5223], [5239]]
SILLON_CALIDO = [[5224], [5240]]
POOL = [[5140, 5141, 5142, 5143], [5156, 5157, 5158, 5159], [5172, 5173, 5174, 5175]]
ARMARIO = [[4772, 4773, 4774], [4788, 4789, 4790], [4804, 4805, 4806]]
ARMARIO_2 = [[4776, 4777, 4778], [4792, 4793, 4794], [4808, 4809, 4810]]
MESADA = [[4536, 4537], [4563, 4564]]  # bajomesada con bacha y microondas
EXPENDEDORAS = [[5360, 5361], [5376, 5377]]
MESA_CAFE = [[4919, 4920, 4921], [4935, 4936, 4937]]
BANQUETA_ROJA = [[5099], [5115]]
BANQUETA_AZUL = [[5100], [5116]]


def furniture(source: dict, firstgid: int) -> tuple[list[dict], list[dict]]:
    """Todos los muebles del mundo; devuelve (decorativos, sólidos)."""
    objects: list[dict] = []

    # Piezas reusadas de la First Office: los mismos assets, ya armados allá.
    mesa_larga = piece(source, 8, 19, 9, 5)  # mesa de reunión con sus sillas
    escritorio = piece(source, 25, 14, 3, 5)  # escritorio con PC y silla

    # --- Vestíbulo: el vano en el muro norte y el medio despejado, que es
    # donde aparece la gente.
    objects += portal(DOOR_TILE[0], 0, firstgid)
    objects += block(8, 1, PANTALLA)
    objects += block(2, 6, SILLON_FRIO)
    objects += block(8, 6, SILLON_CALIDO)
    objects += block(4, 8, BANCO, solid=True)
    objects += planta(1, 3)
    objects += planta(9, 3)

    # --- Los Monitores: tres puestos en fila bajo un muro de pantallas.
    for col in (12, 15, 18):
        objects += place(escritorio, col, 4)
        objects += block(col, 1, TV_OSCURA)
    objects += planta(21, 7)

    # --- Archivo: armarios contra el muro y dos islas con pasillo en el medio.
    for col in (23, 26, 29):
        objects += shelf(col, 1, ARMARIO)
    for col in (24, 28):
        objects += block(col, 6, ARMARIO_2, solid=True)

    # --- El Pozo: el estar, sobre la alfombra, con la mesa de pool al este.
    objects += block(2, 16, SOFA, solid=True)
    objects += block(5, 18, MESA_BAJA, solid=True)
    objects += block(1, 19, SILLON_FRIO)
    objects += block(8, 16, SILLON_CALIDO)
    objects += block(7, 18, POOL, solid=True)

    # --- Sala de mando: la mesa larga, de cara a la galería.
    objects += place(mesa_larga, 12, 16)
    objects += planta(13, 20)
    objects += planta(20, 20)

    # --- Galería: bancos y plantas entre las columnas, para que el eje no sea
    # un pasillo vacío de 32 tiles.
    for col in (9, 20, 31):
        objects += planta(col, 12)
    for col in (3, 13, 24):
        objects += block(col, 12, BANCO, solid=True)

    # --- Café nocturno: la barra contra el este y una mesa con banquetas.
    objects += block(23, 16, MESADA, solid=True)
    objects += block(25, 16, MESADA, solid=True)
    objects += block(28, 16, EXPENDEDORAS, solid=True)
    objects += block(23, 19, BANQUETA_ROJA)
    objects += block(25, 19, BANQUETA_AZUL)
    objects += block(27, 19, MESA_CAFE, solid=True)
    objects += block(26, 19, BANQUETA_AZUL)
    objects += block(30, 19, BANQUETA_ROJA)
    objects += planta(32, 16)

    decor = [o for o in objects if not o['_solid']]
    solid = [o for o in objects if o['_solid']]
    return decor, solid


def portal(col: int, row: int, firstgid: int) -> list[dict]:
    """
    El vano de la puerta entre mundos, dibujado como mueble decorativo sobre
    el muro (que ya bloquea el paso). No es la puerta: esa es el rectángulo de
    clase `door`, que va en el piso, justo delante del vano.
    """
    return block(col, row, [[firstgid + INDEX['portal_top']], [firstgid + INDEX['portal_bottom']]])


def planta(col: int, row: int) -> list[dict]:
    """
    Una planta alta: se dibuja en dos tiles y bloquea solo el de abajo, así se
    puede pasar por detrás. Mismo mueble que usa la First Office.
    """
    return block(col, row, [[2782], [2798]]) + block(col, row + 2, [[2814]], solid=True)


def shelf(col: int, row: int, grid: list[list[int]]) -> list[dict]:
    """
    Un armario alto: el cuerpo se dibuja pero no bloquea (los avatares pasan
    por delante y por detrás) y solo su base corta el paso, como en la First
    Office. Si bloqueara entero, tres filas de tiles quedarían muertas.
    """
    body = block(col, row, grid[:-1])
    base = block(col, row + len(grid) - 1, [grid[-1]], solid=True)
    return body + base


# ---------------------------------------------------------------------------
# Armado del archivo
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
        # La colisión de las paredes viaja en el tileset, no en el mapa: así
        # toda pared que se pinte en Tiled bloquea sola (ver `docs/mapa.md`).
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
                'name': 'Puerta a la First Office',
                'type': 'door',
                'x': DOOR_TILE[0] * TILE,
                'y': DOOR_TILE[1] * TILE,
                'width': TILE,
                'height': TILE,
                'properties': [
                    {'name': 'world', 'type': 'string', 'value': 'first-office'},
                    {'name': 'spawn', 'type': 'string', 'value': 'desde-chiron'},
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
                'name': 'desde-first-office',
                'type': 'spawn',
                'point': True,
                'x': ARRIVAL_TILE[0] * TILE + TILE / 2,
                'y': ARRIVAL_TILE[1] * TILE + TILE / 2,
                'width': 0,
                'height': 0,
                # Se llega mirando hacia adentro, de espaldas al vano (que
                # está en el muro norte, dos tiles más arriba).
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
            tile_layer(1, 'Piso', build_floor(firstgid)),
            tile_layer(2, 'Luces', build_lights(firstgid)),
            tile_layer(3, 'Paredes', build_walls(firstgid)),
            object_layer(4, 'Muebles', decor, collides=False),
            object_layer(5, 'MueblesColision', solid, collides=True),
            object_layer(6, 'Zonas', zones, collides=None),
            object_layer(7, 'Puertas', doors, collides=None),
            object_layer(8, 'Spawn', spawns, collides=None),
        ],
    }


def main() -> None:
    if TILES[0].name != 'wall_tl':
        raise SystemExit('el vocabulario de tiles cambió: revisá tools/chiron_tiles.py')
    # Una sola línea, como guarda Tiled y como está la First Office: así los
    # diffs del mapa se leen por lo que cambió, no por el formato.
    TARGET.write_text(
        json.dumps(build(), ensure_ascii=False, separators=(',', ':')), encoding='utf-8'
    )
    print(f'escrito {TARGET.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
