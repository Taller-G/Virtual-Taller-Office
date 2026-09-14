#!/usr/bin/env python3
"""
Generates the 3 pixel art avatars of the people on the team (persona1, persona2,
persona3) from LimeZu's base sprites, recolouring hair and clothes
independently so that each one keeps the real person's recognisable traits (hair
length/colour, clothing colour).

Development only: the result is committed in apps/client/public/assets/avatars.
Requires Python 3 and Pillow (`pip install pillow`).

Usage:  python3 tools/person-avatars.py

How it works: unlike recolor-avatars.py (which rotates a single hue over the
whole character), this script separates the HAIR and CLOTHING colours within
each base sprite (lists obtained by analysing the palette) and applies different
colour targets to them. For each colour the shading ramp is preserved: its value
(the V of HSV) is taken and remapped to the target colour's [vmin, vmax] range,
setting a new hue and saturation. The shared colours (skin, mouth, outlines,
shadows) and the ones in neither list are left untouched.

Person -> base sprite pairing (chosen by hair length/silhouette):
  persona1  <- lucy   (long hair)   : blonde / light brown, cream blouse
  persona2  <- nancy  (long hair)   : black hair, black leather jacket
  persona3  <- ash    (short hair)  : brown, light top

LimeZu's licence allows editing the assets (see docs/asset-licenses.md).
"""
from __future__ import annotations

import colorsys
from pathlib import Path

from PIL import Image

AVATARS_DIR = Path(__file__).resolve().parents[1] / "apps/client/public/assets/avatars"

FRAME_H = 48  # frame height; used for the torso/legs spatial rule

# HAIR colours per base sprite (the warm tones of the hair).
HAIR: dict[str, list[tuple[int, int, int]]] = {
    "lucy": [(171, 103, 54), (179, 123, 63), (204, 150, 89), (175, 114, 59), (194, 136, 75), (179, 94, 63)],
    "nancy": [(114, 74, 64), (128, 84, 73), (131, 91, 76), (134, 97, 80), (123, 81, 71), (100, 73, 66)],
    "ash": [(141, 112, 81), (138, 101, 82), (149, 115, 80), (186, 141, 94), (111, 84, 70)],
}

# CLOTHING colours (torso) per base sprite.
TOP: dict[str, list[tuple[int, int, int]]] = {
    "lucy": [(191, 166, 144), (208, 190, 156)],
    "nancy": [(108, 110, 133), (216, 208, 224), (51, 131, 214), (42, 165, 226)],
    "ash": [(90, 68, 74), (111, 73, 77), (162, 57, 75), (174, 74, 82), (225, 155, 155), (246, 151, 132)],
}

# Colours the clothing shares with the trousers: they are recoloured as TOP only
# on the torso (local y of the frame < 32) so the legs are not lightened/tinted.
TOP_SPATIAL: dict[str, list[tuple[int, int, int]]] = {
    "ash": [(128, 145, 165), (157, 163, 183), (139, 139, 171)],
}

# Colour target per area: (hue 0-1, saturation 0-1, vmin, vmax).
# person -> (base sprite, {"hair": ..., "top": ...})
PEOPLE: dict[str, tuple[str, dict[str, tuple[float, float, float, float]]]] = {
    "persona1": ("lucy", {"hair": (0.11, 0.40, 0.45, 0.93), "top": (0.09, 0.10, 0.72, 0.98)}),
    "persona2": ("nancy", {"hair": (0.0, 0.03, 0.05, 0.17), "top": (0.62, 0.05, 0.07, 0.24)}),
    "persona3": ("ash", {"hair": (0.07, 0.58, 0.16, 0.52), "top": (0.0, 0.02, 0.72, 1.0)}),
}


def remap(rgb: tuple[int, int, int], tint: tuple[float, float, float, float]) -> tuple[int, int, int]:
    _, _, v = colorsys.rgb_to_hsv(*(c / 255 for c in rgb))
    th, ts, vmin, vmax = tint
    nv = vmin + v * (vmax - vmin)
    r, g, b = colorsys.hsv_to_rgb(th, ts, nv)
    return (round(r * 255), round(g * 255), round(b * 255))


def build(base: str, tints: dict[str, tuple[float, float, float, float]], target: Path) -> None:
    im = Image.open(AVATARS_DIR / f"{base}.png").convert("RGBA")
    hair = set(HAIR[base])
    top = set(TOP[base])
    tsp = set(TOP_SPATIAL.get(base, []))
    out = Image.new("RGBA", im.size)
    src = im.load()
    dst = out.load()
    for y in range(im.height):
        torso = (y % FRAME_H) < 32
        for x in range(im.width):
            r, g, b, a = src[x, y]
            if a == 0:
                dst[x, y] = (0, 0, 0, 0)
                continue
            col = (r, g, b)
            if col in hair:
                dst[x, y] = (*remap(col, tints["hair"]), a)
            elif col in top or (col in tsp and torso):
                dst[x, y] = (*remap(col, tints["top"]), a)
            else:
                dst[x, y] = (r, g, b, a)
    out.save(target, optimize=True)
    print(f"{target.name}: from {base}.png (hair + clothes recoloured)")


def main() -> None:
    for person, (base, tints) in PEOPLE.items():
        build(base, tints, AVATARS_DIR / f"{person}.png")


if __name__ == "__main__":
    main()
