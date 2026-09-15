#!/usr/bin/env python3
"""
Draws the agent mascots' sprite sheets: the little companions that follow a
player (see `AGENT_TYPES` in `packages/shared/src/agents.ts`).

One sheet per type in the catalogue, all in the same frame:

  robot    an EVE-like hovering robot: a smooth white egg with no legs, two
           arms floating free of the body, and a black visor with big glowing
           eyes. It never touches the ground - it drifts above its own shadow,
           so the "walk" of the animation is a faster, deeper float, not a
           step.
  classic  the boxy grey robot: a square head on an antenna, a panelled chest
           and two stubby legs that actually walk.
  duck     a yellow duck with an orange bill and orange feet, waddling.
  cat      a ginger cat with pricked ears and a tail that sways as it trots.

Each sheet is 768x24 px: 48 frames of 16x24, in the same layout as the
avatars' sheets minus the seated poses, which a mascot has no use for:

  idle: right 0-5 - up 6-11 - left 12-17 - down 18-23
  walk: right 24-29 - up 30-35 - left 36-41 - down 42-47

They are deliberately small - some 10 px wide against the avatars' ~16, on a
frame half the height - so that next to a person they read as a companion and
not as another player.

`left` is never drawn: it is `right` mirrored, which is what keeps the two
profiles identical.

Development only: the results are committed in
apps/client/public/assets/mascots/<id>.png.
Requires Python 3 and Pillow.

Usage:  python3 tools/make-mascot.py            # every type
        python3 tools/make-mascot.py duck cat   # only these
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "apps/client/public/assets/mascots"

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

# ---------------------------------------------------------------------------
# Drawing helpers, shared by every type
# ---------------------------------------------------------------------------

def put(im: Image.Image, x: int, y: int, color) -> None:
    if 0 <= x < FRAME_W and 0 <= y < FRAME_H:
        im.putpixel((x, y), color)


def rect(im: Image.Image, x0: int, y0: int, x1: int, y1: int, color) -> None:
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            put(im, x, y, color)


def cells_of(rows, top: int, dx: int) -> set:
    return {(x + dx, top + dy) for dy, x0, x1 in rows for x in range(x0, x1 + 1)}


def blob(im: Image.Image, rows, top: int, dx: int, fill, edge) -> None:
    """
    Fills a shape given as rows and rings it with an edge: every pixel of the
    shape with a gap beside it (or above/below) takes the edge colour, so the
    outline follows the curve without being drawn by hand.
    """
    cells = cells_of(rows, top, dx)
    for x, y in cells:
        neighbours = ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
        put(im, x, y, edge if any(n not in cells for n in neighbours) else fill)


# ---------------------------------------------------------------------------
# The robot: an EVE-like hovering shell
# ---------------------------------------------------------------------------

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


def draw_robot(state: str, direction: str, phase: int) -> Image.Image:
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
    blob(im, rows, top, dx, SHELL, EDGE)

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




# ---------------------------------------------------------------------------
# The classic bot: the boxy grey robot that walks
# ---------------------------------------------------------------------------

# Everything about him is the opposite of the white shell above: straight
# edges, a hard outline, and legs that take a step. That contrast is the whole
# point of having the two in the catalogue - at 16 px a difference of colour
# alone would not read across the room.
BOT_EDGE = (40, 44, 58, 255)
BOT_BODY = (150, 158, 176, 255)
BOT_LIGHT = (196, 204, 220, 255)
BOT_DARK = (104, 112, 132, 255)
BOT_EYE = (255, 196, 90, 255)
BOT_EYE_DIM = (176, 130, 52, 255)
BOT_LAMP = (255, 108, 96, 255)

# The floor: where the feet land, so every type stands on the same line.
FLOOR = 22


def box(im: Image.Image, x0: int, y0: int, x1: int, y1: int, fill, edge) -> None:
    """A filled rectangle ringed by an outline: the bot is built out of these."""
    rect(im, x0, y0, x1, y1, fill)
    rect(im, x0, y0, x1, y0, edge)
    rect(im, x0, y1, x1, y1, edge)
    rect(im, x0, y0, x0, y1, edge)
    rect(im, x1, y0, x1, y1, edge)


def bot_leg(im: Image.Image, x0: int, lift: int, top: int) -> None:
    """One leg and its foot. `lift` raises it: that is the step."""
    foot = FLOOR - lift
    rect(im, x0, top, x0 + 1, foot - 1, BOT_DARK)
    rect(im, x0 - 1, foot, x0 + 2, foot, BOT_EDGE)


def bot_frame(state: str, direction: str, phase: int) -> Image.Image:
    im = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    side = direction in ("left", "right")

    if state == "walk":
        # The step: one leg up while the other holds, and the body rides a
        # pixel with it. Six phases is a stride each way.
        step = (0, 1, 0, 0, 1, 0)[phase]
        lead = phase < 3
        bob = (0, 1, 1, 0, 1, 1)[phase]
        swing = (-1, 0, 1, 1, 0, -1)[phase]
        blink = False
    else:
        step, lead, bob, swing = 0, True, 0, 0
        blink = phase == 4

    lift_l = step if lead else 0
    lift_r = 0 if lead else step
    top = 4 + bob  # top of the head

    # Legs, drawn first so the body's outline closes over them.
    if side:
        # In profile the legs swap places instead of lifting: one in front.
        bot_leg(im, 6 - swing, 0, top + 13)
        bot_leg(im, 8 + swing, 0, top + 13)
    else:
        bot_leg(im, 5, lift_l, top + 13)
        bot_leg(im, 9, lift_r, top + 13)

    # Antenna with its lamp: the only thing that is never grey.
    stalk = 8 if not side else 7
    rect(im, stalk, top - 2, stalk, top - 1, BOT_EDGE)
    put(im, stalk, top - 3, BOT_LAMP if not blink else BOT_EYE_DIM)

    # Head, neck, chest.
    head_x = (5, 10) if side else (4, 11)
    box(im, head_x[0], top, head_x[1], top + 5, BOT_BODY, BOT_EDGE)
    rect(im, head_x[0] + 1, top + 1, head_x[1] - 1, top + 1, BOT_LIGHT)
    rect(im, 7, top + 6, 8, top + 6, BOT_DARK)

    body_x = (5, 10) if side else (4, 11)
    box(im, body_x[0], top + 7, body_x[1], top + 12, BOT_BODY, BOT_EDGE)
    # The chest panel, a shade darker, with a light seam across it.
    rect(im, body_x[0] + 2, top + 9, body_x[1] - 2, top + 11, BOT_DARK)
    rect(im, body_x[0] + 2, top + 9, body_x[1] - 2, top + 9, BOT_LIGHT)

    # Arms: one column each side, swinging with the step.
    if side:
        rect(im, 11, top + 8 + swing, 11, top + 11 + swing, BOT_DARK)
        put(im, 11, top + 12 + swing, BOT_EDGE)
    else:
        for x, sw in ((3, swing), (12, -swing)):
            rect(im, x, top + 8 + sw, x, top + 11 + sw, BOT_DARK)
            put(im, x, top + 12 + sw, BOT_EDGE)

    # The face: two square eyes behind a visor slot. From behind, only a plate.
    if direction == "up":
        rect(im, head_x[0] + 1, top + 2, head_x[1] - 1, top + 3, BOT_DARK)
    else:
        eyes = ((8, 9),) if side else ((5, 6), (9, 10))
        rect(im, head_x[0] + 1, top + 2, head_x[1] - 1, top + 3, BOT_EDGE)
        for ex0, ex1 in eyes:
            if blink:
                rect(im, ex0, top + 3, ex1, top + 3, BOT_EYE_DIM)
            else:
                rect(im, ex0, top + 2, ex1, top + 3, BOT_EYE)

    return im


# ---------------------------------------------------------------------------
# The duck
# ---------------------------------------------------------------------------

DUCK_EDGE = (120, 78, 26, 255)
DUCK_BODY = (248, 212, 84, 255)
DUCK_SHADE = (214, 168, 48, 255)
DUCK_LIGHT = (255, 238, 160, 255)
DUCK_BILL = (246, 150, 40, 255)
DUCK_BILL_DK = (202, 110, 22, 255)
DUCK_EYE = (34, 30, 38, 255)

# Head and body as rows, the way the shell above is described: (dy, x0, x1).
DUCK_HEAD = [(0, 6, 9), (1, 5, 10), (2, 5, 10), (3, 5, 10), (4, 6, 9)]
DUCK_HEAD_SIDE = [(0, 6, 9), (1, 5, 10), (2, 5, 10), (3, 5, 10), (4, 6, 10)]
DUCK_BODY_ROWS = [
    (0, 5, 10),
    (1, 4, 11),
    (2, 3, 12),
    (3, 3, 12),
    (4, 3, 12),
    (5, 4, 11),
    (6, 5, 10),
]
DUCK_BODY_SIDE = [
    (0, 5, 10),
    (1, 4, 11),
    (2, 2, 12),
    (3, 2, 12),
    (4, 3, 12),
    (5, 4, 11),
    (6, 5, 10),
]


def duck_foot(im: Image.Image, x0: int, lift: int) -> None:
    """A webbed foot: three pixels wide, flat on the floor unless it is lifted."""
    y = FLOOR - lift
    rect(im, x0, y, x0 + 2, y, DUCK_BILL)
    put(im, x0 + 1, y - 1, DUCK_BILL_DK)


def duck_frame(state: str, direction: str, phase: int) -> Image.Image:
    im = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    side = direction in ("left", "right")

    if state == "walk":
        # The waddle: the body rocks from one foot to the other, and the head
        # leans the way the weight goes. It is the rock, not the legs, that
        # makes a duck read as a duck.
        bob = (0, 1, 1, 0, 1, 1)[phase]
        lean = (-1, -1, 0, 1, 1, 0)[phase]
        step = (1, 0, 0, 1, 0, 0)[phase]
        lead = phase < 3
        blink = False
    else:
        bob, lean, step, lead = 0, 0, 0, True
        blink = phase == 4

    # The body sits low enough for the feet to touch it: a duck has almost no
    # leg, and a gap between belly and feet reads as a duck hanging in the air.
    body_top = 14 + bob
    head_top = 7 + bob

    duck_foot(im, 4, step if lead else 0)
    duck_foot(im, 9, 0 if lead else step)

    rows = DUCK_BODY_SIDE if side else DUCK_BODY_ROWS
    blob(im, rows, body_top, 0, DUCK_BODY, DUCK_EDGE)
    # The wing: a folded shade with a lighter belly under it.
    if side:
        rect(im, 4, body_top + 2, 8, body_top + 3, DUCK_SHADE)
        put(im, 4, body_top + 2, DUCK_EDGE)
        # The tail cocks up at the back.
        rect(im, 2, body_top + 1, 3, body_top + 1, DUCK_BODY)
        put(im, 2, body_top, DUCK_EDGE)
    else:
        rect(im, 4, body_top + 2, 5, body_top + 4, DUCK_SHADE)
        rect(im, 10, body_top + 2, 11, body_top + 4, DUCK_SHADE)
        rect(im, 6, body_top + 4, 9, body_top + 4, DUCK_LIGHT)

    # The neck is a two-pixel column, which is what leaves room for a head
    # that big on a body that small.
    rect(im, 7 + lean, body_top - 2, 8 + lean, body_top, DUCK_BODY)

    head_rows = DUCK_HEAD_SIDE if side else DUCK_HEAD
    blob(im, head_rows, head_top, lean, DUCK_BODY, DUCK_EDGE)

    if direction == "up":
        # From behind there is no face: the back of the head and the neck.
        rect(im, 6 + lean, head_top + 3, 9 + lean, head_top + 3, DUCK_SHADE)
        return im

    if side:
        # The bill points the way it is going; the near eye sits above it.
        rect(im, 11 + lean, head_top + 2, 13 + lean, head_top + 3, DUCK_BILL)
        rect(im, 11 + lean, head_top + 3, 13 + lean, head_top + 3, DUCK_BILL_DK)
        put(im, 9 + lean, head_top + 1 + (1 if blink else 0), DUCK_EYE)
    else:
        rect(im, 6 + lean, head_top + 3, 9 + lean, head_top + 4, DUCK_BILL)
        rect(im, 6 + lean, head_top + 4, 9 + lean, head_top + 4, DUCK_BILL_DK)
        for ex in (6 + lean, 9 + lean):
            put(im, ex, head_top + 1 + (1 if blink else 0), DUCK_EYE)
    return im


# ---------------------------------------------------------------------------
# The cat
# ---------------------------------------------------------------------------

CAT_EDGE = (86, 50, 30, 255)
CAT_FUR = (232, 150, 72, 255)
CAT_SHADE = (196, 112, 48, 255)
CAT_LIGHT = (252, 206, 148, 255)
CAT_EYE = (86, 198, 148, 255)
CAT_NOSE = (226, 128, 140, 255)

# A cat is a big round head on a small body: exaggerating that is what keeps
# it from reading as a crate at this size. The head is drawn six rows tall and
# eight wide, the body six by six, and the ears sit straight on top of the
# head so the outline rings all three as one silhouette.
CAT_HEAD = [(0, 4, 11), (1, 4, 11), (2, 4, 11), (3, 4, 11), (4, 5, 10), (5, 6, 9)]
CAT_HEAD_SIDE = [(0, 5, 12), (1, 5, 12), (2, 5, 12), (3, 5, 12), (4, 6, 11), (5, 7, 10)]

# The ears stand on the head's top corners: (base x0, base x1, tip x) each.
# A flat-topped head is what gives them something to stand on - drawn over a
# domed one they float, and two floating triangles read as flowers.
CAT_EARS = ((4, 5, 4), (10, 11, 11))
CAT_EARS_SIDE = ((5, 6, 5), (10, 11, 11))
CAT_BODY_ROWS = [(0, 5, 10), (1, 4, 11), (2, 4, 11), (3, 4, 11), (4, 5, 10), (5, 5, 10)]
CAT_BODY_SIDE = [(0, 4, 10), (1, 3, 11), (2, 2, 11), (3, 2, 11), (4, 3, 10), (5, 4, 9)]

HEAD_TOP = 9
BODY_TOP = 15

# The tail as the pixels it runs through, from where it leaves the body up to
# the tip; the tip is the one that sways, because a tail moving as one block
# reads as a stick. Mirrored with the rest for `left`.
CAT_TAIL = [(12, 18), (12, 17), (13, 16), (13, 15)]
CAT_TAIL_TIP = (13, 14)
CAT_TAIL_SIDE = [(1, 18), (1, 17), (1, 16), (1, 15)]
CAT_TAIL_TIP_SIDE = (1, 14)


def cat_paw(im: Image.Image, x0: int, lift: int) -> None:
    """A front paw: two pixels of fur with the toes picked out under them."""
    y = FLOOR - lift
    rect(im, x0, y - 1, x0 + 1, y, CAT_FUR)
    rect(im, x0, y, x0 + 1, y, CAT_EDGE)


def cat_ears(im: Image.Image, ears, top: int, inner) -> None:
    """Two pricked triangles, two rows tall, standing on the head's corners."""
    for x0, x1, tip in ears:
        rect(im, x0, top - 1, x1, top - 1, CAT_FUR)
        put(im, tip, top - 2, CAT_EDGE)
        put(im, x0 + x1 - tip, top - 1, inner)


