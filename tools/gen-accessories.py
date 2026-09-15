#!/usr/bin/env python3
"""
Draws the accessory overlays -- the cap, the beanie and the two pairs of
glasses -- one sheet per silhouette.

Development only: the result is committed in
apps/client/public/assets/avatars/layers/<base>/<accessory>.png.
Run `tools/split-layers.py` and `tools/gen-hair.py` first -- this reads the
body and hair sheets they write.  Requires Python 3 and Pillow.

Usage:  python3 tools/gen-accessories.py

Nothing here is drawn to a fixed offset.  `avatar_head.py` measures, for every
one of the 52 frames of every silhouette, where the head starts, how wide it is
on each of its rows, and which pixels are the eyes; the hat is then cut to that
skull and the glasses land on those eyes.  That is what makes the accessories
follow the head bob through the walk cycle, and what makes them fit adam --
whose crown is a drawn row higher than ash's, lucy's and nancy's -- as well as
they fit anyone else.

A hat also has to hide the hair it is worn over, and the styles are not all the
same height: the `bun` rises a drawn row above the natural crown (two columns
wider than it on adam).  So the crown is cut from the *envelope* -- the union of
the head with all five hair styles -- and one hat sheet per silhouette then
covers any of them.  Under the hat the hair reads as flattened, which is what
hair under a hat does.

Everything is drawn with `put_art`, on the 16x24 grid the art really uses: this
sheet's predecessor drew on the fine 32x48 grid, and a hat two fine rows tall is
both half the thickness of every line around it and too thin to read as a hat at
all -- which is how the cap ended up looking like a scratch sunk into the hair.
"""
from __future__ import annotations

from PIL import Image

from avatar_frames import ART_W, FRAME_COUNT, art_mask, blank_sheet, put_art
from avatar_head import BASES, HAIR_STYLES, LAYERS_DIR, Head, measure

Rgba = tuple[int, int, int, int]
Pixels = list[tuple[int, int, Rgba]]


# ---------------------------------------------------------------------------
# How deep on the head each hat sits, in drawn rows below the natural crown.
# A cap stops on the crown and shows its visor; a beanie is pulled two rows
# further down, to the hairline, and closes with a band.
#
# These are the two numbers worth tuning by eye.  Deeper than this and the head
# is more hat than face -- the skull is only about twelve drawn rows tall and
# widens to the full frame by its sixth, so a brim placed below that has to run
# edge to edge and the cap reads as a bucket hat.
# ---------------------------------------------------------------------------
CAP_BRIM = 3
BEANIE_BAND = 5

CAP_SHADE: Rgba = (58, 58, 78, 255)
CAP_BODY: Rgba = (92, 92, 124, 255)
CAP_LIGHT: Rgba = (124, 124, 164, 255)
CAP_VISOR: Rgba = (70, 70, 96, 255)

BEANIE_SHADE: Rgba = (128, 52, 52, 255)
BEANIE_BODY: Rgba = (196, 96, 96, 255)
BEANIE_LIGHT: Rgba = (224, 128, 128, 255)
BEANIE_BAND_A: Rgba = (168, 72, 72, 255)
BEANIE_BAND_B: Rgba = (208, 112, 112, 255)

RIM: Rgba = (44, 44, 60, 255)
GLASS_ROUND: Rgba = (176, 214, 246, 170)
GLASS_SQUARE: Rgba = (206, 210, 224, 150)


def crown_span(head: Head, ay: int) -> tuple[int, int]:
    """
    How wide the hat is on one row: the skull, never narrower than the hair.

    Above the crown the dome closes in by a pixel a row, the way the head does;
    but if a hair style reaches that high the hat opens back up to cover it,
    because a bun showing over the top of a cap is the bug this fixes.
    """
    lo, hi = head.span(max(ay, head.top), envelope=True)
    if ay < head.top:
        lo, hi = lo + 1, hi - 1
    if ay in head.env:
        elo, ehi = head.env[ay]
        lo, hi = min(lo, elo), max(hi, ehi)
    return lo, hi


