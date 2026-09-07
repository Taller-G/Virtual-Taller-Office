#!/usr/bin/env python3
"""
Genera las 4 variantes recoloreadas de los avatares base (adam, ash, lucy,
nancy) para completar el catálogo de 8 avatares.

Solo desarrollo: el resultado se versiona en apps/client/public/assets/avatars.
Requiere Python 3 y Pillow (`pip install pillow`).

Uso:  python3 tools/recolor-avatars.py

Cómo funciona: rota el tono (HSV) de ropa y pelo y deja intactos los colores
que los 4 personajes comparten (piel, boca, contornos y sombras), así las
variantes siguen pareciendo del mismo set de LimeZu. La licencia de LimeZu
permite editar los assets (ver docs/licencias-assets.md).
"""
from __future__ import annotations

import colorsys
from pathlib import Path

from PIL import Image

AVATARS_DIR = Path(__file__).resolve().parents[1] / "apps/client/public/assets/avatars"

# id destino: (id base, rotación de tono en grados, ajuste de saturación)
VARIANTS: dict[str, tuple[str, float, float]] = {
    "bruno": ("adam", 150, 1.0),
    "dana": ("ash", 200, 1.05),
    "iris": ("lucy", 120, 0.95),
    "tomas": ("nancy", 90, 1.0),
}

# Colores compartidos por los 4 personajes base: piel, boca, contornos, sombras.
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
    print(f"{target.name}: desde {source.name}, tono {degrees:+}°")


def main() -> None:
    for target_id, (base_id, degrees, sat) in VARIANTS.items():
        recolor(AVATARS_DIR / f"{base_id}.png", AVATARS_DIR / f"{target_id}.png", degrees, sat)


if __name__ == "__main__":
    main()
