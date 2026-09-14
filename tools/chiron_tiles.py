"""
Vocabulario de tiles de la Chiron Office: qué tiles tiene el tileset oscuro,
de dónde sale cada uno y cómo se lo tiñe.

Lo comparten `make-chiron-tileset.py` (que dibuja el PNG) y
`make-chiron-map.py` (que arma el mapa nombrando los tiles, no gids sueltos).
Si cambia el orden de `TILES`, los dos scripts se rehacen juntos y el mapa
sigue siendo coherente; correr uno solo deja el mapa apuntando a tiles viejos.

Por qué un tileset propio: `FloorAndGround` (LimeZu Modern Interiors) es un
pack claro — de sus 1482 tiles completos solo 6 tienen luminancia por debajo
de 80. No hay con qué pintar una oficina oscura. En vez de tapar el mundo con
un velo (`ambient`), acá se generan pisos y paredes **ya oscuros**, tomando
los mismos tiles que usa la First Office —o sea, la misma geometría de muros,
que ya sabemos que encastra— y pasándolos por un duotono frío. La licencia de
LimeZu permite editar los assets (ver `docs/licencias-assets.md`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TILESETS = ROOT / 'apps/client/public/assets/tilesets'
SOURCE_SHEET = TILESETS / 'FloorAndGround.png'
TARGET_SHEET = TILESETS / 'ChironDark.png'

#: Nombre del tileset dentro del mapa Tiled (y clave de textura en Phaser).
TILESET_NAME = 'ChironDark'
#: Ruta a la imagen, relativa al archivo del mapa (como la escribe Tiled).
TILESET_IMAGE = '../tilesets/ChironDark.png'

TILE = 32
#: Columnas de la hoja generada. Solo afecta cómo se ve el PNG en Tiled.
SHEET_COLUMNS = 8

# ---------------------------------------------------------------------------
# Paletas
# ---------------------------------------------------------------------------

#: Duotono base: de la sombra (azul noche) al brillo (acero frío). Todo lo que
#: es estructura —pisos, paredes, rejillas— usa esta paleta, y por eso la
#: oficina entera se lee como un solo lugar.
SLATE = ((7, 10, 20), (96, 116, 144))
#: Acento violeta para la alfombra del Pozo: el único punto de color cálido-frío
#: del mapa, para que el estar no sea otro rectángulo gris.
VIOLET = ((13, 10, 28), (118, 86, 168))
#: Acento verde-cian para las rejillas técnicas del Archivo y los Monitores.
CYAN = ((6, 14, 18), (78, 132, 140))
#: Paredes. Rampa más corta que `SLATE`: el pack original las tiene blancas y
#: con la rampa larga quedan de un gris medio que aclara toda la oficina.
WALL = ((5, 8, 16), (64, 78, 98))
#: Piso de la galería: un escalón por encima del piso general, para que el eje
#: este-oeste se lea sin necesidad de una pared.
HALL = ((7, 10, 20), (58, 72, 92))
#: Muros vistos de canto (los laterales y los tabiques). En el pack son una
#: franja blanca maciza; con la paleta de las paredes quedan como losas claras
#: que se comen la atención en un mapa oscuro.
EDGE = ((4, 6, 12), (42, 52, 68))

#: Color de las luces que se dibujan a mano (charcos de luz y tiras).
LIGHT_WARM = (255, 228, 176)
LIGHT_COLD = (150, 214, 255)


@dataclass(frozen=True)
class DarkTile:
    """Un tile del tileset oscuro."""

    name: str
    #: gid en `FloorAndGround` del tile que se tiñe; `None` si se dibuja a mano.
    source: int | None = None
    #: Paleta del duotono (sombra, brillo).
    palette: tuple[tuple[int, int, int], tuple[int, int, int]] = SLATE
    #: Si bloquea el paso. Se escribe como propiedad `collides` del tileset.
    collides: bool = False
    #: Para los tiles dibujados a mano: qué dibujo (ver `make-chiron-tileset.py`).
    draw: str | None = None
    #: Parámetros del dibujo.
    args: dict = field(default_factory=dict)


# Paredes. Son los mismos tiles con los que está armada la First Office, así
# que las esquinas, los remates y las sombras encastran igual que allá; lo
# único que cambia es el color. Todos bloquean el paso.
WALLS = [
    DarkTile('wall_tl', 29, palette=WALL, collides=True),
    DarkTile('wall_top', 594, palette=WALL, collides=True),
    DarkTile('wall_tr', 90, palette=WALL, collides=True),
    DarkTile('wall_left', 92, palette=EDGE, collides=True),
    DarkTile('wall_body', 658, palette=WALL, collides=True),
    DarkTile('wall_right', 154, palette=EDGE, collides=True),
    DarkTile('wall_bl', 216, palette=WALL, collides=True),
    DarkTile('wall_bottom', 217, palette=WALL, collides=True),
    DarkTile('wall_br', 218, palette=WALL, collides=True),
    # Tabiques interiores: el horizontal trae su zócalo, el vertical es macizo.
    DarkTile('stub_h', 994, palette=WALL, collides=True),
    DarkTile('stub_h_l', 993, palette=WALL, collides=True),
    DarkTile('stub_h_r', 995, palette=WALL, collides=True),
    DarkTile('stub_v', 92, palette=EDGE, collides=True),
]

# Pisos y superficies. Ninguno bloquea.
FLOORS = [
    # Franja de sombra al pie del muro norte: se camina, pero se ve el apoyo.
    DarkTile('shadow_l', 603),
    DarkTile('shadow', 604),
    # Piso general de la oficina.
    DarkTile('floor_l', 667),
    DarkTile('floor', 668),
    # Piso liso de la galería, un tono aparte para que el eje se lea.
    DarkTile('hall', 412, palette=HALL),
    # Rejilla técnica (Archivo y Monitores).
    DarkTile('grate_a', 1802, palette=CYAN),
    DarkTile('grate_b', 1803, palette=CYAN),
    DarkTile('grate_c', 1866, palette=CYAN),
    DarkTile('grate_d', 1867, palette=CYAN),
    # Alfombra del Pozo (motivo de 3×2 que se repite).
    DarkTile('rug_a', 1290, palette=VIOLET),
    DarkTile('rug_b', 1291, palette=VIOLET),
    DarkTile('rug_c', 1292, palette=VIOLET),
    DarkTile('rug_d', 1354, palette=VIOLET),
    DarkTile('rug_e', 1355, palette=VIOLET),
    DarkTile('rug_f', 1356, palette=VIOLET),
]

# Luces. Se dibujan a mano, con transparencia, y van en una capa propia por
# encima del piso: son la única fuente de claridad del mundo.
LIGHTS = [
    DarkTile('pool_tl', draw='pool', args={'quad': 'tl'}),
    DarkTile('pool_tr', draw='pool', args={'quad': 'tr'}),
    DarkTile('pool_bl', draw='pool', args={'quad': 'bl'}),
    DarkTile('pool_br', draw='pool', args={'quad': 'br'}),
    DarkTile('spot', draw='spot'),
    DarkTile('spot_cold', draw='spot', args={'color': LIGHT_COLD, 'peak': 70}),
    # Tira LED fría al pie de la pared y su resplandor sobre el piso.
    DarkTile('led', draw='led'),
    DarkTile('led_glow', draw='led_glow'),
]

# La puerta entre mundos. Es el único tile que también usa el mapa de la First
# Office: allá el vano oscuro recortado en la pared clara es lo que hace obvio
# que ahí se sale a otro lado, y acá es el mismo vano visto desde adentro.
PORTAL = [
    DarkTile('portal_top', draw='portal', args={'half': 'top'}),
    DarkTile('portal_bottom', draw='portal', args={'half': 'bottom'}),
    # El mismo vano en un muro visto de canto (el muro sur de Chiron mide una
    # fila sola): la luz se derrama hacia arriba, hacia adentro de la sala.
    DarkTile('portal_edge', draw='portal', args={'half': 'edge'}),
    # Luz que se derrama del vano sobre el piso: va en la capa de luces, sobre
    # el tile que pisa quien viaja.
    DarkTile('threshold', draw='threshold'),
]

TILES: list[DarkTile] = WALLS + FLOORS + LIGHTS + PORTAL

#: Índice (0-based) de cada tile dentro de la hoja, por nombre.
INDEX = {tile.name: i for i, tile in enumerate(TILES)}

SHEET_ROWS = (len(TILES) + SHEET_COLUMNS - 1) // SHEET_COLUMNS


def collides_tiles() -> list[int]:
    """Índices de los tiles que bloquean el paso."""
    return [i for i, tile in enumerate(TILES) if tile.collides]