def cat_tail(im: Image.Image, side: bool, bob: int, sway: int) -> None:
    path = CAT_TAIL_SIDE if side else CAT_TAIL
    tip = CAT_TAIL_TIP_SIDE if side else CAT_TAIL_TIP
    for i, (x, y) in enumerate(path):
        put(im, x, y + bob, CAT_FUR if i else CAT_SHADE)
    put(im, tip[0] + sway, tip[1] + bob, CAT_FUR)
    put(im, tip[0] + sway, tip[1] - 1 + bob, CAT_EDGE)


def cat_frame(state: str, direction: str, phase: int) -> Image.Image:
    im = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    side = direction in ("left", "right")

    if state == "walk":
        # A trot: the body rides half a pixel, the paws take turns and the
        # tail swings the other way, which is what makes it look driven by the
        # step rather than glued on.
        bob = (0, 1, 1, 0, 1, 1)[phase]
        step = (1, 0, 0, 1, 0, 0)[phase]
        lead = phase < 3
        sway = (-1, -1, 0, 1, 1, 0)[phase]
        blink = False
    else:
        bob, step, lead = 0, 0, True
        # Sitting still, only the tail is alive - and the eyes, once a cycle.
        sway = (0, 0, 1, 1, 0, 0)[phase]
        blink = phase == 4

    head_top = HEAD_TOP + bob
    body_top = BODY_TOP + bob
    # Paws first: the body's outline closes over their tops.
    if side:
        cat_paw(im, 3, step if lead else 0)
        cat_paw(im, 8, 0 if lead else step)
    else:
        cat_paw(im, 4, step if lead else 0)
        cat_paw(im, 9, 0 if lead else step)

    cat_tail(im, side, bob, sway)

    blob(im, CAT_BODY_SIDE if side else CAT_BODY_ROWS, body_top, 0, CAT_FUR, CAT_EDGE)
    # Tabby stripes across the back, and a paler chest under the chin.
    if side:
        rect(im, 4, body_top + 1, 4, body_top + 2, CAT_SHADE)
        rect(im, 7, body_top + 1, 7, body_top + 2, CAT_SHADE)
    else:
        rect(im, 7, body_top + 1, 8, body_top + 4, CAT_LIGHT)

    cat_ears(im, CAT_EARS_SIDE if side else CAT_EARS, head_top, CAT_SHADE if direction == "up" else CAT_NOSE)
    blob(im, CAT_HEAD_SIDE if side else CAT_HEAD, head_top, 0, CAT_FUR, CAT_EDGE)

    if direction == "up":
        # The back of a cat's head: the stripes between the ears, no face.
        rect(im, 6, head_top + 1, 6, head_top + 2, CAT_SHADE)
        rect(im, 9, head_top + 1, 9, head_top + 2, CAT_SHADE)
        return im

    if side:
        # In profile: one eye, a pale muzzle and the nose at the very tip.
        if blink:
            rect(im, 9, head_top + 3, 10, head_top + 3, CAT_EDGE)
        else:
            rect(im, 9, head_top + 2, 10, head_top + 3, CAT_EYE)
        rect(im, 11, head_top + 3, 12, head_top + 3, CAT_LIGHT)
        put(im, 12, head_top + 3, CAT_NOSE)
        put(im, 7, head_top + 3, CAT_SHADE)
    else:
        for ex in (5, 9):
            if blink:
                rect(im, ex, head_top + 3, ex + 1, head_top + 3, CAT_EDGE)
            else:
                rect(im, ex, head_top + 2, ex + 1, head_top + 3, CAT_EYE)
        # Muzzle, nose and the two whiskers that make it unmistakable.
        rect(im, 6, head_top + 4, 9, head_top + 4, CAT_LIGHT)
        rect(im, 7, head_top + 4, 8, head_top + 4, CAT_NOSE)
        put(im, 3, head_top + 3, CAT_SHADE)
        put(im, 12, head_top + 3, CAT_SHADE)
    return im


