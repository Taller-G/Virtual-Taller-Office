#!/usr/bin/env python3
"""
Generates `apps/client/public/assets/tilesets/ChironDark.png`: the dark tileset
the Chiron Office is painted with (floors, walls and lights).

Usage:  python3 tools/make-chiron-tileset.py
        python3 tools/make-chiron-map.py      # then, to rebuild the map

What it does: takes from `FloorAndGround.png` the very tiles the First Office is
built from, runs them through a cold duotone (night-blue shadow → steel
highlight) and adds a few hand-drawn light tiles. The result is a small, tidy
sheet meant for a single map; the vocabulary and the palettes live in
`tools/chiron_tiles.py`.

Development only: the PNG is committed, and the map is then edited in Tiled like
any other (see `docs/map.md`).
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

from chiron_tiles import (  # noqa: E402
    LIGHT_COLD,
    LIGHT_WARM,
    SHEET_COLUMNS,
    SHEET_ROWS,
    SOURCE_SHEET,
    TARGET_SHEET,
    TILE,
    TILES,
    DarkTile,
)

#: Columns of `FloorAndGround` (gids are read in that order).
SOURCE_COLUMNS = 64


def source_tile(sheet: Image.Image, gid: int) -> Image.Image:
    """Tile `gid` of FloorAndGround (firstgid 1), as an RGBA image."""
    index = gid - 1
    col, row = index % SOURCE_COLUMNS, index // SOURCE_COLUMNS
    return sheet.crop((col * TILE, row * TILE, (col + 1) * TILE, (row + 1) * TILE))


def duotone(
    tile: Image.Image,
    shadow: tuple[int, int, int],
    light: tuple[int, int, int],
) -> Image.Image:
    """
    Maps the tile onto a two-colour ramp according to its luminance.

    The gamma (1.4) sinks the mid-tones: without it the pack's white walls come
    out mid-grey and the office looks overcast rather than dark. 12% of the
    original colour is kept so the textures do not go completely flat.
    """
    out = Image.new('RGBA', tile.size)
    src = tile.load()
    dst = out.load()
    for y in range(tile.height):
        for x in range(tile.width):
            r, g, b, a = src[x, y]
            if a == 0:
                dst[x, y] = (0, 0, 0, 0)
                continue
            lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
            ramp = lum**1.4
            mixed = tuple(
                round(0.88 * (shadow[i] + (light[i] - shadow[i]) * ramp) + 0.12 * (r, g, b)[i] * ramp)
                for i in range(3)
            )
            dst[x, y] = (*mixed, a)
    return out


# ---------------------------------------------------------------------------
# Light tiles (hand-drawn)
# ---------------------------------------------------------------------------


def falloff(distance: float, radius: float) -> float:
    """A light's soft falloff: 1 at the centre, 0 at the edge."""
    if distance >= radius:
        return 0.0
    t = 1 - distance / radius
    return t * t


def draw_pool(quad: str) -> Image.Image:
    """
    One quarter of a 2×2-tile pool of light. The four quarters together are an
    overhead lamp on the floor; on their own they are no use.
    """
    out = Image.new('RGBA', (TILE, TILE))
    px = out.load()
    # Centre of the whole pool, in this quarter's coordinates.
    cx = TILE if quad in ('tl', 'bl') else 0.0
    cy = TILE if quad in ('tl', 'tr') else 0.0
    for y in range(TILE):
        for x in range(TILE):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            alpha = round(96 * falloff(d, TILE * 1.15))
            if alpha:
                px[x, y] = (*LIGHT_WARM, alpha)
    return out


def draw_spot(color: tuple[int, int, int] = LIGHT_WARM, peak: int = 84) -> Image.Image:
    """A small one-tile pool of light: a floor lamp or a monitor."""
    out = Image.new('RGBA', (TILE, TILE))
    px = out.load()
    for y in range(TILE):
        for x in range(TILE):
            d = math.hypot(x + 0.5 - TILE / 2, y + 0.5 - TILE / 2)
            alpha = round(peak * falloff(d, TILE / 2))
            if alpha:
                px[x, y] = (*color, alpha)
    return out


def draw_led() -> Image.Image:
    """Cold LED strip: sits on the shadow band at the foot of the wall."""
    out = Image.new('RGBA', (TILE, TILE))
    px = out.load()
    for x in range(TILE):
        px[x, 1] = (120, 190, 230, 120)
        px[x, 2] = (196, 236, 255, 235)
        px[x, 3] = (150, 214, 255, 190)
        for y in range(4, 12):
            px[x, y] = (110, 176, 224, round(90 * falloff(y - 4, 8)))
    return out


def draw_led_glow() -> Image.Image:
    """The LED strip's glow on the floor, one row further down."""
    out = Image.new('RGBA', (TILE, TILE))
    px = out.load()
    for x in range(TILE):
        for y in range(TILE):
            px[x, y] = (110, 176, 224, round(52 * falloff(y, TILE)))
    return out


