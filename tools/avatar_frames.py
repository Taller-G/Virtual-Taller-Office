#!/usr/bin/env python3
"""
Shared knowledge about the avatar sprite sheets, for the tools that draw new
layers on top of them (`gen-hair.py`, `gen-facial-hair.py`, `gen-accessories.py`).

Every sheet is 1664x48: 52 frames of 32x48 in the LimeZu layout

    idle: right 0-5   up 6-11   left 12-17   down 18-23
    walk: right 24-29 up 30-35  left 36-41   down 42-47
    sit:  down 48     left 49   right 50     up 51

The art inside a frame is drawn at half that resolution -- every drawn pixel is
a 2x2 block -- so anything added by hand has to land on the same grid or it
reads as a different, finer sprite next to the original.  That is what `ART`,
`get_art` and `put_art` are for: they work in drawn pixels, 16 wide by 24 tall
per frame.
"""
from __future__ import annotations

from PIL import Image

FRAME_W, FRAME_H, FRAME_COUNT = 32, 48, 52
SHEET_W = FRAME_W * FRAME_COUNT
ART = 2
ART_W, ART_H = FRAME_W // ART, FRAME_H // ART

Rgba = tuple[int, int, int, int]

# Which way the character faces in each frame.  The seated frames are the ones
# worth writing down: their order is not the order of the idle and walk blocks,
# it is the one `SIT_FRAME` in packages/shared/src/avatars.ts declares.
DIR_MAP: dict[int, str] = {}
for _i in range(6):
    DIR_MAP[_i] = "right"
    DIR_MAP[6 + _i] = "up"
    DIR_MAP[12 + _i] = "left"
    DIR_MAP[18 + _i] = "down"
    DIR_MAP[24 + _i] = "right"
    DIR_MAP[30 + _i] = "up"
    DIR_MAP[36 + _i] = "left"
    DIR_MAP[42 + _i] = "down"
DIR_MAP[48] = "down"
DIR_MAP[49] = "left"
DIR_MAP[50] = "right"
DIR_MAP[51] = "up"

# The side of the head the character is turned away from, per direction: where
# a ponytail or a bun goes so it reads as being behind them.
BACK_OF_HEAD: dict[str, int] = {"down": 0, "up": 0, "left": 1, "right": -1}


def blank_sheet() -> Image.Image:
    """An empty overlay the size of an avatar sheet."""
    return Image.new("RGBA", (SHEET_W, FRAME_H), (0, 0, 0, 0))


def get_art(px, frame: int, ax: int, ay: int) -> Rgba:
    """The drawn pixel (ax, ay) of a frame; (0, 0, 0, 0) outside it."""
    if not (0 <= ax < ART_W and 0 <= ay < ART_H):
        return (0, 0, 0, 0)
    return px[frame * FRAME_W + ax * ART, ay * ART]


def put_art(px, frame: int, ax: int, ay: int, rgba: Rgba) -> None:
    """Paints the drawn pixel (ax, ay) of a frame as the 2x2 block it is."""
    if not (0 <= ax < ART_W and 0 <= ay < ART_H):
        return
    x0 = frame * FRAME_W + ax * ART
    for dy in range(ART):
        for dx in range(ART):
            px[x0 + dx, ay * ART + dy] = rgba


def art_mask(px, frame: int) -> set[tuple[int, int]]:
    """The drawn pixels of a frame that are not transparent."""
    return {
        (ax, ay)
        for ay in range(ART_H)
        for ax in range(ART_W)
        if get_art(px, frame, ax, ay)[3] > 0
    }


def row_extents(mask: set[tuple[int, int]]) -> dict[int, tuple[int, int]]:
    """For each row of a mask, its leftmost and rightmost drawn pixel."""
    rows: dict[int, tuple[int, int]] = {}
    for ax, ay in mask:
        lo, hi = rows.get(ay, (ax, ax))
        rows[ay] = (min(lo, ax), max(hi, ax))
    return rows
