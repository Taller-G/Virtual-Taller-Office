"""
The tile vocabulary of the Chiron Office: which tiles the dark tileset has,
where each one comes from and how it is tinted.

Shared by `make-chiron-tileset.py` (which draws the PNG) and
`make-chiron-map.py` (which builds the map naming tiles, not bare gids). If the
order of `TILES` changes, both scripts have to be re-run together; running only
one leaves the map pointing at the wrong tiles.

Why a tileset of our own: `FloorAndGround` (LimeZu Modern Interiors) is a bright
pack — of its 1482 full tiles only 6 have a luminance below 80. There is nothing
in it to paint a dark office with. So instead of covering the world with a veil
(`ambient`), floors and walls are generated **already dark**, by taking the very
tiles the First Office is built from — that is, the same wall geometry we know
fits together — and running them through a cold duotone. LimeZu's licence allows
editing the assets (see `docs/asset-licenses.md`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TILESETS = ROOT / 'apps/client/public/assets/tilesets'
SOURCE_SHEET = TILESETS / 'FloorAndGround.png'
TARGET_SHEET = TILESETS / 'ChironDark.png'

#: Name of the tileset inside the Tiled map (and texture key in Phaser).
TILESET_NAME = 'ChironDark'
#: Path to the image, relative to the map file (the way Tiled writes it).
TILESET_IMAGE = '../tilesets/ChironDark.png'

TILE = 32
#: Columns of the generated sheet. Only affects how the PNG looks in Tiled.
SHEET_COLUMNS = 8

# ---------------------------------------------------------------------------
# Palettes
# ---------------------------------------------------------------------------

#: Base duotone: from the shadow (night blue) to the highlight (cold steel).
#: Everything structural uses it, and that is why the whole office reads as a
#: single place.
SLATE = ((7, 10, 20), (96, 116, 144))
#: Violet accent for the rug in The Pit: the one spot of colour in the map, so
#: the lounge is not yet another grey rectangle.
VIOLET = ((13, 10, 28), (118, 86, 168))
#: Green-cyan accent for the technical grating in the Archive and the focus desks.
CYAN = ((6, 14, 18), (78, 132, 140))
#: Walls. A shorter ramp than `SLATE`: the pack paints them white, and with the
#: long ramp they come out mid-grey and wash the whole office out.
WALL = ((5, 8, 16), (64, 78, 98))
#: The gallery floor: one step above the general floor, so the east-west axis
#: reads without needing a wall.
HALL = ((7, 10, 20), (58, 72, 92))
#: Walls seen edge-on (the side walls and the stubs). In the pack they are a
#: solid white strip; with the wall palette they become bright slabs that eat
#: all the attention in a dark map.
EDGE = ((4, 6, 12), (42, 52, 68))

#: Colour of the hand-drawn lights (light pools and strips).
LIGHT_WARM = (255, 228, 176)
LIGHT_COLD = (150, 214, 255)


@dataclass(frozen=True)
class DarkTile:
    """One tile of the dark tileset."""

    name: str
    #: gid in `FloorAndGround` of the tile being tinted; `None` if hand-drawn.
    source: int | None = None
    #: Duotone palette (shadow, highlight).
    palette: tuple[tuple[int, int, int], tuple[int, int, int]] = SLATE
    #: Whether it blocks the way. Written as the tileset's `collides` property.
    collides: bool = False
    #: For hand-drawn tiles: which drawing (see `make-chiron-tileset.py`).
    draw: str | None = None
    #: Arguments for the drawing.
    args: dict = field(default_factory=dict)


# Walls. These are the same tiles the First Office is built from, so corners,
# caps and shadows fit together exactly as they do over there; only the colour
# changes. All of them block the way.
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
    # Interior partitions: the horizontal one brings its own skirting, the
    # vertical one is solid.
    DarkTile('stub_h', 994, palette=WALL, collides=True),
    DarkTile('stub_h_l', 993, palette=WALL, collides=True),
    DarkTile('stub_h_r', 995, palette=WALL, collides=True),
    DarkTile('stub_v', 92, palette=EDGE, collides=True),
]

# Floors and surfaces. None of them block.
FLOORS = [
    # Shadow band at the foot of the north wall: walkable, but the wall reads
    # as standing on something.
    DarkTile('shadow_l', 603),
    DarkTile('shadow', 604),
    # The office's general floor.
    DarkTile('floor_l', 667),
    DarkTile('floor', 668),
    # The gallery's own floor, a shade apart so the axis reads on its own.
    DarkTile('hall', 412, palette=HALL),
    # Technical grating (Archive and focus desks).
    DarkTile('grate_a', 1802, palette=CYAN),
    DarkTile('grate_b', 1803, palette=CYAN),
    DarkTile('grate_c', 1866, palette=CYAN),
    DarkTile('grate_d', 1867, palette=CYAN),
    # The rug in The Pit (a 3×2 motif that repeats).
    DarkTile('rug_a', 1290, palette=VIOLET),
    DarkTile('rug_b', 1291, palette=VIOLET),
    DarkTile('rug_c', 1292, palette=VIOLET),
    DarkTile('rug_d', 1354, palette=VIOLET),
    DarkTile('rug_e', 1355, palette=VIOLET),
    DarkTile('rug_f', 1356, palette=VIOLET),
]

# Lights. Hand-drawn, with transparency, and they live in a layer of their own
# above the floor: they are the only brightness in this world.
LIGHTS = [
    DarkTile('pool_tl', draw='pool', args={'quad': 'tl'}),
    DarkTile('pool_tr', draw='pool', args={'quad': 'tr'}),
    DarkTile('pool_bl', draw='pool', args={'quad': 'bl'}),
    DarkTile('pool_br', draw='pool', args={'quad': 'br'}),
    DarkTile('spot', draw='spot'),
    DarkTile('spot_cold', draw='spot', args={'color': LIGHT_COLD, 'peak': 70}),
    # Cold LED strip at the foot of the wall, and its glow on the floor.
    DarkTile('led', draw='led'),
    DarkTile('led_glow', draw='led_glow'),
]

# The door between worlds. These are the only tiles the First Office map takes
# from this tileset: over there the dark opening cut into the bright wall is
# what makes it obvious that you leave through it, and here it is the same
# opening seen from the inside.
PORTAL = [
    DarkTile('portal_top', draw='portal', args={'half': 'top'}),
    DarkTile('portal_bottom', draw='portal', args={'half': 'bottom'}),
    # The same opening in a wall seen edge-on (Chiron's south wall is a single
    # row): the light spills upwards, into the room.
    DarkTile('portal_edge', draw='portal', args={'half': 'edge'}),
    # Light spilling from the opening onto the floor: goes in the lights layer,
    # on the tile the traveller steps on.
    DarkTile('threshold', draw='threshold'),
]

# The world's name, spelled out in light on the wall of the arrival hall: one
# glowing letter per tile. This is the Chiron mark — what tells you at a glance
# which of the two offices you are standing in. Drawn as decorative furniture
# over the north wall, the only wall this art style shows face-on.
MARK = [
    DarkTile(f'mark_{glyph.lower()}', draw='letter', args={'glyph': glyph})
    for glyph in 'CHIRON'
]

# Signposting painted on the floor: chevrons that point the way out of the
# arrival hall, so nobody has to wander to find the desks or the door back.
SIGNS = [
    DarkTile('arrow_e', draw='arrow', args={'facing': 'e'}),
    DarkTile('arrow_n', draw='arrow', args={'facing': 'n'}),
]

# New tiles are appended: the sheet's order *is* the map's gid order, so
# inserting in the middle would silently move every tile after it (and the
# First Office embeds this tileset too, for the doorway).
TILES: list[DarkTile] = WALLS + FLOORS + LIGHTS + PORTAL + MARK + SIGNS

#: Index (0-based) of each tile within the sheet, by name.
INDEX = {tile.name: i for i, tile in enumerate(TILES)}

SHEET_ROWS = (len(TILES) + SHEET_COLUMNS - 1) // SHEET_COLUMNS


def collides_tiles() -> list[int]:
    """Indices of the tiles that block the way."""
    return [i for i, tile in enumerate(TILES) if tile.collides]
