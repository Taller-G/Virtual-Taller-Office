#!/usr/bin/env python3
"""
Is this block of gids a whole piece of furniture, or half of one?

LimeZu's packs draw a sofa, a locker or a vending machine across several tiles
and pack unrelated objects right next to each other, with nothing in the file
saying which tiles belong together. Picking a block of gids by eye off the
sheet is a coin toss, and the way it fails is quiet: the map still renders, it
just renders half a chair, or a worktop floating over somebody else's sink.
That has already cost this project several rounds (`chiron-memory/gotchas.md`).

What the sheet *does* say is where the ink is. So the question "is this block
whole?" has a pixel answer: **does any ink cross the block's border?** Run a
line along each of the four edges and look for a pixel that is opaque just
inside and opaque just outside. Where that happens, the block's edge is drawn
through something rather than around it.

    cut_sides('Basement', 4688, 16, [[5223], [5239]])       # -> {'left': 48}
    cut_sides('Basement', 4688, 16, [[5222, 5223], [5238, 5239]])   # -> {}

The first is half an armchair; the second is the chair. That is the whole of
the rule, and it is exact — except for one thing the sheets really do: some
rows pack identical objects **edge to edge**, with no transparent seam between
them (the sofa row of `Basement`). There the neighbour's ink touches the
border of a block that is nonetheless whole. So a piece may declare which
sides it abuts a neighbour on (see `PIECES` in `make-chiron-map.py`); a cut on
any other side is a mistake and fails the build. Declaring a side is a
deliberate, reviewable line in the diff — not a silent pass.

Run it to go looking for a piece, or to check one:

    python3 tools/tileset_pieces.py Basement 4688 16 5223       # what is whole around this gid
    python3 tools/tileset_pieces.py Basement 4688 16 --render out.png 5222 5223 5238 5239
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
TILESETS = ROOT / 'apps/client/public/assets/tilesets'

TILE = 32

#: A pixel counts as ink above this alpha. Not 0: the sheets carry a fringe of
#: almost-transparent antialiasing, and counting it makes every piece touch
#: every other one.
INK_ALPHA = 8

SIDES = ('left', 'right', 'top', 'bottom')

_sheets: dict[str, Image.Image] = {}


def _sheet(name: str) -> Image.Image:
    image = _sheets.get(name)
    if image is None:
        image = Image.open(TILESETS / f'{name}.png').convert('RGBA')
        _sheets[name] = image
    return image


def sheet_rect(firstgid: int, columns: int, grid: list[list[int]]) -> tuple[int, int, int, int]:
    """
    Where the grid sits in the sheet, as (col, row, width, height) in tiles.

    Raises if the grid is not one rectangle of the sheet: rows of different
    lengths, gids that are not consecutive along a row, or rows that are not
    one sheet-row apart. That alone catches a block glued together out of two
    different pieces — the `[[4536, 4537], [4563, 4564]]` counter, whose two
    halves live eleven columns and a row apart.
    """
    if not grid or not grid[0]:
        raise ValueError('an empty grid draws nothing')
    width = len(grid[0])
    first = grid[0][0] - firstgid
    col, row = first % columns, first // columns
    if col + width > columns:
        raise ValueError(f'the block starting at gid {grid[0][0]} runs off the edge of the sheet')
    for r, line in enumerate(grid):
        if len(line) != width:
            raise ValueError('the block is not rectangular: its rows have different lengths')
        for c, gid in enumerate(line):
            want = firstgid + (row + r) * columns + col + c
            if gid != want:
                raise ValueError(
                    f'gid {gid} at ({c},{r}) does not belong to the block that starts at '
                    f'{grid[0][0]}: the sheet has {want} there. The tiles of a piece are '
                    'consecutive in the sheet; two that are not are two different pieces.'
                )
    return col, row, width, len(grid)


def cut_sides(name: str, firstgid: int, columns: int, grid: list[list[int]]) -> dict[str, int]:
    """
    Which sides of the block are drawn through, and by how many pixels.

    An empty result means nothing crosses the border: whatever the block draws,
    it draws all of it.
    """
    col, row, width, height = sheet_rect(firstgid, columns, grid)
    image = _sheet(name)
    sheet_w, sheet_h = image.size
    pixels = image.load()

    def ink(x: int, y: int) -> bool:
        return 0 <= x < sheet_w and 0 <= y < sheet_h and pixels[x, y][3] > INK_ALPHA

    x0, y0 = col * TILE, row * TILE
    x1, y1 = x0 + width * TILE, y0 + height * TILE
    cuts = dict.fromkeys(SIDES, 0)
    for y in range(y0, y1):
        if ink(x0 - 1, y) and ink(x0, y):
            cuts['left'] += 1
        if ink(x1, y) and ink(x1 - 1, y):
            cuts['right'] += 1
    for x in range(x0, x1):
        if ink(x, y0 - 1) and ink(x, y0):
            cuts['top'] += 1
        if ink(x, y1) and ink(x, y1 - 1):
            cuts['bottom'] += 1
    return {side: n for side, n in cuts.items() if n}


def blank_tiles(name: str, firstgid: int, columns: int, grid: list[list[int]]) -> set[int]:
    """Gids of the block with nothing drawn on them at all."""
    col, row, width, height = sheet_rect(firstgid, columns, grid)
    pixels = _sheet(name).load()
    out = set()
    for r in range(height):
        for c in range(width):
            x0, y0 = (col + c) * TILE, (row + r) * TILE
            if not any(
                pixels[x, y][3] > INK_ALPHA
                for y in range(y0, y0 + TILE)
                for x in range(x0, x0 + TILE)
            ):
                out.add(grid[r][c])
    return out


def blank_lines(name: str, firstgid: int, columns: int, grid: list[list[int]]) -> list[str]:
    """
    Whole columns or rows of the block that draw nothing — which means the
    block is bigger than the object in it. A single blank tile is not a fault
    (a round table in its three-by-three leaves its corners empty); a blank
    *line* is, and it is what a block laid over the wrong number of tiles looks
    like: the Archive's cabinets were a three-wide slice of a two-wide locker,
    so every one of them carried an empty column.
    """
    blank = blank_tiles(name, firstgid, columns, grid)
    out = []
    for c in range(len(grid[0])):
        if all(row[c] in blank for row in grid):
            out.append(f'column {c}')
    for r, row in enumerate(grid):
        if all(gid in blank for gid in row):
            out.append(f'row {r}')
    return out


def ink_fraction(name: str, firstgid: int, columns: int, gid: int) -> float:
    """How much of that one tile is drawn on, from 0 (nothing) to 1 (every pixel)."""
    local = gid - firstgid
    x0, y0 = (local % columns) * TILE, (local // columns) * TILE
    pixels = _sheet(name).load()
    drawn = sum(
        1
        for y in range(y0, y0 + TILE)
        for x in range(x0, x0 + TILE)
        if pixels[x, y][3] > INK_ALPHA
    )
    return drawn / (TILE * TILE)


def whole_around(name: str, firstgid: int, columns: int, gid: int) -> list[list[int]] | None:
    """
    The smallest block around `gid` that nothing is cut on: grow the rectangle
    towards every side that is drawn through until none is. This is how you
    find a piece you only know one tile of — but read the result, do not trust
    it blindly: on a row of objects packed edge to edge it keeps growing until
    it has swallowed the whole row.
    """
    local = gid - firstgid
    col0 = col1 = local % columns
    row0 = row1 = local // columns
    for _ in range(64):
        grid = [
            [firstgid + r * columns + c for c in range(col0, col1 + 1)]
            for r in range(row0, row1 + 1)
        ]
        cuts = cut_sides(name, firstgid, columns, grid)
        if not cuts:
            return grid
        if 'left' in cuts:
            col0 -= 1
        if 'right' in cuts:
            col1 += 1
        if 'top' in cuts:
            row0 -= 1
        if 'bottom' in cuts:
            row1 += 1
        if col0 < 0 or row0 < 0 or col1 >= columns:
            return None
    return None


def render(name: str, firstgid: int, columns: int, grid: list[list[int]], out: Path) -> None:
    """
    The block as it will be drawn, with one tile of the sheet around it, the
    tile grid marked and the block outlined. This is "render those exact gids
    side by side and look at it" as one command.
    """
    col, row, width, height = sheet_rect(firstgid, columns, grid)
    image = _sheet(name)
    scale, margin = 6, 1
    x0, y0 = max(0, col - margin) * TILE, max(0, row - margin) * TILE
    x1 = min(columns, col + width + margin) * TILE
    y1 = min(image.size[1] // TILE, row + height + margin) * TILE
    crop = image.crop((x0, y0, x1, y1))
    canvas = Image.new('RGBA', (crop.width * scale, crop.height * scale), (32, 34, 44, 255))
    canvas.alpha_composite(crop.resize((crop.width * scale, crop.height * scale), Image.NEAREST))
    draw = ImageDraw.Draw(canvas)
    for x in range(0, canvas.width, TILE * scale):
        draw.line([(x, 0), (x, canvas.height)], fill=(255, 255, 255, 60))
    for y in range(0, canvas.height, TILE * scale):
        draw.line([(0, y), (canvas.width, y)], fill=(255, 255, 255, 60))
    draw.rectangle(
        [
            (col * TILE - x0) * scale,
            (row * TILE - y0) * scale,
            (col * TILE - x0 + width * TILE) * scale - 1,
            (row * TILE - y0 + height * TILE) * scale - 1,
        ],
        outline=(255, 214, 64, 255),
        width=3,
    )
    canvas.convert('RGB').save(out)


def main() -> None:
    args = sys.argv[1:]
    out = None
    if '--render' in args:
        i = args.index('--render')
        out = Path(args[i + 1])
        del args[i : i + 2]
    if len(args) < 4:
        raise SystemExit(
            f'usage: {sys.argv[0]} <tileset> <firstgid> <columns> [--render out.png] <gid ...>'
        )
    name, firstgid, columns = args[0], int(args[1]), int(args[2])
    gids = [int(a) for a in args[3:]]

    if out is not None:
        local = [g - firstgid for g in gids]
        col0 = min(g % columns for g in local)
        col1 = max(g % columns for g in local)
        row0 = min(g // columns for g in local)
        row1 = max(g // columns for g in local)
        grid = [
            [firstgid + r * columns + c for c in range(col0, col1 + 1)]
            for r in range(row0, row1 + 1)
        ]
        render(name, firstgid, columns, grid, out)
        print(f'wrote {out}: {cut_sides(name, firstgid, columns, grid) or "nothing is cut"}')
        return

    for gid in gids:
        grid = whole_around(name, firstgid, columns, gid)
        print(f'--- gid {gid} ---')
        if grid is None:
            print('  no block around it comes out whole: the sheet packs this row edge to edge')
            continue
        print(f'  {len(grid[0])}x{len(grid)} tiles, nothing cut: {grid}')


if __name__ == '__main__':
    main()
