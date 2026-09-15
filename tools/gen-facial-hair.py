#!/usr/bin/env python3
"""
Draws the facial hair overlays -- stubble, moustache and beard -- one sheet per
silhouette.

Development only: the result is committed in
apps/client/public/assets/avatars/layers/<base>/facial-<style>.png.
Run `tools/split-layers.py` first -- this reads the `body-default.png` it writes
to find the face.  Requires Python 3 and Pillow.

Usage:  python3 tools/gen-facial-hair.py

The face is not at the same height in every frame (the head bobs through the
walk cycle) nor in every silhouette, so each frame is measured rather than
drawn to a fixed offset: the largest patch of skin in the top half of the frame
is the face, and the three styles hang off its chin.  There is exactly one
drawn row between the eyes and the jaw on these heads, so a beard covers that
row and grows downwards past the jaw rather than up over the face.  Frames
facing away have no face and stay empty, exactly like the glasses.

The sheets are greyscale so the layer can take the hair colour: a beard is the
same hair, and the game tints both with `hairColor`.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

from avatar_frames import (
    ART_W,
    DIR_MAP,
    FRAME_COUNT,
    blank_sheet,
    get_art,
    put_art,
    row_extents,
)

LAYERS_DIR = Path(__file__).resolve().parents[1] / "apps/client/public/assets/avatars/layers"
BASES = ["adam", "ash", "lucy", "nancy"]
STYLES = ["stubble", "mustache", "beard"]

# Skin, as split-layers.py leaves it in body-default.png.
SKIN = {
    (199, 140, 89),
    (211, 163, 141),
    (246, 174, 159),
    (255, 203, 176),
    (255, 184, 147),
    (246, 151, 132),
}

# Below this row the skin is hands and forearms, not a face.
FACE_BOTTOM = 16
# A face has at least this many drawn pixels; less than that is an ear or a
# hand and the frame is one facing away.
FACE_MIN = 12

SHADE = {"light": 235, "base": 185, "dark": 130}
# Stubble is a shadow on the skin rather than a mass of hair, and a 16x24 face
# has no room to draw one pixel at a time: it is painted see-through instead so
# the skin still reads underneath.
STUBBLE_ALPHA = 115


class Face:
    """Where the face of one frame is, in drawn pixels."""

    def __init__(self, mask: set[tuple[int, int]]) -> None:
        self.rows = row_extents(mask)
        self.chin = max(self.rows)
        self.top = min(self.rows)

    def edges(self, ay: int) -> tuple[int, int]:
        return self.rows.get(ay, self.rows[self.chin])

    def center(self, ay: int) -> int:
        lo, hi = self.edges(ay)
        return (lo + hi) // 2


def face_of(px, frame: int) -> Face | None:
    """The biggest patch of skin in the head of this frame, or None if it faces away."""
    skin = {
        (ax, ay)
        for ay in range(FACE_BOTTOM)
        for ax in range(ART_W)
        if get_art(px, frame, ax, ay)[:3] in SKIN and get_art(px, frame, ax, ay)[3] > 0
    }
    best: set[tuple[int, int]] = set()
    while skin:
        seed = skin.pop()
        patch = {seed}
        edge = [seed]
        while edge:
            ax, ay = edge.pop()
            for nb in ((ax + 1, ay), (ax - 1, ay), (ax, ay + 1), (ax, ay - 1)):
                if nb in skin:
                    skin.remove(nb)
                    patch.add(nb)
                    edge.append(nb)
        if len(patch) > len(best):
            best = patch
    return Face(best) if len(best) >= FACE_MIN else None


# ---------------------------------------------------------------------------
# The styles.  Each returns the drawn pixels to add: (ax, ay, shade).
# ---------------------------------------------------------------------------
def style_stubble(face: Face) -> list[tuple[int, int, int]]:
    """A few days unshaven: a shadow over the chin and along the jaw."""
    out: list[tuple[int, int, int]] = []
    lo, hi = face.edges(face.chin)
    for ax in range(lo, hi + 1):
        out.append((ax, face.chin, SHADE["light"]))
    for ax in range(lo + 1, hi):
        out.append((ax, face.chin + 1, SHADE["base"]))
    return out


def style_mustache(face: Face) -> list[tuple[int, int, int]]:
    """A bar across the middle of the chin row, under the nose."""
    lo, hi = face.edges(face.chin)
    cx = (lo + hi) // 2
    return [
        (ax, face.chin, SHADE["base"] if ax in (cx - 1, cx) else SHADE["dark"])
        for ax in range(max(cx - 2, lo), min(cx + 2, hi + 1))
    ]


def style_beard(face: Face) -> list[tuple[int, int, int]]:
    """A full beard: the chin covered, a row past the jaw, sideburns up the cheeks."""
    out: list[tuple[int, int, int]] = []
    lo, hi = face.edges(face.chin)
    for ax in range(lo, hi + 1):
        out.append((ax, face.chin, SHADE["light"]))
    for ax in range(lo + 1, hi):
        out.append((ax, face.chin + 1, SHADE["base"]))
    for ax in (lo, hi):
        out.append((ax, face.chin - 1, SHADE["dark"]))
    return out


STYLE_FNS = {"stubble": style_stubble, "mustache": style_mustache, "beard": style_beard}


# ---------------------------------------------------------------------------
# Generator
# ---------------------------------------------------------------------------
def generate(base: str) -> None:
    body_path = LAYERS_DIR / base / "body-default.png"
    if not body_path.exists():
        raise SystemExit(f"{body_path} is missing -- run tools/split-layers.py first")
    body = Image.open(body_path).convert("RGBA").load()

    faces = {}
    for frame in range(FRAME_COUNT):
        if DIR_MAP[frame] == "up":
            continue  # the back of a head has no beard on it
        face = face_of(body, frame)
        if face is not None:
            faces[frame] = face

    for style in STYLES:
        sheet = blank_sheet()
        px = sheet.load()
        alpha = STUBBLE_ALPHA if style == "stubble" else 255
        for frame, face in faces.items():
            for ax, ay, shade in STYLE_FNS[style](face):
                put_art(px, frame, ax, ay, (shade, shade, shade, alpha))
        out = LAYERS_DIR / base / f"facial-{style}.png"
        sheet.save(out, optimize=True)
        print(f"  {base}/facial-{style}.png")


def main() -> None:
    print(f"Drawing facial hair in {LAYERS_DIR}/\n")
    for base in BASES:
        print(f"[{base}]")
        generate(base)
        print()
    print("Done.")


if __name__ == "__main__":
    main()