# ---------------------------------------------------------------------------
# The sheets
# ---------------------------------------------------------------------------

# One drawer per id in `AGENT_TYPES`. The catalogue in the shared package and
# this table have to name the same four types: a type declared there without a
# sheet here is a mascot nobody can draw.
TYPES = {
    "robot": draw_robot,
    "classic": bot_frame,
    "duck": duck_frame,
    "cat": cat_frame,
}


def build(draw) -> Image.Image:
    sheet = Image.new("RGBA", (FRAME_W * FRAME_COUNT, FRAME_H), (0, 0, 0, 0))
    for (state, direction), start in ANIM_START.items():
        for phase in range(FRAMES_PER_ANIM):
            # `left` is `right` mirrored: the two profiles cannot drift apart.
            source = "right" if direction == "left" else direction
            frame = draw(state, source, phase)
            if direction == "left":
                frame = frame.transpose(Image.FLIP_LEFT_RIGHT)
            sheet.paste(frame, ((start + phase) * FRAME_W, 0))
    return sheet


def main() -> None:
    wanted = sys.argv[1:] or list(TYPES)
    unknown = [name for name in wanted if name not in TYPES]
    if unknown:
        raise SystemExit(f"unknown mascot type(s): {', '.join(unknown)}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name in wanted:
        sheet = build(TYPES[name])
        path = OUT_DIR / f"{name}.png"
        sheet.save(path)
        print(f"{path.relative_to(ROOT)}: {sheet.size[0]}x{sheet.size[1]} px, {FRAME_COUNT} frames")


if __name__ == "__main__":
    main()
