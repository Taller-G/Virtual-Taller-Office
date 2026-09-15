#!/usr/bin/env python3
"""
Draws the four hair styles that are not the character's own cut, one sheet per
silhouette: long, bun, curly and ponytail.

Development only: the result is committed in
apps/client/public/assets/avatars/layers/<base>/hair-<style>.png.
Run `tools/split-layers.py` first -- this reads the `hair-short.png` it writes.
Requires Python 3 and Pillow.

Usage:  python3 tools/gen-hair.py

Every style is the character's own cut plus geometry drawn around it, never a
replacement.  The reason is in the art: the dark outline that rings the hair
lives in the body layer, and on lucy and nancy the hair also covers a piece of
the shoulders, so a style smaller than the cut it replaces would leave an empty
outline floating over a hole.  Growing the silhouette instead keeps all four
heads intact, keeps every frame aligned for free, and still gives five clearly
different shapes per silhouette.

The additions are greyscale, like the layer they extend, so they take the
chosen hair colour with the rest of the hair; the shades are sampled from the
cut itself so a new strand sits in the same palette.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

from avatar_frames import (
    ART_H,
    BACK_OF_HEAD,
    DIR_MAP,
    FRAME_COUNT,
    art_mask,
    put_art,
    row_extents,
)

LAYERS_DIR = Path(__file__).resolve().parents[1] / "apps/client/public/assets/avatars/layers"
BASES = ["adam", "ash", "lucy", "nancy"]
STYLES = ["long", "bun", "curly", "ponytail"]

# Rows every character shares, in drawn pixels: the shoulders are where hair
# that falls past the jaw starts covering the shirt, and nothing hangs below
# the waist.
SHOULDER_ROW = 15
LONGEST_ROW = 19


class Palette:
    """The three shades of a hair layer, brightest first."""

    def __init__(self, px, frames: int) -> None:
        seen: dict[int, int] = {}
        for x in range(frames * 32):
            for y in range(48):
                r, _, _, a = px[x, y]
                if a:
                    seen[r] = seen.get(r, 0) + 1
        shades = sorted(seen, reverse=True) or [255, 200, 150]
        self.light = shades[0]
        self.base = shades[len(shades) // 2]
        self.dark = shades[-1]

    def rgba(self, shade: int) -> tuple[int, int, int, int]:
        return (shade, shade, shade, 255)


class Head:
    """Where the hair of one frame sits, in drawn pixels."""

    def __init__(self, mask: set[tuple[int, int]]) -> None:
        self.mask = mask
        self.rows = row_extents(mask)
        self.top = min(self.rows)
        self.bottom = max(self.rows)
        self.left = min(lo for lo, _ in self.rows.values())
        self.right = max(hi for _, hi in self.rows.values())
        # The widest row is the one at ear height: where hair falls from.
        self.ear = max(self.rows, key=lambda ay: self.rows[ay][1] - self.rows[ay][0])

    @property
    def center(self) -> int:
        lo, hi = self.rows[self.ear]
        return (lo + hi) // 2

    def edges(self, ay: int) -> tuple[int, int]:
        """The hair's edges at this row, or the widest ones once past its end."""
        return self.rows.get(ay, self.rows[self.ear])

    def hangs_from(self, side: int) -> tuple[int, int]:
        """
        Where hair falling on one side (-1 left, +1 right) leaves the cut.

        It is the lowest row whose edge is still out at the side of the head,
        not the lowest row of the mask: that one is usually the fringe, in the
        middle of the face, and a strand started there would fall over the
        eyes.
        """
        target = self.left if side < 0 else self.right
        outer = [
            ay
            for ay, (lo, hi) in self.rows.items()
            if abs((lo if side < 0 else hi) - target) <= 1
        ]
        ay = max(outer)
        lo, hi = self.rows[ay]
        return (lo if side < 0 else hi), ay


# ---------------------------------------------------------------------------
# The styles.  Each returns the drawn pixels to add: (ax, ay, shade).
# ---------------------------------------------------------------------------
def style_long(head: Head, direction: str, pal: Palette) -> list[tuple[int, int, int]]:
    """Hair falling past the jaw: a sheet down the back, strands at the sides."""
    out: list[tuple[int, int, int]] = []
    if direction == "up":
        lo, hi = head.edges(head.bottom)
        for ay in range(head.bottom + 1, LONGEST_ROW + 1):
            inset = 1 if ay >= LONGEST_ROW - 1 else 0
            for ax in range(lo + inset, hi + 1 - inset):
                out.append((ax, ay, pal.base))
        for ax in range(lo + 1, hi):
            out.append((ax, LONGEST_ROW, pal.dark))
        return out
    for side in (-1, 1):
        ax, ay = head.hangs_from(side)
        for row in range(ay + 1, LONGEST_ROW + 1):
            out.append((ax, row, pal.base if row < SHOULDER_ROW else pal.dark))
        # A second column further out, one row shorter at each end, so the
        # strand has a shape instead of being a bar.
        for row in range(ay + 2, LONGEST_ROW):
            out.append((ax + side, row, pal.base))
    return out


