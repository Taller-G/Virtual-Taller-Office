#!/usr/bin/env python3
"""
Genera `apps/client/public/assets/tilesets/ChironDark.png`: el tileset oscuro
con el que está pintada la Chiron Office (pisos, paredes y luces).

Uso:  python3 tools/make-chiron-tileset.py
      python3 tools/make-chiron-map.py      # después, para rehacer el mapa

Qué hace: toma de `FloorAndGround.png` los mismos tiles con los que está armada
la First Office, los pasa por un duotono frío (sombra azul noche → brillo
acero) y agrega unos tiles de luz dibujados a mano. El resultado es una hoja
chica y ordenada, pensada para un solo mapa; el vocabulario y las paletas
están en `tools/chiron_tiles.py`.

Solo desarrollo: el PNG se versiona y después el mapa se edita en Tiled como
cualquier otro (ver `docs/mapa.md`).
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

from chiron_tiles import (  # noqa: E402
    LIGHT_WARM,
    SHEET_COLUMNS,
    SHEET_ROWS,
    SOURCE_SHEET,
    TARGET_SHEET,
    TILE,
    TILES,
    DarkTile,
)

#: Columnas de `FloorAndGround` (los gid se leen en ese orden).
SOURCE_COLUMNS = 64


def source_tile(sheet: Image.Image, gid: int) -> Image.Image:
    """El tile `gid` de FloorAndGround (firstgid 1) como imagen RGBA."""
    index = gid - 1
    col, row = index % SOURCE_COLUMNS, index // SOURCE_COLUMNS
    return sheet.crop((col * TILE, row * TILE, (col + 1) * TILE, (row + 1) * TILE))


def duotone(
    tile: Image.Image,
    shadow: tuple[int, int, int],
    light: tuple[int, int, int],
) -> Image.Image:
    """
    Mapea el tile a una rampa de dos colores según su luminancia.

    El gamma (1.4) hunde los medios tonos: sin él las paredes blancas del pack
    original quedan en un gris medio y la oficina se ve nublada, no oscura.
    Se conserva un 12% del color original para que las texturas no queden
    completamente planas.
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
# Tiles de luz (dibujados a mano)
# ---------------------------------------------------------------------------


def falloff(distance: float, radius: float) -> float:
    """Caída suave de una luz: 1 en el centro, 0 en el borde."""
    if distance >= radius:
        return 0.0
    t = 1 - distance / radius
    return t * t


def draw_pool(quad: str) -> Image.Image:
    """
    Un cuarto de un charco de luz de 2×2 tiles. Los cuatro cuartos juntos son
    una lámpara cenital sobre el piso; sueltos no sirven.
    """
    out = Image.new('RGBA', (TILE, TILE))
    px = out.load()
    # Centro del charco completo, en coordenadas de este cuarto.
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
    """Un charco de luz chico, de un tile: una lámpara de pie o un monitor."""
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
    """Tira LED fría: se pone sobre la franja de sombra al pie de la pared."""
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
    """Resplandor de la tira LED sobre el piso, una fila más abajo."""
    out = Image.new('RGBA', (TILE, TILE))
    px = out.load()
    for x in range(TILE):
        for y in range(TILE):
            px[x, y] = (110, 176, 224, round(52 * falloff(y, TILE)))
    return out


def draw_portal(half: str) -> Image.Image:
    """
    Mitad de un vano de puerta (1 tile de ancho, 2 de alto). Es un hueco
    oscuro con jambas y un resplandor frío desde abajo: la luz del otro mundo.
    Se dibuja como mueble decorativo sobre la pared, que ya bloquea el paso.
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
                    px[x, y] = jamb  # dintel
                    continue
                glow = (y / TILE / 2) ** 2
            elif half == 'bottom':
                glow = ((y / TILE + 1) / 2) ** 2
            else:
                # 'edge': el vano entero en un tile, con la luz hacia arriba.
                glow = (1 - y / TILE) ** 1.6
            side = 1 - abs(x - TILE / 2) / (TILE / 2 - 3)
            px[x, y] = (
                *(round(base[i] + (lit[i] - base[i]) * glow * (0.35 + 0.65 * side)) for i in range(3)),
                255,
            )
    return out


def draw_threshold() -> Image.Image:
    """La luz del vano derramada sobre el piso que se pisa para viajar."""
    out = Image.new('RGBA', (TILE, TILE))
    px = out.load()
    for y in range(TILE):
        for x in range(TILE):
            edge = 1 - abs(x - TILE / 2) / (TILE / 2)
            px[x, y] = (120, 186, 236, round(110 * falloff(y, TILE) * edge))
    return out


DRAWINGS = {
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
    assert tile.source is not None, f'el tile "{tile.name}" no dice de dónde sale'
    shadow, light = tile.palette
    return duotone(source_tile(sheet, tile.source), shadow, light)


def main() -> None:
    sheet = Image.open(SOURCE_SHEET).convert('RGBA')
    out = Image.new('RGBA', (SHEET_COLUMNS * TILE, SHEET_ROWS * TILE))
    for i, tile in enumerate(TILES):
        col, row = i % SHEET_COLUMNS, i // SHEET_COLUMNS
        out.alpha_composite(render(tile, sheet), (col * TILE, row * TILE))
    out.save(TARGET_SHEET)
    print(f'escrito {TARGET_SHEET.relative_to(Path(__file__).resolve().parent.parent)}'
          f' ({len(TILES)} tiles, {SHEET_COLUMNS}×{SHEET_ROWS})')


if __name__ == '__main__':
    main()
