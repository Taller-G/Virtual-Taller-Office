#!/usr/bin/env python3
"""
Draws a whole world's map to a PNG, the way the client draws it: tile layers
bottom to top, then the furniture objects sorted by their bottom edge.

Development only; nothing it writes is committed. It exists so a layout can be
*looked at* — the map is a 40x40 grid of tile ids, and the only honest way to
review "is this furniture whole, aligned and where I meant it" is to see it.

    python3 tools/render-map.py first-office -o /tmp/first.png
    python3 tools/render-map.py first-office --grid --debug -o /tmp/first.png

`--grid` writes the tile coordinates over the image; `--debug` paints what the
client's `?debug` view paints: colliding tiles yellow, solid furniture blue,
zones outlined, seats teal, doors purple, spawns green.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
MAPS = ROOT / 'apps/client/public/assets/map'

FLIP_H = 0x80000000
FLIP_V = 0x40000000
GID_MASK = 0x1FFFFFFF

#: Where the client anchors the office's logo (see `officeMap.ts`).
LOGO_ZONE = 'Reception'
LOGO_FRAC_X = 0.5
LOGO_OFFSET_Y = 64

_sheets: dict[str, Image.Image] = {}


def sheet(tileset: dict) -> Image.Image:
    name = tileset['name']
    if name not in _sheets:
        image = (MAPS / tileset['image']).resolve()
        _sheets[name] = Image.open(image).convert('RGBA')
    return _sheets[name]


def tileset_for(map_: dict, gid: int) -> dict:
    plain = gid & GID_MASK
    best = None
    for tileset in map_['tilesets']:
        if plain >= tileset['firstgid'] and (best is None or tileset['firstgid'] > best['firstgid']):
            best = tileset
    return best


def tile_image(map_: dict, gid: int) -> Image.Image | None:
    tileset = tileset_for(map_, gid)
    if tileset is None:
        return None
    index = (gid & GID_MASK) - tileset['firstgid']
    columns = tileset['columns']
    tw, th = tileset['tilewidth'], tileset['tileheight']
    x, y = (index % columns) * tw, (index // columns) * th
    out = sheet(tileset).crop((x, y, x + tw, y + th))
    if gid & FLIP_H:
        out = out.transpose(Image.FLIP_LEFT_RIGHT)
    if gid & FLIP_V:
        out = out.transpose(Image.FLIP_TOP_BOTTOM)
    return out


def collides(map_: dict, gid: int) -> bool:
    tileset = tileset_for(map_, gid)
    if tileset is None:
        return False
    index = (gid & GID_MASK) - tileset['firstgid']
    for tile in tileset.get('tiles', []):
        if tile['id'] == index:
            return any(p['name'] == 'collides' and p['value'] for p in tile.get('properties', []))
    return False


def object_collides(layer: dict, obj: dict) -> bool:
    for source in (obj, layer):
        for prop in source.get('properties', []) or []:
            if prop['name'] == 'collides':
                return bool(prop['value'])
    return False


def render(name: str, out: Path, grid: bool, debug: bool) -> None:
    map_ = json.loads((MAPS / f'{name}.json').read_text(encoding='utf-8'))
    tw, th = map_['tilewidth'], map_['tileheight']
    width, height = map_['width'] * tw, map_['height'] * th
    canvas = Image.new('RGBA', (width, height), (14, 16, 22, 255))

    for layer in map_['layers']:
        if layer['type'] != 'tilelayer':
            continue
        for i, gid in enumerate(layer['data']):
            if not gid:
                continue
            image = tile_image(map_, gid)
            if image is not None:
                col, row = i % layer['width'], i // layer['width']
                canvas.alpha_composite(image, (col * tw, row * th))

    # The logo is not map data: the client paints it as a floor decal, anchored
    # to the zone named `Reception` (`officeMap.ts`). It is drawn here for the
    # same reason everything else is -- so what the review looks at is what the
    # player sees.
    logo = ROOT / 'apps/client/public/assets/logo/taller-logo-pixel.png'
    zone = next(
        (
            o
            for l in map_['layers']
            if l['type'] == 'objectgroup'
            for o in l['objects']
            if o.get('type') == 'zone' and o.get('name') == LOGO_ZONE
        ),
        None,
    )
    if zone is not None and logo.exists():
        image = Image.open(logo).convert('RGBA')
        canvas.alpha_composite(
            image,
            (
                round(zone['x'] + zone['width'] * LOGO_FRAC_X - image.width / 2),
                round(zone['y'] + LOGO_OFFSET_Y),
            ),
        )

    drawn = []
    for layer in map_['layers']:
        if layer['type'] != 'objectgroup':
            continue
        for obj in layer['objects']:
            if obj.get('gid'):
                drawn.append((obj, layer))
    drawn.sort(key=lambda pair: pair[0]['y'])
    for obj, _layer in drawn:
        image = tile_image(map_, obj['gid'])
        if image is None:
            continue
        w = int(obj.get('width') or image.width)
        h = int(obj.get('height') or image.height)
        if (w, h) != image.size:
            image = image.resize((w, h))
        canvas.alpha_composite(image, (int(obj['x']), int(obj['y']) - h))

    draw = ImageDraw.Draw(canvas, 'RGBA')
    if debug:
        for layer in map_['layers']:
            if layer['type'] != 'tilelayer':
                continue
            for i, gid in enumerate(layer['data']):
                if gid and collides(map_, gid):
                    col, row = i % layer['width'], i // layer['width']
                    draw.rectangle(
                        [col * tw, row * th, col * tw + tw - 1, row * th + th - 1],
                        fill=(250, 204, 21, 90),
                    )
        for obj, layer in drawn:
            if not object_collides(layer, obj):
                continue
            h = int(obj.get('height') or th)
            w = int(obj.get('width') or tw)
            draw.rectangle(
                [obj['x'], obj['y'] - h, obj['x'] + w - 1, obj['y'] - 1],
                fill=(59, 130, 246, 110),
            )
        colors = {
            'zone': (255, 255, 255, 220),
            'seat': (52, 211, 153, 255),
            'door': (167, 139, 250, 255),
            'spawn': (74, 222, 128, 255),
        }
        for layer in map_['layers']:
            if layer['type'] != 'objectgroup':
                continue
            for obj in layer['objects']:
                kind = obj.get('type')
                if kind not in colors:
                    continue
                x, y = obj['x'], obj['y']
                w, h = obj.get('width') or 8, obj.get('height') or 8
                draw.rectangle([x, y, x + w - 1, y + h - 1], outline=colors[kind], width=2)
                if obj.get('name'):
                    draw.text((x + 3, y + 2), obj['name'], fill=colors[kind])

    if grid:
        for col in range(map_['width']):
            draw.line([(col * tw, 0), (col * tw, height)], fill=(255, 255, 255, 40))
            draw.text((col * tw + 2, 2), str(col), fill=(255, 255, 255, 140))
        for row in range(map_['height']):
            draw.line([(0, row * th), (width, row * th)], fill=(255, 255, 255, 40))
            draw.text((2, row * th + 2), str(row), fill=(255, 255, 255, 140))

    canvas.convert('RGB').save(out)
    print(f'wrote {out}')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('world', help='map file name without .json (first-office, chiron-office)')
    parser.add_argument('-o', '--out', default='/tmp/map.png', type=Path)
    parser.add_argument('--grid', action='store_true', help='draw the tile grid and coordinates')
    parser.add_argument('--debug', action='store_true', help="what the client's ?debug view shows")
    args = parser.parse_args()
    render(args.world, args.out, args.grid, args.debug)


if __name__ == '__main__':
    main()
