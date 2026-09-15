#!/usr/bin/env python3
"""
Draws the agent mascot's sprite sheet: the little robot that walks behind a
player (see `packages/shared/src/agents.ts`).

The sheet is 768x24 px: 48 frames of 16x24, in the same layout as the avatars'
sheets minus the seated poses, which a robot has no use for:

  idle: right 0-5 - up 6-11 - left 12-17 - down 18-23
  walk: right 24-29 - up 30-35 - left 36-41 - down 42-47

The robot is deliberately small — 10 px wide against the avatars' ~16, on a
frame half the height — so that next to a person it reads as a companion and
not as another player. The palette is the avatars' own dark navy (#3a3a50 is
the darkest colour in every LimeZu sheet) plus a violet accent, the same one
the Focused badge and the Chiron doorways use.

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
OUT = (58, 58, 80, 255)  # #3a3a50, the avatars' darkest colour
PLATE = (185, 194, 214, 255)
PLATE_SH = (142, 152, 178, 255)
PLATE_HI = (224, 230, 242, 255)
VISOR = (42, 51, 80, 255)
EYE = (95, 214, 224, 255)
EYE_DIM = (58, 150, 170, 255)
ACCENT = (160, 120, 255, 255)
ACCENT_DIM = (109, 72, 196, 255)
SHADOW = (32, 32, 48, 70)

# --- body plan (y of the frame, feet on row 21, shadow on 22) --------------
HEAD_TOP, HEAD_BOTTOM = 4, 10
BODY_TOP, BODY_BOTTOM = 12, 17
LEG_TOP, LEG_BOTTOM = 18, 21


def rect(im: Image.Image, x0: int, y0: int, x1: int, y1: int, color) -> None:
    """Filled rectangle, both ends included, clipped to the frame."""
    for y in range(max(0, y0), min(FRAME_H - 1, y1) + 1):
        for x in range(max(0, x0), min(FRAME_W - 1, x1) + 1):
            im.putpixel((x, y), color)


def box(im: Image.Image, x0: int, y0: int, x1: int, y1: int, fill, outline=OUT) -> None:
    """Outlined box with the four corners cut off (a rounded pixel-art box)."""
    rect(im, x0, y0, x1, y1, outline)
    rect(im, x0 + 1, y0 + 1, x1 - 1, y1 - 1, fill)
    for cx, cy in ((x0, y0), (x1, y0), (x0, y1), (x1, y1)):
        im.putpixel((cx, cy), (0, 0, 0, 0))


def draw_shadow(im: Image.Image) -> None:
    """The patch of shade under the robot: it never bobs, so the body does."""
    rect(im, 5, 22, 10, 22, SHADOW)
    im.putpixel((4, 22), (SHADOW[0], SHADOW[1], SHADOW[2], 40))
    im.putpixel((11, 22), (SHADOW[0], SHADOW[1], SHADOW[2], 40))


def draw_legs(im: Image.Image, direction: str, step: int, bob: int) -> None:
    """
    Two stubby legs. `step` is the phase of the walk: -1 while standing still
    (both legs down), 0 and 1 for each leg forward, which is what makes the
    walk read as a walk and not as a slide.
    """
    top = LEG_TOP + bob
    if direction in ("down", "up"):
        legs = ((5, 6), (9, 10))
        for i, (x0, x1) in enumerate(legs):
            lifted = step == i
            rect(im, x0, top, x1, LEG_BOTTOM - (1 if lifted else 0), OUT)
            rect(im, x0, top, x1, top + 1, PLATE_SH if lifted else PLATE)
    else:
        # In profile one leg is in front of the other: the back one is darker.
        front, back = (8, 9), (6, 7)
        for i, (x0, x1) in enumerate((back, front)):
            forward = step == i
            shade = PLATE if i == 1 else PLATE_SH
            rect(im, x0, top, x1, LEG_BOTTOM - (1 if forward else 0), OUT)
            rect(im, x0, top, x1, top + 1, shade)


def draw_body(im: Image.Image, direction: str, bob: int, step: int) -> None:
    top, bottom = BODY_TOP + bob, BODY_BOTTOM + bob
    if direction in ("down", "up"):
        box(im, 4, top, 11, bottom, PLATE)
        # Arms: a nub each side, swinging a pixel with the step.
        for i, x in enumerate((3, 12)):
            arm_top = top + 1 + (1 if step == i else 0)
            rect(im, x, arm_top, x, arm_top + 2, OUT)
        if direction == "down":
            rect(im, 5, top + 1, 10, top + 1, PLATE_HI)
            rect(im, 7, top + 2, 8, top + 3, ACCENT)  # chest light
            rect(im, 6, bottom - 1, 9, bottom - 1, PLATE_SH)
        else:
            # Seen from behind: a vented back plate, no light.
            rect(im, 6, top + 2, 9, top + 2, PLATE_SH)
            rect(im, 6, top + 4, 9, top + 4, PLATE_SH)
    else:
        box(im, 5, top, 10, bottom, PLATE)
        rect(im, 6, top + 1, 9, top + 1, PLATE_HI)
        rect(im, 6, bottom - 1, 9, bottom - 1, PLATE_SH)
        im.putpixel((9, top + 3), ACCENT)  # the light, on the front
        # The arm nearest us, swinging.
        arm_top = top + 1 + (1 if step == 1 else 0)
        rect(im, 4, arm_top, 4, arm_top + 2, OUT)
    # Neck
    rect(im, 7, HEAD_BOTTOM + 1 + bob, 8, HEAD_BOTTOM + 1 + bob, OUT)


def draw_head(im: Image.Image, direction: str, bob: int, lit: bool) -> None:
    top, bottom = HEAD_TOP + bob, HEAD_BOTTOM + bob

    # Antenna, with its light blinking on the idle cycle.
    rect(im, 8, top - 1, 8, top - 1, OUT)
    im.putpixel((8, top - 2), ACCENT if lit else ACCENT_DIM)

    if direction in ("down", "up"):
        box(im, 3, top, 12, bottom, PLATE)
        rect(im, 4, top + 1, 11, top + 1, PLATE_HI)
        if direction == "down":
            rect(im, 4, top + 2, 11, top + 4, VISOR)
            rect(im, 5, top + 3, 6, top + 3, EYE)
            rect(im, 9, top + 3, 10, top + 3, EYE)
        else:
            # The back of the head: a panel with two vents, and no eyes.
            rect(im, 5, top + 3, 10, top + 3, PLATE_SH)
            rect(im, 5, top + 5, 10, top + 5, PLATE_SH)
    else:
        # In profile the head leans a pixel towards where it is looking.
        box(im, 4, top, 12, bottom, PLATE)
        rect(im, 5, top + 1, 11, top + 1, PLATE_HI)
        rect(im, 8, top + 2, 11, top + 4, VISOR)
        rect(im, 10, top + 3, 11, top + 3, EYE)
        rect(im, 5, top + 5, 7, top + 5, PLATE_SH)  # nape


def draw_frame(state: str, direction: str, phase: int) -> Image.Image:
    """One frame: `phase` is 0..5 within its animation."""
    im = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))

    if state == "walk":
        # Legs alternate every half cycle; the body lifts a pixel mid-stride.
        step = 0 if phase < 3 else 1
        bob = -1 if phase in (1, 4) else 0
        lit = True
    else:
        # Standing: a slow breath and the antenna light blinking.
        step = -1
        bob = -1 if phase in (2, 3) else 0
        lit = phase < 4

    draw_shadow(im)
    draw_legs(im, direction, step, bob)
    draw_body(im, direction, bob, step)
    draw_head(im, direction, bob, lit)

    if state == "idle" and not lit:
        # A dimmer eye on the off beat: it reads as "waiting", not as broken.
        for x in range(FRAME_W):
            for y in range(FRAME_H):
                if im.getpixel((x, y)) == EYE:
                    im.putpixel((x, y), EYE_DIM)
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
    print(f"{OUT_PATH.relative_to(Path(__file__).resolve().parents[1])}: {sheet.size[0]}x{sheet.size[1]} px, {FRAME_COUNT} frames")


if __name__ == "__main__":
    main()
