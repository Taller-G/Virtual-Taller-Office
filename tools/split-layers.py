#!/usr/bin/env python3
"""
Descompone cada avatar base (adam, ash, lucy, nancy) en tres capas alineadas
— body, hair, top — y genera las variantes de tono de piel para la capa body.
Las capas hair y top se guardan en escala de grises para teñirse en runtime con
Phaser `setTint()`.

Solo desarrollo: el resultado se versiona en
apps/client/public/assets/avatars/layers/.  Requiere Python 3 y Pillow.

Uso:  python3 tools/split-layers.py

Layout de cada capa: 1664×48 px (52 frames de 32×48), mismo layout LimeZu que
los avatares completos.  Los píxeles que no pertenecen a la capa quedan
transparentes (alfa 0).

Capas:
  body  — piel, contornos, pantalón, zapatos, boca; TODO menos pelo y ropa.
  hair  — solo pelo, en escala de grises (brillo original preservado).
  top   — solo ropa del torso, en escala de grises.

Las variantes de piel se generan remapeando los colores de piel (un subconjunto
de PROTECTED) con rotación HSV, al estilo de person-avatars.py.  Los contornos,
boca, pantalón y zapatos no cambian.

La licencia de LimeZu permite editar los assets (ver docs/licencias-assets.md).
"""
from __future__ import annotations

import colorsys
from pathlib import Path

from PIL import Image

AVATARS_DIR = Path(__file__).resolve().parents[1] / "apps/client/public/assets/avatars"
LAYERS_DIR = AVATARS_DIR / "layers"

FRAME_H = 48  # alto de un frame del spritesheet

# ---------------------------------------------------------------------------
# Colores compartidos por los 4 personajes base.  Son los PROTECTED de
# recolor-avatars.py: piel, boca, contornos y sombras.
# ---------------------------------------------------------------------------
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

# Subconjunto de PROTECTED que es piel (se remapea para los tonos de piel).
SKIN_COLORS = {
    (199, 140, 89),
    (211, 163, 141),
    (246, 174, 159),
    (255, 203, 176),
}

# Colores que son contornos/sombras/boca y NO cambian con el tono de piel.
FIXED_COLORS = PROTECTED - SKIN_COLORS

# ---------------------------------------------------------------------------
# Colores de PELO por sprite base (de person-avatars.py + adam analizado).
# ---------------------------------------------------------------------------
HAIR: dict[str, set[tuple[int, int, int]]] = {
    "adam": {(128, 94, 142), (159, 116, 168)},
    "ash": {(141, 112, 81), (138, 101, 82), (149, 115, 80), (186, 141, 94), (111, 84, 70)},
    "lucy": {(171, 103, 54), (179, 123, 63), (204, 150, 89), (175, 114, 59), (194, 136, 75), (179, 94, 63)},
    "nancy": {(114, 74, 64), (128, 84, 73), (131, 91, 76), (134, 97, 80), (123, 81, 71), (100, 73, 66)},
}

# ---------------------------------------------------------------------------
# Colores de ROPA (torso) por sprite base.
# ---------------------------------------------------------------------------
TOP: dict[str, set[tuple[int, int, int]]] = {
    "adam": {(104, 114, 83), (93, 96, 67), (95, 105, 74), (149, 157, 88)},
    "ash": {(90, 68, 74), (111, 73, 77), (162, 57, 75), (174, 74, 82), (225, 155, 155), (246, 151, 132)},
    "lucy": {(191, 166, 144), (208, 190, 156)},
    "nancy": {(108, 110, 133), (216, 208, 224), (51, 131, 214), (42, 165, 226)},
}

# Colores compartidos ropa/pantalón: se cuentan como TOP solo en la zona del
# torso (y local < 32).
TOP_SPATIAL: dict[str, set[tuple[int, int, int]]] = {
    "ash": {(128, 145, 165), (157, 163, 183), (139, 139, 171)},
}

