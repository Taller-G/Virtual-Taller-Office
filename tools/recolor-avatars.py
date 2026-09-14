#!/usr/bin/env python3
"""
Generates the 4 recoloured variants of the base avatars (adam, ash, lucy,
nancy) to complete the catalogue of 8 avatars.

Development only: the result is committed in apps/client/public/assets/avatars.
Requires Python 3 and Pillow (`pip install pillow`).

Usage:  python3 tools/recolor-avatars.py

How it works: it rotates the hue (HSV) of clothes and hair and leaves untouched
the colours the 4 characters share (skin, mouth, outlines and shadows), so the
variants still look like they come from the same LimeZu set. LimeZu's licence
allows editing the assets (see docs/asset-licenses.md).
"""
from __future__ import annotations

import colorsys
from pathlib import Path

from PIL import Image

AVATARS_DIR = Path(__file__).resolve().parents[1] / "apps/client/public/assets/avatars"

# target id: (base id, hue rotation in degrees, saturation adjustment)
VARIANTS: dict[str, tuple[str, float, float]] = {
    "bruno": ("adam", 150, 1.0),
    "dana": ("ash", 200, 1.05),
    "iris": ("lucy", 120, 0.95),
    "tomas": ("nancy", 90, 1.0),
}

# Colours shared by the 4 base characters: skin, mouth, outlines, shadows.
PROTECTED = {
    (58, 58, 80),
    (70, 70, 94),
    (86, 89, 114),
    (108, 89, 129),
    (120, 125, 147),
    (171, 74, 54),
    (199, 140, 89),
    (211, 163, 141),
    (246, 174, 159),
    (255, 203, 176),
}


def shift(rgb: tuple[int, int, int], degrees: float, sat: float) -> tuple[int, int, int]:
    h, s, v = colorsys.rgb_to_hsv(*(c / 255 for c in rgb))
    h = (h + degrees / 360) % 1
    s = min(1.0, s * sat)
    return tuple(round(c * 255) for c in colorsys.hsv_to_rgb(h, s, v))  # type: ignore[return-value]


def recolor(source: Path, target: Path, degrees: float, sat: float) -> None:
    im = Image.open(source).convert("RGBA")
    out = Image.new("RGBA", im.size)
    cache: dict[tuple[int, int, int, int], tuple[int, int, int, int]] = {}
    for y in range(im.height):
        for x in range(im.width):
            px = im.getpixel((x, y))
            if px not in cache:
                r, g, b, a = px
                cache[px] = px if a == 0 or (r, g, b) in PROTECTED else (*shift((r, g, b), degrees, sat), a)
            out.putpixel((x, y), cache[px])
    out.save(target, optimize=True)
    print(f"{target.name}: from {source.name}, hue {degrees:+} deg")


def main() -> None:
    for target_id, (base_id, degrees, sat) in VARIANTS.items():
        recolor(AVATARS_DIR / f"{base_id}.png", AVATARS_DIR / f"{target_id}.png", degrees, sat)


if __name__ == "__main__":
    main()