def crown_top(head: Head) -> int:
    """
    The row a hat's dome starts on: one above the skull, or higher still if a
    hair style reaches further.

    It is deliberately *not* clamped to the frame.  Adam's head reaches the top
    row of the sheet on the frames where the walk cycle lifts it, so his cap has
    nowhere left to put its dome and loses that row the way his own hair does;
    clamping the anchor instead would leave the dome pinned to the frame edge
    while the head bobbed underneath it, which is a hat visibly detaching and
    re-attaching twice a second.  `put_art` drops whatever falls outside.
    """
    return min(head.env_top, head.top - 1)


def crown(head: Head, bottom: int, body: Rgba, light: Rgba, shade: Rgba) -> Pixels:
    """The dome of a hat: from the highest the hair reaches down to `bottom`."""
    top = crown_top(head)
    out: Pixels = []
    for ay in range(top, bottom + 1):
        lo, hi = crown_span(head, ay)
        for ax in range(lo, hi + 1):
            if ax in (lo, hi):
                out.append((ax, ay, shade))
            else:
                out.append((ax, ay, light if ay == top else body))
    return out


def cap(head: Head) -> Pixels:
    """Crown plus a visor, pointing the way the character faces."""
    out = crown(head, head.top + CAP_BRIM - 1, CAP_BODY, CAP_LIGHT, CAP_SHADE)
    brim = head.top + CAP_BRIM
    lo, hi = crown_span(head, brim)
    if head.dir == "up":
        # The back of a cap: the rim, and the gap of the size adjuster.
        for ax in range(lo, hi + 1):
            mid = (lo + hi) // 2
            out.append((ax, brim, CAP_SHADE if ax in (mid, mid + 1) else CAP_VISOR))
        return out
    if head.dir == "right":
        hi = hi + 2
    elif head.dir == "left":
        lo = lo - 2
    else:
        lo, hi = lo - 1, hi + 1
    lo, hi = max(0, lo), min(ART_W - 1, hi)
    for ax in range(lo, hi + 1):
        out.append((ax, brim, CAP_SHADE if ax in (lo, hi) else CAP_VISOR))
    return out


def beanie(head: Head) -> Pixels:
    """Crown pulled down over the ears, closed by a ribbed band."""
    out = crown(head, head.top + BEANIE_BAND - 1, BEANIE_BODY, BEANIE_LIGHT, BEANIE_SHADE)
    band = head.top + BEANIE_BAND
    lo, hi = crown_span(head, band)
    for ax in range(lo, hi + 1):
        if ax in (lo, hi):
            out.append((ax, band, BEANIE_SHADE))
        else:
            out.append((ax, band, BEANIE_BAND_A if (ax - lo) % 2 else BEANIE_BAND_B))
    return out


def glasses(head: Head, glass: Rgba, boxy: bool) -> Pixels:
    """
    A lens over each eye the frame shows, joined over the nose, with a temple
    running back towards the ear.  Frames facing away have no eyes and stay
    empty, exactly like the facial hair.

    The bridge goes a row *above* the lenses rather than between them.  On this
    face the eyes are four pixels apart, so a bridge on the eye row welds the
    two lenses into one dark bar across the face -- it reads as a blindfold, not
    as glasses.  Lifted a row it arches over the nose and leaves the lenses
    reading as two.
    """
    if head.eye_row is None or not head.eyes:
        return []
    ay = head.eye_row
    lo, hi = head.span(ay)
    out: Pixels = []

    def put(ax: int, ay: int, rgba: Rgba) -> None:
        if lo <= ax <= hi:
            out.append((ax, ay, rgba))

    # A square lens is the round one grown a row upwards -- rims down both
    # sides, glass all the way up between them.  Capping it with a rim instead
    # would join the two lenses and the bridge into eight unbroken dark pixels
    # across a sixteen-pixel face, which is the same blindfold by another route.
    for eye in head.eyes:
        for row in ((ay - 1, ay) if boxy else (ay,)):
            put(eye - 1, row, RIM)
            put(eye, row, glass)
            put(eye + 1, row, RIM)
    for left, right in zip(head.eyes, head.eyes[1:]):
        for ax in range(left + 2, right - 1):
            put(ax, ay - 1, RIM)
    # Temple: away from the face, which is the back of the head.
    if head.dir == "left":
        put(max(head.eyes) + 2, ay, RIM)
    else:
        put(min(head.eyes) - 2, ay, RIM)
    return out