def style_bun(head: Head, direction: str, pal: Palette) -> list[tuple[int, int, int]]:
    """A knot on top of the head, set back a little when seen from the side."""
    cx = head.center + BACK_OF_HEAD[direction]
    out: list[tuple[int, int, int]] = []
    for ax in range(cx - 1, cx + 2):
        out.append((ax, head.top - 2, pal.base))
    for ax in range(cx - 2, cx + 3):
        out.append((ax, head.top - 1, pal.light if ax == cx - 1 else pal.base))
    # It has to meet the head, or it floats when the cut is a low one.
    for ax in range(cx - 2, cx + 3):
        out.append((ax, head.top, pal.base))
    return out


def style_curly(head: Head, direction: str, pal: Palette) -> list[tuple[int, int, int]]:
    """Volume: bumps along the top and the sides break the smooth edge."""
    out: list[tuple[int, int, int]] = []
    lo, hi = head.rows[head.top]
    for ax in range(lo, hi + 1, 2):
        out.append((ax, head.top - 1, pal.light))
    for ay in range(head.top, min(head.ear + 2, ART_H)):
        if (ay - head.top) % 2:
            continue
        left, right = head.edges(ay)
        out.append((left - 1, ay, pal.base))
        out.append((right + 1, ay, pal.base))
    # A couple of curls inside the mass, so it is not only an outline.
    for ax in range(lo + 1, hi, 3):
        out.append((ax, head.top + 2, pal.dark))
    return out


def style_ponytail(head: Head, direction: str, pal: Palette) -> list[tuple[int, int, int]]:
    """A tail tied at the back: down the middle from behind, out to one side in profile."""
    out: list[tuple[int, int, int]] = []
    back = BACK_OF_HEAD[direction]
    if direction == "up":
        cx = head.center
        for ax in range(cx - 2, cx + 2):
            out.append((ax, head.bottom, pal.dark))  # the tie
        for ay in range(head.bottom + 1, LONGEST_ROW + 1):
            out.append((cx - 1, ay, pal.base))
            out.append((cx, ay, pal.light))
            if ay < LONGEST_ROW - 1:
                out.append((cx + 1, ay, pal.base))
        out.append((cx, LONGEST_ROW + 1, pal.dark))
        return out
    if direction == "down":
        # From the front only the ends of the tail show, past the ears.
        for side in (-1, 1):
            ax, ay = head.hangs_from(side)
            for row in (ay - 1, ay):
                out.append((ax + side, row, pal.dark if row == ay else pal.base))
        return out
    ax, ay = head.hangs_from(back)
    tail = ax + back
    out.append((ax, ay - 1, pal.dark))  # the tie
    for row in range(ay - 1, ay + 4):
        out.append((tail, row, pal.light if row % 2 else pal.base))
    out.append((tail + back, ay + 2, pal.base))
    out.append((tail + back, ay + 3, pal.dark))
    return out


STYLE_FNS = {
    "long": style_long,
    "bun": style_bun,
    "curly": style_curly,
    "ponytail": style_ponytail,
}


# ---------------------------------------------------------------------------
# Generator
# ---------------------------------------------------------------------------
def generate(base: str) -> None:
    cut_path = LAYERS_DIR / base / "hair-short.png"
    if not cut_path.exists():
        raise SystemExit(f"{cut_path} is missing -- run tools/split-layers.py first")
    cut = Image.open(cut_path).convert("RGBA")
    pal = Palette(cut.load(), FRAME_COUNT)

    for style in STYLES:
        sheet = cut.copy()
        px = sheet.load()
        for frame in range(FRAME_COUNT):
            mask = art_mask(cut.load(), frame)
            if not mask:
                continue
            head = Head(mask)
            for ax, ay, shade in STYLE_FNS[style](head, DIR_MAP[frame], pal):
                put_art(px, frame, ax, ay, pal.rgba(shade))
        out = LAYERS_DIR / base / f"hair-{style}.png"
        sheet.save(out, optimize=True)
        print(f"  {base}/hair-{style}.png")


def main() -> None:
    print(f"Drawing hair styles in {LAYERS_DIR}/\n")
    for base in BASES:
        print(f"[{base}]")
        generate(base)
        print()
    print("Done.")


if __name__ == "__main__":
    main()
