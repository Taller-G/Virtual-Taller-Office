#!/usr/bin/env python3
"""
Genera las hojas de sprites de accesorios (gorros, anteojos) como overlays
transparentes de 1664×48 px, alineados frame a frame con el avatar.

Para que cada accesorio siga el movimiento de la cabeza (sube/baja 2 px entre
frames de animación), el script analiza un avatar de referencia (ash) y detecta
la posición de la cabeza en cada frame.

Solo desarrollo: el resultado se versiona en
apps/client/public/assets/avatars/layers/accessories/.
Requiere Python 3 y Pillow.

Uso:  python3 tools/gen-accessories.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

AVATARS_DIR = Path(__file__).resolve().parents[1] / "apps/client/public/assets/avatars"
ACC_DIR = AVATARS_DIR / "layers" / "accessories"

FRAME_W, FRAME_H, FRAME_COUNT = 32, 48, 52
SHEET_W = FRAME_W * FRAME_COUNT

# Qué frames pertenecen a qué dirección.
# idle: right 0-5, up 6-11, left 12-17, down 18-23
# walk: right 24-29, up 30-35, left 36-41, down 42-47
# sit:  48-51
DIR_MAP = {}
for i in range(6):
    DIR_MAP[i] = "right"
    DIR_MAP[6 + i] = "up"
    DIR_MAP[12 + i] = "left"
    DIR_MAP[18 + i] = "down"
    DIR_MAP[24 + i] = "right"
    DIR_MAP[30 + i] = "up"
    DIR_MAP[36 + i] = "left"
    DIR_MAP[42 + i] = "down"
# Sentado: 48 right, 49 up, 50 left, 51 down
DIR_MAP[48] = "right"
DIR_MAP[49] = "up"
DIR_MAP[50] = "left"
DIR_MAP[51] = "down"


# ---------------------------------------------------------------------------
# Analizar la posición de la cabeza en cada frame del avatar de referencia.
# ---------------------------------------------------------------------------
def analyze_head(ref_path: Path) -> list[dict]:
    """Devuelve info de cada frame: {'top': y, 'cx': x, 'dir': str}."""
    im = Image.open(ref_path).convert("RGBA")
    frames = []
    for fi in range(FRAME_COUNT):
        fx = fi * FRAME_W
        # Top: primera fila no transparente
        top_y = FRAME_H
        for y in range(FRAME_H):
            for x in range(FRAME_W):
                if im.getpixel((fx + x, y))[3] > 0:
                    top_y = y
                    break
            if top_y < FRAME_H:
                break
        # Centro horizontal de los píxeles opacos en la fila de los ojos (~top+20)
        eye_y = min(top_y + 20, FRAME_H - 1)
        xs = []
        for x in range(FRAME_W):
            if im.getpixel((fx + x, eye_y))[3] > 0:
                xs.append(x)
        cx = (min(xs) + max(xs)) // 2 if xs else FRAME_W // 2
        frames.append({"top": top_y, "cx": cx, "dir": DIR_MAP.get(fi, "down")})
    return frames


# ---------------------------------------------------------------------------
# Patrones de accesorios (pixeles relativos a un punto de anclaje).
# Cada entrada: (dx, dy, (r, g, b, a)).
# ---------------------------------------------------------------------------
def _make_pattern(
    pixels: list[tuple[int, int, int, int, int]],
) -> list[tuple[int, int, tuple[int, int, int, int]]]:
    return [(dx, dy, (r, g, b, a)) for dx, dy, r, g, b, a in pixels]


# -- Gorra (cap): visera al frente, forma redondeada -------------------------
CAP = {
    "down": _make_pattern([
        # Corona (encima de la cabeza)
        (-3, 0, 70, 70, 94, 255),
        (-2, 0, 90, 90, 120, 255), (-1, 0, 90, 90, 120, 255),
        (0, 0, 90, 90, 120, 255), (1, 0, 90, 90, 120, 255),
        (2, 0, 90, 90, 120, 255), (3, 0, 90, 90, 120, 255),
        (4, 0, 70, 70, 94, 255),
        (-4, 1, 70, 70, 94, 255),
        (-3, 1, 120, 120, 160, 255), (-2, 1, 120, 120, 160, 255),
        (-1, 1, 120, 120, 160, 255), (0, 1, 120, 120, 160, 255),
        (1, 1, 120, 120, 160, 255), (2, 1, 120, 120, 160, 255),
        (3, 1, 120, 120, 160, 255), (4, 1, 120, 120, 160, 255),
        (5, 1, 70, 70, 94, 255),
        # Visera
        (-5, 2, 70, 70, 94, 255), (-4, 2, 100, 100, 140, 255),
        (-3, 2, 100, 100, 140, 255), (-2, 2, 100, 100, 140, 255),
        (-1, 2, 100, 100, 140, 255), (0, 2, 100, 100, 140, 255),
        (1, 2, 100, 100, 140, 255), (2, 2, 100, 100, 140, 255),
        (3, 2, 100, 100, 140, 255), (4, 2, 100, 100, 140, 255),
        (5, 2, 100, 100, 140, 255), (6, 2, 70, 70, 94, 255),
    ]),
    "up": _make_pattern([
        (-3, 0, 70, 70, 94, 255),
        (-2, 0, 90, 90, 120, 255), (-1, 0, 90, 90, 120, 255),
        (0, 0, 90, 90, 120, 255), (1, 0, 90, 90, 120, 255),
        (2, 0, 90, 90, 120, 255), (3, 0, 90, 90, 120, 255),
        (4, 0, 70, 70, 94, 255),
        (-4, 1, 70, 70, 94, 255),
        (-3, 1, 100, 100, 140, 255), (-2, 1, 100, 100, 140, 255),
        (-1, 1, 100, 100, 140, 255), (0, 1, 100, 100, 140, 255),
        (1, 1, 100, 100, 140, 255), (2, 1, 100, 100, 140, 255),
        (3, 1, 100, 100, 140, 255), (4, 1, 100, 100, 140, 255),
        (5, 1, 70, 70, 94, 255),
    ]),
    "right": _make_pattern([
        (-2, 0, 70, 70, 94, 255),
        (-1, 0, 90, 90, 120, 255), (0, 0, 90, 90, 120, 255),
        (1, 0, 90, 90, 120, 255), (2, 0, 90, 90, 120, 255),
        (3, 0, 70, 70, 94, 255),
        (-3, 1, 70, 70, 94, 255),
        (-2, 1, 120, 120, 160, 255), (-1, 1, 120, 120, 160, 255),
        (0, 1, 120, 120, 160, 255), (1, 1, 120, 120, 160, 255),
        (2, 1, 120, 120, 160, 255), (3, 1, 120, 120, 160, 255),
        (4, 1, 70, 70, 94, 255),
        # Visera (hacia la derecha)
        (3, 2, 100, 100, 140, 255), (4, 2, 100, 100, 140, 255),
        (5, 2, 100, 100, 140, 255), (6, 2, 70, 70, 94, 255),
    ]),
    "left": _make_pattern([
        (-2, 0, 70, 70, 94, 255),
        (-1, 0, 90, 90, 120, 255), (0, 0, 90, 90, 120, 255),
        (1, 0, 90, 90, 120, 255), (2, 0, 90, 90, 120, 255),
        (3, 0, 70, 70, 94, 255),
        (-3, 1, 70, 70, 94, 255),
        (-2, 1, 120, 120, 160, 255), (-1, 1, 120, 120, 160, 255),
        (0, 1, 120, 120, 160, 255), (1, 1, 120, 120, 160, 255),
        (2, 1, 120, 120, 160, 255), (3, 1, 120, 120, 160, 255),
        (4, 1, 70, 70, 94, 255),
        # Visera (hacia la izquierda)
        (-5, 2, 70, 70, 94, 255), (-4, 2, 100, 100, 140, 255),
        (-3, 2, 100, 100, 140, 255),
    ]),
}

# -- Gorro de lana (beanie) --------------------------------------------------
BEANIE = {
    "down": _make_pattern([
        (-3, -1, 70, 70, 94, 255),
        (-2, -1, 180, 80, 80, 255), (-1, -1, 180, 80, 80, 255),
        (0, -1, 180, 80, 80, 255), (1, -1, 180, 80, 80, 255),
        (2, -1, 180, 80, 80, 255), (3, -1, 180, 80, 80, 255),
        (4, -1, 70, 70, 94, 255),
        (-4, 0, 70, 70, 94, 255),
        (-3, 0, 200, 100, 100, 255), (-2, 0, 200, 100, 100, 255),
        (-1, 0, 200, 100, 100, 255), (0, 0, 200, 100, 100, 255),
        (1, 0, 200, 100, 100, 255), (2, 0, 200, 100, 100, 255),
        (3, 0, 200, 100, 100, 255), (4, 0, 200, 100, 100, 255),
        (5, 0, 70, 70, 94, 255),
        # Banda inferior
        (-4, 1, 70, 70, 94, 255),
        (-3, 1, 160, 70, 70, 255), (-2, 1, 180, 90, 90, 255),
        (-1, 1, 160, 70, 70, 255), (0, 1, 180, 90, 90, 255),
        (1, 1, 160, 70, 70, 255), (2, 1, 180, 90, 90, 255),
        (3, 1, 160, 70, 70, 255), (4, 1, 180, 90, 90, 255),
        (5, 1, 70, 70, 94, 255),
    ]),
    "up": _make_pattern([
        (-3, -1, 70, 70, 94, 255),
        (-2, -1, 180, 80, 80, 255), (-1, -1, 180, 80, 80, 255),
        (0, -1, 180, 80, 80, 255), (1, -1, 180, 80, 80, 255),
        (2, -1, 180, 80, 80, 255), (3, -1, 180, 80, 80, 255),
        (4, -1, 70, 70, 94, 255),
        (-4, 0, 70, 70, 94, 255),
        (-3, 0, 200, 100, 100, 255), (-2, 0, 200, 100, 100, 255),
        (-1, 0, 200, 100, 100, 255), (0, 0, 200, 100, 100, 255),
        (1, 0, 200, 100, 100, 255), (2, 0, 200, 100, 100, 255),
        (3, 0, 200, 100, 100, 255), (4, 0, 200, 100, 100, 255),
        (5, 0, 70, 70, 94, 255),
        (-4, 1, 70, 70, 94, 255),
        (-3, 1, 160, 70, 70, 255), (-2, 1, 180, 90, 90, 255),
        (-1, 1, 160, 70, 70, 255), (0, 1, 180, 90, 90, 255),
        (1, 1, 160, 70, 70, 255), (2, 1, 180, 90, 90, 255),
        (3, 1, 160, 70, 70, 255), (4, 1, 180, 90, 90, 255),
        (5, 1, 70, 70, 94, 255),
    ]),
    "right": _make_pattern([
        (-2, -1, 70, 70, 94, 255),
        (-1, -1, 180, 80, 80, 255), (0, -1, 180, 80, 80, 255),
        (1, -1, 180, 80, 80, 255), (2, -1, 180, 80, 80, 255),
        (3, -1, 70, 70, 94, 255),
        (-3, 0, 70, 70, 94, 255),
        (-2, 0, 200, 100, 100, 255), (-1, 0, 200, 100, 100, 255),
        (0, 0, 200, 100, 100, 255), (1, 0, 200, 100, 100, 255),
        (2, 0, 200, 100, 100, 255), (3, 0, 200, 100, 100, 255),
        (4, 0, 70, 70, 94, 255),
        (-3, 1, 70, 70, 94, 255),
        (-2, 1, 160, 70, 70, 255), (-1, 1, 180, 90, 90, 255),
        (0, 1, 160, 70, 70, 255), (1, 1, 180, 90, 90, 255),
        (2, 1, 160, 70, 70, 255), (3, 1, 180, 90, 90, 255),
        (4, 1, 70, 70, 94, 255),
    ]),
    "left": _make_pattern([
        (-2, -1, 70, 70, 94, 255),
        (-1, -1, 180, 80, 80, 255), (0, -1, 180, 80, 80, 255),
        (1, -1, 180, 80, 80, 255), (2, -1, 180, 80, 80, 255),
        (3, -1, 70, 70, 94, 255),
        (-3, 0, 70, 70, 94, 255),
        (-2, 0, 200, 100, 100, 255), (-1, 0, 200, 100, 100, 255),
        (0, 0, 200, 100, 100, 255), (1, 0, 200, 100, 100, 255),
        (2, 0, 200, 100, 100, 255), (3, 0, 200, 100, 100, 255),
        (4, 0, 70, 70, 94, 255),
        (-3, 1, 70, 70, 94, 255),
        (-2, 1, 160, 70, 70, 255), (-1, 1, 180, 90, 90, 255),
        (0, 1, 160, 70, 70, 255), (1, 1, 180, 90, 90, 255),
        (2, 1, 160, 70, 70, 255), (3, 1, 180, 90, 90, 255),
        (4, 1, 70, 70, 94, 255),
    ]),
}

# -- Anteojos redondos -------------------------------------------------------
# Anclados al centro de la cabeza, desplazados ~+20 filas desde el top.
GLASSES_ROUND = {
    "down": _make_pattern([
        # Ojo izquierdo
        (-4, 0, 58, 58, 80, 255), (-3, 0, 58, 58, 80, 255),
        (-4, 1, 58, 58, 80, 255), (-3, 1, 180, 220, 255, 160),
        # Puente
        (-2, 0, 58, 58, 80, 255),
        # Ojo derecho
        (-1, 0, 58, 58, 80, 255), (0, 0, 58, 58, 80, 255),
        (-1, 1, 180, 220, 255, 160), (0, 1, 58, 58, 80, 255),
    ]),
    "up": _make_pattern([]),  # No visible de espaldas
    "right": _make_pattern([
        (0, 0, 58, 58, 80, 255), (1, 0, 58, 58, 80, 255),
        (0, 1, 180, 220, 255, 160), (1, 1, 58, 58, 80, 255),
        (2, 0, 58, 58, 80, 255),  # Patilla
    ]),
    "left": _make_pattern([
        (-1, 0, 58, 58, 80, 255), (0, 0, 58, 58, 80, 255),
        (-1, 1, 58, 58, 80, 255), (0, 1, 180, 220, 255, 160),
        (-2, 0, 58, 58, 80, 255),  # Patilla
    ]),
}

# -- Anteojos cuadrados ------------------------------------------------------
GLASSES_SQUARE = {
    "down": _make_pattern([
        # Ojo izquierdo
        (-5, 0, 58, 58, 80, 255), (-4, 0, 58, 58, 80, 255), (-3, 0, 58, 58, 80, 255),
        (-5, 1, 58, 58, 80, 255), (-4, 1, 200, 200, 220, 140), (-3, 1, 58, 58, 80, 255),
        # Puente
        (-2, 0, 58, 58, 80, 255),
        # Ojo derecho
        (-1, 0, 58, 58, 80, 255), (0, 0, 58, 58, 80, 255), (1, 0, 58, 58, 80, 255),
        (-1, 1, 58, 58, 80, 255), (0, 1, 200, 200, 220, 140), (1, 1, 58, 58, 80, 255),
    ]),
    "up": _make_pattern([]),
    "right": _make_pattern([
        (0, 0, 58, 58, 80, 255), (1, 0, 58, 58, 80, 255), (2, 0, 58, 58, 80, 255),
        (0, 1, 58, 58, 80, 255), (1, 1, 200, 200, 220, 140), (2, 1, 58, 58, 80, 255),
        (3, 0, 58, 58, 80, 255),  # Patilla
    ]),
    "left": _make_pattern([
        (-2, 0, 58, 58, 80, 255), (-1, 0, 58, 58, 80, 255), (0, 0, 58, 58, 80, 255),
        (-2, 1, 58, 58, 80, 255), (-1, 1, 200, 200, 220, 140), (0, 1, 58, 58, 80, 255),
        (-3, 0, 58, 58, 80, 255),  # Patilla
    ]),
}

# ---------------------------------------------------------------------------
# Generador
# ---------------------------------------------------------------------------
ACCESSORIES: dict[str, tuple[str, int, dict]] = {
    # nombre: (tipo_anclaje, offset_y_desde_top, patrones_por_dir)
    # 'hat': anclaje al top de la cabeza
    # 'glasses': anclaje al centro + offset fijo
    "cap": ("hat", 0, CAP),
    "beanie": ("hat", 0, BEANIE),
    "glasses-round": ("glasses", 20, GLASSES_ROUND),
    "glasses-square": ("glasses", 20, GLASSES_SQUARE),
}


def stamp(
    out: Image.Image,
    frame_idx: int,
    pattern: list[tuple[int, int, tuple[int, int, int, int]]],
    anchor_x: int,
    anchor_y: int,
) -> None:
    """Dibuja un patrón en el frame indicado."""
    fx = frame_idx * FRAME_W
    for dx, dy, rgba in pattern:
        px = fx + anchor_x + dx
        py = anchor_y + dy
        if 0 <= px < SHEET_W and 0 <= py < FRAME_H:
            out.putpixel((px, py), rgba)


def generate(name: str, anchor_type: str, offset_y: int, patterns: dict, frames_info: list[dict]) -> None:
    out = Image.new("RGBA", (SHEET_W, FRAME_H), (0, 0, 0, 0))
    for fi, info in enumerate(frames_info):
        d = info["dir"]
        pattern = patterns.get(d, [])
        if not pattern:
            continue
        if anchor_type == "hat":
            ay = info["top"] + offset_y
        else:  # glasses
            ay = info["top"] + offset_y
        stamp(out, fi, pattern, info["cx"], ay)

    ACC_DIR.mkdir(parents=True, exist_ok=True)
    path = ACC_DIR / f"{name}.png"
    out.save(path, optimize=True)
    print(f"  {name}.png  ({path.stat().st_size} bytes)")


def main() -> None:
    ref = AVATARS_DIR / "ash.png"
    print(f"Analizando referencia: {ref.name}")
    frames = analyze_head(ref)
    print(f"Generando accesorios en {ACC_DIR}/\n")
    for name, (anchor, offset, patterns) in ACCESSORIES.items():
        generate(name, anchor, offset, patterns, frames)
    print("\nListo.")


if __name__ == "__main__":
    main()
