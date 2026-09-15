#!/usr/bin/env python3
"""
Renders composed avatars as a labelled grid, so a change to any layer can be
checked by looking at it rather than by reasoning about pixel offsets.

Development only; nothing it writes is committed.  Requires Python 3 and Pillow.

    # every hair style under a cap, on all four silhouettes, front idle
    python3 tools/contact-sheet.py --hat cap --rows base,hairStyle \
        --frames 18 -o /tmp/caps.png

    # one silhouette walking with cap + glasses, frame by frame
    python3 tools/contact-sheet.py --base ash --hat cap --glasses glasses-round \
        --rows dir --frames walk -o /tmp/walk.png

The layer order and the tints mirror `appearanceLayers()` in
packages/shared/src/avatars.ts, which is the source of truth: this tool draws
what the office and the entry preview draw, it does not define it.  If a part
is added to the catalogue, add it here too or the sheet stops being faithful.
"""
from __future__ import annotations

import argparse
import itertools
from pathlib import Path

from PIL import Image, ImageDraw

from avatar_frames import FRAME_COUNT, FRAME_H, FRAME_W

ROOT = Path(__file__).resolve().parents[1]
LAYERS_DIR = ROOT / "apps/client/public/assets/avatars/layers"

BASES = ["adam", "ash", "lucy", "nancy"]
HAIR_STYLES = ["short", "long", "bun", "curly", "ponytail"]
HATS = ["none", "cap", "beanie"]
GLASSES = ["none", "glasses-round", "glasses-square"]
FACIAL = ["none", "stubble", "mustache", "beard"]
SKIN_TONES = ["default", "light", "medium", "tan", "dark"]

NO_TINT = 0xFFFFFF
HAIR_COLORS = {"black": 0x3A3A4A, "brown": 0x8B6040, "blonde": 0xE8C860, "white": 0xE0E0E8}
TOP_COLORS = {"green": 0x40A060, "red": 0xD04040, "white": 0xF0F0F0}
PANTS_COLORS = {"navy": 0x4A5480}
SHOE_COLORS = {"black": 0x3A3A4A}

# First frame of each animation, per direction (ANIM_START in the catalogue).
ANIM_START = {
    "idle": {"right": 0, "up": 6, "left": 12, "down": 18},
    "walk": {"right": 24, "up": 30, "left": 36, "down": 42},
}
SIT_FRAME = {"down": 48, "left": 49, "right": 50, "up": 51}
DIRECTIONS = ["down", "left", "right", "up"]

DEFAULT = {
    "base": "adam",
    "skinTone": "default",
    "hairStyle": "short",
    "hairColor": "brown",
    "facialHair": "none",
    "topColor": "green",
    "pantsColor": "navy",
    "shoeColor": "black",
    "hat": "none",
    "glasses": "none",
}


def layers(a: dict) -> list[tuple[str, int]]:
    """The sheets of an appearance and their tints, in draw order."""
    hair = HAIR_COLORS[a["hairColor"]]
    base = a["base"]
    out = [
        (f"{base}/body-{a['skinTone']}.png", NO_TINT),
        (f"{base}/shoes.png", SHOE_COLORS[a["shoeColor"]]),
        (f"{base}/pants.png", PANTS_COLORS[a["pantsColor"]]),
        (f"{base}/top.png", TOP_COLORS[a["topColor"]]),
    ]
    if a["facialHair"] != "none":
        out.append((f"{base}/facial-{a['facialHair']}.png", hair))
    out.append((f"{base}/hair-{a['hairStyle']}.png", hair))
    if a["glasses"] != "none":
        out.append((f"{base}/{a['glasses']}.png", NO_TINT))
    if a["hat"] != "none":
        out.append((f"{base}/{a['hat']}.png", NO_TINT))
    return out


_cache: dict[str, Image.Image] = {}


def sheet(rel: str) -> Image.Image | None:
    if rel not in _cache:
        path = LAYERS_DIR / rel
        _cache[rel] = Image.open(path).convert("RGBA") if path.exists() else None
    return _cache[rel]


