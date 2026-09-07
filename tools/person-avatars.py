#!/usr/bin/env python3
"""
Genera los 3 avatares pixel art de las personas del equipo (persona1, persona2,
persona3) a partir de los sprites base de LimeZu, recoloreando pelo y ropa de
forma independiente para que cada uno conserve los rasgos identificables de la
persona real (largo/color de pelo, color de ropa).

Solo desarrollo: el resultado se versiona en apps/client/public/assets/avatars.
Requiere Python 3 y Pillow (`pip install pillow`).

Uso:  python3 tools/person-avatars.py

Cómo funciona: a diferencia de recolor-avatars.py (que rota un único tono sobre
todo el personaje), este script separa dentro de cada sprite base los colores de
PELO y de ROPA (listas obtenidas analizando la paleta) y les aplica objetivos de
color distintos. Para cada color se conserva la rampa de sombreado: se toma su
valor (V de HSV) y se remapea al rango [vmin, vmax] del color objetivo, fijando
tono y saturación nuevos. Los colores compartidos (piel, boca, contornos,
sombras) y los que no están en ninguna lista quedan intactos.

Emparejamiento persona -> sprite base (elegido por largo/silueta de pelo):
  persona1  <- lucy   (pelo largo)   : rubia / castaño claro, blusa crema
  persona2  <- nancy  (pelo largo)   : pelo negro, campera de cuero negra
  persona3  <- ash    (pelo corto)   : castaño, top claro

La licencia de LimeZu permite editar los assets (ver docs/licencias-assets.md).
"""
from __future__ import annotations

import colorsys
from pathlib import Path

from PIL import Image

AVATARS_DIR = Path(__file__).resolve().parents[1] / "apps/client/public/assets/avatars"

FRAME_H = 48  # alto de frame; se usa para la regla espacial torso/piernas

# Colores de PELO por sprite base (tonos cálidos del cabello).
HAIR: dict[str, list[tuple[int, int, int]]] = {
    "lucy": [(171, 103, 54), (179, 123, 63), (204, 150, 89), (175, 114, 59), (194, 136, 75), (179, 94, 63)],
    "nancy": [(114, 74, 64), (128, 84, 73), (131, 91, 76), (134, 97, 80), (123, 81, 71), (100, 73, 66)],
    "ash": [(141, 112, 81), (138, 101, 82), (149, 115, 80), (186, 141, 94), (111, 84, 70)],
}

# Colores de ROPA (torso) por sprite base.
TOP: dict[str, list[tuple[int, int, int]]] = {
    "lucy": [(191, 166, 144), (208, 190, 156)],
    "nancy": [(108, 110, 133), (216, 208, 224), (51, 131, 214), (42, 165, 226)],
    "ash": [(90, 68, 74), (111, 73, 77), (162, 57, 75), (174, 74, 82), (225, 155, 155), (246, 151, 132)],
}

# Colores que la ropa comparte con el pantalón: se recolorean como TOP solo en el
# torso (y local del frame < 32) para no aclarar/teñir las piernas.
TOP_SPATIAL: dict[str, list[tuple[int, int, int]]] = {
    "ash": [(128, 145, 165), (157, 163, 183), (139, 139, 171)],
}

# Objetivo de color por zona: (tono 0-1, saturación 0-1, vmin, vmax).
# persona -> (sprite base, {"hair": ..., "top": ...})
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
    print(f"{target.name}: desde {base}.png (pelo + ropa recoloreados)")


def main() -> None:
    for person, (base, tints) in PEOPLE.items():
        build(base, tints, AVATARS_DIR / f"{person}.png")


if __name__ == "__main__":
    main()