ACCESSORIES = {
    "cap": cap,
    "beanie": beanie,
    "glasses-round": lambda head: glasses(head, GLASS_ROUND, boxy=False),
    "glasses-square": lambda head: glasses(head, GLASS_SQUARE, boxy=True),
}


def generate(base: str) -> None:
    heads = measure(base)
    for name, draw in ACCESSORIES.items():
        sheet = blank_sheet()
        px = sheet.load()
        for frame in range(FRAME_COUNT):
            for ax, ay, rgba in draw(heads[frame]):
                put_art(px, frame, ax, ay, rgba)
        out = LAYERS_DIR / base / f"{name}.png"
        sheet.save(out, optimize=True)
        print(f"  {base}/{name}.png  ({out.stat().st_size} bytes)")


# ---------------------------------------------------------------------------
# Checks
#
# What broke before was never visible in one frame of one avatar: a hat that
# fits ash sits inside adam's hair, and a hat that fits short hair lets a bun
# through.  These walk every silhouette against every hair style and every one
# of the 52 frames, so regenerating an accessory says whether it still fits.
# ---------------------------------------------------------------------------
def verify(base: str) -> list[str]:
    heads = measure(base)
    sheets = {
        name: Image.open(LAYERS_DIR / base / f"{name}.png").convert("RGBA").load()
        for name in ACCESSORIES
    }
    hair = {
        style: Image.open(LAYERS_DIR / base / f"hair-{style}.png").convert("RGBA").load()
        for style in HAIR_STYLES
    }
    problems: list[str] = []

    for name in ("cap", "beanie"):
        px = sheets[name]
        lift = set()
        for frame, head in enumerate(heads):
            worn = art_mask(px, frame)
            if not worn:
                problems.append(f"{base}/{name}: nothing drawn on frame {frame}")
                continue
            rows = {ay for _, ay in worn}
            lift.add(crown_top(head) - head.top)
            if min(rows) != max(0, crown_top(head)):
                problems.append(f"{base}/{name}: crown is not on the head, frame {frame}")
            for style, hp in hair.items():
                for ax, ay in art_mask(hp, frame):
                    if ay < min(rows):
                        problems.append(f"{base}/{name}: {style} shows over the crown, frame {frame}")
                    elif ay <= max(rows) - 1 and (ax, ay) not in worn:
                        lo = min(x for x, y in worn if y == ay)
                        hi = max(x for x, y in worn if y == ay)
                        if lo <= ax <= hi:
                            problems.append(f"{base}/{name}: {style} shows through, frame {frame}")
        if len(lift) > 1:
            problems.append(f"{base}/{name}: drifts off the head between frames (offsets {sorted(lift)})")

    for name in ("glasses-round", "glasses-square"):
        px = sheets[name]
        for frame, head in enumerate(heads):
            worn = art_mask(px, frame)
            if head.dir == "up" or head.eye_row is None:
                if worn:
                    problems.append(f"{base}/{name}: drawn on a face turned away, frame {frame}")
                continue
            if not worn:
                problems.append(f"{base}/{name}: nothing drawn on frame {frame}")
            elif max(ay for _, ay in worn) != head.eye_row:
                problems.append(f"{base}/{name}: off the eye line, frame {frame}")
    return problems


def main() -> None:
    print(f"Drawing accessories in {LAYERS_DIR}/\n")
    problems: list[str] = []
    for base in BASES:
        print(f"[{base}]")
        generate(base)
        problems += verify(base)
        print()
    if problems:
        for line in problems:
            print(f"!! {line}")
        raise SystemExit(f"{len(problems)} accessories do not fit the head they are drawn on")
    print(f"Done.  {len(BASES) * len(ACCESSORIES)} sheets, all of them checked against "
          f"{len(HAIR_STYLES)} hair styles on {FRAME_COUNT} frames.")


if __name__ == "__main__":
    main()
