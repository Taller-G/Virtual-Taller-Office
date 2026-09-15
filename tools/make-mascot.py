#!/usr/bin/env python3
"""
Draws the agent mascot's sprite sheet: the little robot that follows a player
(see `packages/shared/src/agents.ts`).

The mascot is an EVE-like hovering robot: a smooth white egg with no legs, two
arms floating free of the body, and a black visor with big glowing eyes. It
never touches the ground — it drifts above its own shadow, so the "walk" of
the animation is a faster, deeper float with the arms trailing, not a step.

The sheet is 768x24 px: 48 frames of 16x24, in the same layout as the avatars'
sheets minus the seated poses, which this robot has no use for:

  idle: right 0-5 - up 6-11 - left 12-17 - down 18-23
  walk: right 24-29 - up 30-35 - left 36-41 - down 42-47

It is deliberately small — 10 px wide against the avatars' ~16, on a frame half
the height — so that next to a person it reads as a companion and not as
another player.

`left` is never drawn: it is `right` mirrored, which is what keeps the two
profiles identical.

Development only: the result is committed in
apps/client/public/assets/mascots/robot.png.
Requires Python 3 and Pillow.

Usage:  python3 tools/make-mascot.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

OUT_PATH = Path(__file__).resolve().parents[1] / "apps/client/public/assets/mascots/robot.png"

FRAME_W, FRAME_H, FRAME_COUNT = 16, 24, 48
FRAMES_PER_ANIM = 6

# Frame order, shared with the avatars (see ANIM_START in avatars.ts).
ANIM_START = {
    ("idle", "right"): 0,
    ("idle", "up"): 6,
    ("idle", "left"): 12,
    ("idle", "down"): 18,
    ("walk", "right"): 24,
    ("walk", "up"): 30,
    ("walk", "left"): 36,
    ("walk", "down"): 42,
}

# --- palette ---------------------------------------------------------------
# Glossy white, so the edge is a soft slate rather than the avatars' near-black
# outline: a hard dark ring would make her read as heavy, which is the opposite
# of what she is.
EDGE = (90, 100, 120, 255)
SHELL = (244, 247, 252, 255)
SHELL_SH = (206, 214, 228, 255)
GLINT = (255, 255, 255, 255)
VISOR = (23, 27, 42, 255)
EYE = (127, 216, 255, 255)
EYE_DIM = (79, 158, 200, 255)
SHADOW = (32, 32, 48, 64)

# --- shapes ----------------------------------------------------------------
# One silhouette, not a head stacked on a body: EVE is a single smooth shell,
# and two outlined circles would read as a snowman. The neck is a one-pixel
# pinch at each side — enough to tell head from body without cutting the form
# in two. The head is left a little larger than the body, which is the whole
# trick of a cute character. Each row is (dy, x0, x1), both ends included.
SHELL_TOP = 3
SHELL_ROWS = [
    (0, 5, 10),
    (1, 4, 11),
    (2, 3, 12),
    (3, 3, 12),
    (4, 3, 12),
    (5, 3, 12),
    (6, 4, 11),
    (7, 5, 10),
    (8, 4, 11),
    (9, 4, 11),
    (10, 4, 11),
    (11, 4, 11),
    (12, 4, 11),
    (13, 5, 10),
    (14, 5, 10),
    (15, 6, 9),
]

# The visor: a rounded black oval inset in the face, not a band wrapped round
# the head — the corners of the shell stay white, which is what keeps it a
# face and not a helmet. Rows are relative to FACE_DY.
FACE_DY = 3
VISOR_ROWS = [(0, 5, 10), (1, 4, 11), (2, 4, 11), (3, 5, 10)]
# The eyes sit on the two middle rows, a pixel clear of the visor's rim.
EYE_DY = 1
EYES = ((5, 6), (9, 10))
# In profile only the leading eye shows, and the visor slides to that side.
VISOR_ROWS_SIDE = [(0, 7, 10), (1, 6, 11), (2, 6, 11), (3, 7, 10)]
EYES_SIDE = ((9, 10),)

# The pinch, for the profile's shoulder shade.
NECK_DY = 7

# Arms: stubby paddles floating a pixel clear of the shell, at chest height.
# Two pixels wide is all the frame has left beside a 10-wide shell, and at that
# width an outline ring would leave nothing but ring — so they are shaded by
# hand instead, light on the inner top and dark at the outer base.
ARM_TOP = 12
ARM_H = 4

# The shadow sits on the last row but one: the sprite's bottom edge is put at
# the owner's feet, so that is where the floor is, and the shell floating three
# pixels above it is what makes her hover rather than stand.
GROUND = 22


def put(im: Image.Image, x: int, y: int, color) -> None:
    if 0 <= x < FRAME_W and 0 <= y < FRAME_H:
        im.putpixel((x, y), color)


def rect(im: Image.Image, x0: int, y0: int, x1: int, y1: int, color) -> None:
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            put(im, x, y, color)


def cells_of(rows, top: int, dx: int) -> set:
    return {(x + dx, top + dy) for dy, x0, x1 in rows for x in range(x0, x1 + 1)}


def blob(im: Image.Image, rows, top: int, dx: int, fill, edge=EDGE) -> None:
    """
    Fills a shape given as rows and rings it with an edge: every pixel of the
    shape with a gap beside it (or above/below) takes the edge colour, so the
    outline follows the curve without being drawn by hand.
    """
    cells = cells_of(rows, top, dx)
    for x, y in cells:
        neighbours = ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
        put(im, x, y, edge if any(n not in cells for n in neighbours) else fill)


def draw_shadow(im: Image.Image, height: int, dx: int) -> None:
    """
    The patch of shade she floats over. It shrinks as she rises, which is what
    sells the hover: the shell moves, the ground does not.
    """
    half = max(1, 3 - (height + 1) // 2)
    alpha = max(28, SHADOW[3] - height * 12)
    rect(im, 7 - half + dx, GROUND, 8 + half + dx, GROUND, (*SHADOW[:3], alpha))


def draw_arms(im: Image.Image, direction: str, lift: int, trail: int) -> None:
    """
    The two paddles that float beside her. Mirrored, so the light falls the
    same way on both, and rounded by shading rather than by an outline.
    """
    top = ARM_TOP - lift + trail
    # (inner column, outer column) of each arm.
    if direction in ("down", "up"):
        pairs = ((2, 1), (13, 14))
    else:
        # In profile only the near arm shows; the far one is behind the shell.
        pairs = ((12, 13),)
    for inner, outer in pairs:
        for dy in range(ARM_H):
            first, last = dy == 0, dy == ARM_H - 1
            put(im, inner, top + dy, SHELL_SH if (first or last) else SHELL)
            put(im, outer, top + dy, EDGE if last else (SHELL_SH if first else SHELL))


def draw_face(im: Image.Image, direction: str, top: int, blink: bool, dx: int) -> None:
    """
    The visor and the eyes glowing in it. From behind there is no face at all,
    only the seam where the visor's rim comes round.
    """
    face = top + FACE_DY
    if direction == "up":
        rect(im, 5 + dx, face + 1, 10 + dx, face + 1, SHELL_SH)
        return

    rows, eyes = (VISOR_ROWS, EYES) if direction == "down" else (VISOR_ROWS_SIDE, EYES_SIDE)
    for dy, x0, x1 in rows:
        rect(im, x0 + dx, face + dy, x1 + dx, face + dy, VISOR)
    for ex0, ex1 in eyes:
        if blink:
            # A blink is the eye squeezed to its bottom line — a slow, friendly
            # one rather than the light going out.
            rect(im, ex0 + dx, face + EYE_DY + 1, ex1 + dx, face + EYE_DY + 1, EYE_DIM)
        else:
            rect(im, ex0 + dx, face + EYE_DY, ex1 + dx, face + EYE_DY + 1, EYE)


def draw_frame(state: str, direction: str, phase: int) -> Image.Image:
    im = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))

    if state == "walk":
        # Gliding: a deeper, quicker float, and the arms hang back.
        lift = (0, 1, 2, 2, 1, 0)[phase]
        trail = 1
        blink = False
    else:
        # Hovering in place: a slow breath, with a blink at the top of it.
        lift = (0, 0, 1, 1, 0, 0)[phase]
        trail = 0
        blink = phase == 4

    dx = 1 if direction == "right" else 0
    top = SHELL_TOP - lift

    draw_shadow(im, lift, dx)
    draw_arms(im, direction, lift, trail)

    # In profile the shell is a touch slimmer, seen edge-on.
    rows = [(dy, x0 + 1, x1 - 1) for dy, x0, x1 in SHELL_ROWS] if dx else SHELL_ROWS
    blob(im, rows, top, dx, SHELL)

    # Gloss: the highlight where the light catches the dome and the belly, and
    # the shade that rounds the underside.
    put(im, 5 + dx, top + 2, GLINT)
    put(im, 4 + dx, top + 10, GLINT)
    rect(im, 6 + dx, top + 14, 9 + dx, top + 14, SHELL_SH)
    if dx:
        # The neck pinch is lost edge-on, so a shade stands in for it.
        rect(im, 5, top + NECK_DY, 9, top + NECK_DY, SHELL_SH)

    draw_face(im, direction, top, blink, dx)
    return im


def build() -> Image.Image:
    sheet = Image.new("RGBA", (FRAME_W * FRAME_COUNT, FRAME_H), (0, 0, 0, 0))
    for (state, direction), start in ANIM_START.items():
        for phase in range(FRAMES_PER_ANIM):
            # `left` is `right` mirrored: the two profiles cannot drift apart.
            source = "right" if direction == "left" else direction
            frame = draw_frame(state, source, phase)
            if direction == "left":
                frame = frame.transpose(Image.FLIP_LEFT_RIGHT)
            sheet.paste(frame, ((start + phase) * FRAME_W, 0))
    return sheet


def main() -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    sheet = build()
    sheet.save(OUT_PATH)
    root = Path(__file__).resolve().parents[1]
    print(f"{OUT_PATH.relative_to(root)}: {sheet.size[0]}x{sheet.size[1]} px, {FRAME_COUNT} frames")


if __name__ == "__main__":
    main()