def draw_portal(half: str) -> Image.Image:
    """
    Half of a doorway (1 tile wide, 2 tall): a dark opening with jambs and a
    cold glow from below — the light of the other world. Drawn as decorative
    furniture on top of the wall, which already blocks the way.
    """
    out = Image.new('RGBA', (TILE, TILE))
    px = out.load()
    jamb = (36, 45, 62, 255)
    base, lit = (5, 8, 14), (104, 182, 232)
    for y in range(TILE):
        for x in range(TILE):
            if x < 3 or x >= TILE - 3:
                px[x, y] = jamb
                continue
            if half == 'top':
                if y < 3:
                    px[x, y] = jamb  # lintel
                    continue
                glow = (y / TILE / 2) ** 2
            elif half == 'bottom':
                glow = ((y / TILE + 1) / 2) ** 2
            else:
                # 'edge': the whole opening in one tile, light facing up.
                glow = (1 - y / TILE) ** 1.6
            side = 1 - abs(x - TILE / 2) / (TILE / 2 - 3)
            px[x, y] = (
                *(round(base[i] + (lit[i] - base[i]) * glow * (0.35 + 0.65 * side)) for i in range(3)),
                255,
            )
    return out


def draw_threshold() -> Image.Image:
    """The doorway's light spilled over the floor tile you step on to travel."""
    out = Image.new('RGBA', (TILE, TILE))
    px = out.load()
    for y in range(TILE):
        for x in range(TILE):
            edge = 1 - abs(x - TILE / 2) / (TILE / 2)
            px[x, y] = (120, 186, 236, round(110 * falloff(y, TILE) * edge))
    return out


# 5x7 glyphs for the world's name on the wall. Only the six letters of
# "CHIRON": this is a sign, not a font.
GLYPHS = {
    'C': ('.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'),
    'H': ('#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'),
    'I': ('#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'),
    'R': ('####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'),
    'O': ('.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'),
    'N': ('#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'),
}
#: How many pixels a glyph pixel becomes (5x7 -> 20x28 inside a 32x32 tile).
GLYPH_SCALE = 4


def draw_letter(glyph: str) -> Image.Image:
    """
    One letter of the sign, lit from within: a solid cold core with a halo
    bled around it, so it reads as a light and not as paint. Tiles are laid
    side by side to spell the world's name.
    """
    rows = GLYPHS[glyph]
    width, height = len(rows[0]) * GLYPH_SCALE, len(rows) * GLYPH_SCALE
    x0, y0 = (TILE - width) // 2, (TILE - height) // 2

    core = [[False] * TILE for _ in range(TILE)]
    for j, row in enumerate(rows):
        for i, cell in enumerate(row):
            if cell != '#':
                continue
            for dy in range(GLYPH_SCALE):
                for dx in range(GLYPH_SCALE):
                    core[y0 + j * GLYPH_SCALE + dy][x0 + i * GLYPH_SCALE + dx] = True

    out = Image.new('RGBA', (TILE, TILE))
    px = out.load()
    for y in range(TILE):
        for x in range(TILE):
            if core[y][x]:
                px[x, y] = (236, 250, 255, 255)
                continue
            # Halo: the closer to a lit pixel, the brighter.
            near = min(
                (
                    math.hypot(x - cx, y - cy)
                    for cy in range(max(0, y - 3), min(TILE, y + 4))
                    for cx in range(max(0, x - 3), min(TILE, x + 4))
                    if core[cy][cx]
                ),
                default=None,
            )
            if near is None:
                continue
            alpha = round(190 * falloff(near, 4))
            if alpha:
                px[x, y] = (*LIGHT_COLD, alpha)
    return out


def draw_arrow(facing: str) -> Image.Image:
    """
    A chevron painted on the floor, pointing the way out of the arrival hall.
    Two of them stacked, so the direction still reads when an avatar is
    standing on the tile.
    """
    out = Image.new('RGBA', (TILE, TILE))
    px = out.load()
    thickness, arm = 3, 10
    for tip in (16, 25):
        for step in range(arm + 1):
            for t in range(thickness):
                # The tip is at `tip` and both arms trail back from it.
                along = tip - step - t
                for across in (TILE // 2 + step, TILE // 2 - step):
                    # North is the same chevron on the other axis, mirrored:
                    # its tip has to end up at the top, not at the bottom.
                    x, y = (along, across) if facing == 'e' else (across, TILE - 1 - along)
                    if 0 <= x < TILE and 0 <= y < TILE:
                        px[x, y] = (*LIGHT_COLD, 150)
    return out


DRAWINGS = {
    'letter': draw_letter,
    'arrow': draw_arrow,
    'pool': draw_pool,
    'spot': draw_spot,
    'led': draw_led,
    'led_glow': draw_led_glow,
    'portal': draw_portal,
    'threshold': draw_threshold,
}


def render(tile: DarkTile, sheet: Image.Image) -> Image.Image:
    if tile.draw:
        return DRAWINGS[tile.draw](**tile.args)
    assert tile.source is not None, f'tile "{tile.name}" does not say where it comes from'
    shadow, light = tile.palette
    return duotone(source_tile(sheet, tile.source), shadow, light)


def main() -> None:
    sheet = Image.open(SOURCE_SHEET).convert('RGBA')
    out = Image.new('RGBA', (SHEET_COLUMNS * TILE, SHEET_ROWS * TILE))
    for i, tile in enumerate(TILES):
        col, row = i % SHEET_COLUMNS, i // SHEET_COLUMNS
        out.alpha_composite(render(tile, sheet), (col * TILE, row * TILE))
    out.save(TARGET_SHEET)
    print(f'wrote {TARGET_SHEET.relative_to(Path(__file__).resolve().parent.parent)}'
          f' ({len(TILES)} tiles, {SHEET_COLUMNS}×{SHEET_ROWS})')


if __name__ == '__main__':
    main()