def tinted(frame: Image.Image, tint: int) -> Image.Image:
    """`setTint()` outside Phaser: multiply each channel, keep the alpha."""
    if tint == NO_TINT:
        return frame
    tr, tg, tb = (tint >> 16) & 0xFF, (tint >> 8) & 0xFF, tint & 0xFF
    out = frame.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, alpha = px[x, y]
            if alpha:
                px[x, y] = (r * tr // 255, g * tg // 255, b * tb // 255, alpha)
    return out


def compose(a: dict, frame: int) -> Image.Image:
    out = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    for rel, tint in layers(a):
        im = sheet(rel)
        if im is None:
            continue
        out.alpha_composite(tinted(im.crop((frame * FRAME_W, 0, (frame + 1) * FRAME_W, FRAME_H)), tint))
    return out


# ---------------------------------------------------------------------------
# The grid
# ---------------------------------------------------------------------------
AXES = {
    "base": BASES,
    "hairStyle": HAIR_STYLES,
    "hat": HATS,
    "glasses": GLASSES,
    "facialHair": FACIAL,
    "skinTone": SKIN_TONES,
    "hairColor": list(HAIR_COLORS),
    "dir": DIRECTIONS,
}

BG = (24, 24, 32, 255)
GRID = (56, 56, 72, 255)
TEXT = (210, 210, 224, 255)
LABEL_W, HEADER_H, PAD = 120, 14, 4


def frames_of(spec: str, a: dict) -> list[tuple[str, int]]:
    """
    `18`, `idle`, `walk`, `sit` or `all` -> the frames to draw, with a label.

    `idle` and `walk` depend on the row's own `dir`, so this is asked once per
    row: a sheet with `--rows base,dir --frames walk` has to show each row its
    own animation, not the first row's.
    """
    if spec in ("idle", "walk"):
        start = ANIM_START[spec][a.get("dir", "down")]
        # Numbered within the animation, not within the sheet: rows facing
        # different ways draw different frames under the same column.
        return [(f"{spec} {i + 1}", start + i) for i in range(6)]
    if spec == "sit":
        return [(d, SIT_FRAME[d]) for d in DIRECTIONS]
    if spec == "all":
        return [(str(f), f) for f in range(FRAME_COUNT)]
    return [(f, int(f)) for f in spec.split(",")]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for field, options in AXES.items():
        ap.add_argument(f"--{field}", help=f"one of {', '.join(options)}")
    ap.add_argument("--rows", default="base", help="fields to vary down the rows, comma separated")
    ap.add_argument("--cols", help="a field to vary across the columns instead of the frame")
    ap.add_argument("--frames", default="18", help="frame numbers, or idle / walk / sit / all")
    ap.add_argument("--scale", type=int, default=4)
    ap.add_argument("-o", "--out", default="contact-sheet.png")
    args = ap.parse_args()

    fixed = dict(DEFAULT)
    for field in AXES:
        chosen = getattr(args, field)
        if chosen:
            fixed[field] = chosen

    row_fields = [f for f in args.rows.split(",") if f]
    combos = list(itertools.product(*(AXES[f] if not getattr(args, f) else [getattr(args, f)] for f in row_fields)))
    rows = []
    for combo in combos:
        a = dict(fixed)
        a.update(dict(zip(row_fields, combo)))
        rows.append((" · ".join(combo), a))

    def columns(a: dict) -> list[tuple[str, int, dict]]:
        if args.cols:
            frame = frames_of(args.frames, a)[0][1]
            return [(value, frame, {args.cols: value}) for value in AXES[args.cols]]
        return [(label, frame, {}) for label, frame in frames_of(args.frames, a)]

    cols = columns(rows[0][1])
    cw, ch = FRAME_W * args.scale + PAD, FRAME_H * args.scale + PAD
    sheet_im = Image.new("RGBA", (LABEL_W + len(cols) * cw, HEADER_H + len(rows) * ch), BG)
    draw = ImageDraw.Draw(sheet_im)

    for ci, (label, _, _) in enumerate(cols):
        draw.text((LABEL_W + ci * cw + 4, 3), label, fill=TEXT)
    for ri, (label, a) in enumerate(rows):
        y = HEADER_H + ri * ch
        draw.text((4, y + ch // 2 - 4), label, fill=TEXT)
        draw.line((0, y, sheet_im.width, y), fill=GRID)
        for ci, (_, frame, over) in enumerate(columns(a)):
            im = compose({**a, **over}, frame).resize(
                (FRAME_W * args.scale, FRAME_H * args.scale), Image.NEAREST
            )
            sheet_im.alpha_composite(im, (LABEL_W + ci * cw + PAD // 2, y + PAD // 2))

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    sheet_im.save(args.out)
    print(f"{args.out}  ({len(rows)} x {len(cols)} avatars)")


if __name__ == "__main__":
    main()