# ---------------------------------------------------------------------------
# Tonos de piel: (tono H 0-1, saturación S 0-1, vmin, vmax).
# "default" conserva los colores originales (no se remapea).
# ---------------------------------------------------------------------------
SKIN_TONES: dict[str, tuple[float, float, float, float] | None] = {
    "default": None,
    "light": (0.08, 0.20, 0.80, 1.00),
    "medium": (0.07, 0.40, 0.60, 0.88),
    "tan": (0.06, 0.50, 0.40, 0.72),
    "dark": (0.05, 0.55, 0.22, 0.52),
}

BASES = ["adam", "ash", "lucy", "nancy"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def to_gray(rgb: tuple[int, int, int]) -> int:
    """Luminosidad percibida (rec. 601), preserva el contraste del pixel art."""
    r, g, b = rgb
    return min(255, round(0.299 * r + 0.587 * g + 0.114 * b))


def remap_skin(rgb: tuple[int, int, int], tone: tuple[float, float, float, float]) -> tuple[int, int, int]:
    """Remapea un color de piel a un tono objetivo (mismo método que person-avatars.py)."""
    _, _, v = colorsys.rgb_to_hsv(*(c / 255 for c in rgb))
    th, ts, vmin, vmax = tone
    nv = vmin + v * (vmax - vmin)
    r, g, b = colorsys.hsv_to_rgb(th, ts, nv)
    return (round(r * 255), round(g * 255), round(b * 255))


def classify_pixel(
    base: str, col: tuple[int, int, int], y_local: int,
) -> str:
    """Clasifica un píxel opaco en 'hair', 'top' o 'body'."""
    if col in HAIR[base]:
        return "hair"
    if col in TOP[base]:
        return "top"
    spatial = TOP_SPATIAL.get(base, set())
    if col in spatial and y_local < 32:
        return "top"
    return "body"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def split_base(base: str) -> None:
    src = Image.open(AVATARS_DIR / f"{base}.png").convert("RGBA")
    w, h = src.size

    body = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    hair = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    top = Image.new("RGBA", (w, h), (0, 0, 0, 0))

    src_px = src.load()
    body_px = body.load()
    hair_px = hair.load()
    top_px = top.load()

    for y in range(h):
        y_local = y % FRAME_H
        for x in range(w):
            r, g, b, a = src_px[x, y]
            if a == 0:
                continue
            col = (r, g, b)
            kind = classify_pixel(base, col, y_local)
            if kind == "hair":
                gray = to_gray(col)
                hair_px[x, y] = (gray, gray, gray, a)
            elif kind == "top":
                gray = to_gray(col)
                top_px[x, y] = (gray, gray, gray, a)
            else:
                body_px[x, y] = (r, g, b, a)

    out = LAYERS_DIR / base
    out.mkdir(parents=True, exist_ok=True)
    hair.save(out / "hair.png", optimize=True)
    top.save(out / "top.png", optimize=True)
    print(f"  {base}/hair.png  (escala de grises)")
    print(f"  {base}/top.png   (escala de grises)")

    # Variantes de tono de piel del body.
    for tone_name, tone in SKIN_TONES.items():
        body_var = body.copy()
        if tone is not None:
            bv = body_var.load()
            for y in range(h):
                for x in range(w):
                    r2, g2, b2, a2 = bv[x, y]
                    if a2 == 0:
                        continue
                    col2 = (r2, g2, b2)
                    if col2 in SKIN_COLORS:
                        bv[x, y] = (*remap_skin(col2, tone), a2)
        body_var.save(out / f"body-{tone_name}.png", optimize=True)
        print(f"  {base}/body-{tone_name}.png")


def main() -> None:
    print(f"Generando capas en {LAYERS_DIR}/\n")
    for base in BASES:
        print(f"[{base}]")
        split_base(base)
        print()
    print("Listo.")


if __name__ == "__main__":
    main()
