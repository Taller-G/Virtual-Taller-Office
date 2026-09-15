#!/usr/bin/env python3
"""
Where the head of a composed avatar is, frame by frame and silhouette by
silhouette -- the measurements `gen-accessories.py` hangs the hats and the
glasses off.

Nothing here draws: it reads the layer sheets `split-layers.py` and
`gen-hair.py` write and answers, for one frame of one base, three questions.

  * Where does the head start and how wide is it on each of its rows?
    The hat is cut to that shape, so it sits on *this* skull instead of on the
    one reference avatar every accessory used to be measured against.

  * How far does the hair reach above that?  The `bun` rises one drawn row over
    the natural crown (two columns wider than it on adam), so a hat that only
    covered the skull would let the bun poke out the top.  The *envelope* -- the
    union of all five styles -- is the shape a hat has to fill to hide any of
    them, and since it is measured once per frame the same hat sheet works for
    every hair style.

  * Which pixels are the eyes?  Glasses land on them, and the head bobs through
    the walk cycle, so the row is measured per frame rather than assumed.

Everything is in drawn pixels (16x24 per frame): the art is 2x, so a hat placed
on the fine grid reads as a finer sprite glued onto a coarser one.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

from avatar_frames import (
    ART_W,
    DIR_MAP,
    FRAME_COUNT,
    art_mask,
    get_art,
    row_extents,
)

LAYERS_DIR = Path(__file__).resolve().parents[1] / "apps/client/public/assets/avatars/layers"
BASES = ["adam", "ash", "lucy", "nancy"]
HAIR_STYLES = ["short", "long", "bun", "curly", "ponytail"]

# The head is the top of the frame; below this row the silhouette is shoulders,
# arms and whatever the hair drapes over them, and measuring those would make a
# hat as wide as the character.
HEAD_ROWS = 10
# Below this row skin is hands and forearms, not a face (same bound as
# gen-facial-hair.py).
FACE_BOTTOM = 16
# A face has at least this many drawn pixels; fewer is an ear or a hand, and the
# frame is one facing away.  It is much lower than gen-facial-hair.py's bound
# because the patch is only used to know which row to start looking at: on
# lucy's frame 16 the hair leaves eight pixels of cheek showing and the eye is
# still there, under them.
FACE_MIN = 6
# A pixel this dark inside the face is a feature (the eyes), not skin.
DARK_MAX = 330


def _skin_patch(body_px, frame: int) -> set[tuple[int, int]]:
    """The biggest connected patch of non-dark opaque pixels in the head."""
    face = {
        (ax, ay)
        for ay in range(FACE_BOTTOM)
        for ax in range(ART_W)
        if get_art(body_px, frame, ax, ay)[3] > 0
        and sum(get_art(body_px, frame, ax, ay)[:3]) > DARK_MAX
    }
    best: set[tuple[int, int]] = set()
    while face:
        seed = face.pop()
        patch = {seed}
        edge = [seed]
        while edge:
            ax, ay = edge.pop()
            for nb in ((ax + 1, ay), (ax - 1, ay), (ax, ay + 1), (ax, ay - 1)):
                if nb in face:
                    face.remove(nb)
                    patch.add(nb)
                    edge.append(nb)
        if len(patch) > len(best):
            best = patch
    return best


class Head:
    """One frame's head, in drawn pixels."""

    def __init__(self, body_px, hair_px, envelope_px_list, frame: int) -> None:
        self.frame = frame
        self.dir = DIR_MAP[frame]

        head = {(ax, ay) for ax, ay in art_mask(body_px, frame) | art_mask(hair_px, frame)}
        skull = {p for p in head if p[1] < HEAD_ROWS}
        self.rows = row_extents(skull)
        self.top = min(self.rows)

        env = set(skull)
        for px in envelope_px_list:
            env |= {p for p in art_mask(px, frame) if p[1] < HEAD_ROWS}
        self.env = row_extents(env)
        self.env_top = min(self.env)

        self.eye_row: int | None = None
        self.eyes: list[int] = []
        if self.dir != "up":
            patch = _skin_patch(body_px, frame)
            if len(patch) >= FACE_MIN:
                self._find_eyes(body_px, frame, head, min(ay for _, ay in patch))

    def _find_eyes(self, body_px, frame: int, head: set[tuple[int, int]], first: int) -> None:
        """
        The eyes are the topmost pair of single dark pixels sunk into the head.

        Neither "dark" nor "inside the face" is enough on its own.  The outline
        that rings the head is the same near-black, and it runs two pixels thick
        on some walk frames, so it looks like a feature; and on ash the hair
        covers the cheek right of the eye, which leaves that eye on the *edge*
        of the body layer even though it is in the middle of the face.  What
        only an eye satisfies is both at once: one pixel wide, and strictly
        between the left and right edges of the whole head (hair included).
        """
        silhouette = row_extents(head)
        for ay in range(first, FACE_BOTTOM):
            if ay not in silhouette:
                continue
            lo, hi = silhouette[ay]
            dark = [
                ax
                for ax in range(lo, hi + 1)
                if get_art(body_px, frame, ax, ay)[3] > 0
                and sum(get_art(body_px, frame, ax, ay)[:3]) <= DARK_MAX
            ]
            eyes = [
                ax
                for ax in dark
                if lo < ax < hi and ax - 1 not in dark and ax + 1 not in dark
            ]
            if eyes:
                self.eye_row, self.eyes = ay, eyes
                return

    def span(self, ay: int, envelope: bool = False) -> tuple[int, int]:
        """The head's leftmost and rightmost column on a row, clamped to the head."""
        rows = self.env if envelope else self.rows
        if ay in rows:
            return rows[ay]
        first, last = min(rows), max(rows)
        return rows[first] if ay < first else rows[last]

    def center(self, ay: int) -> int:
        lo, hi = self.span(ay)
        return (lo + hi) // 2


def measure(base: str) -> list[Head]:
    """Every frame of one silhouette, in frame order."""
    body = Image.open(LAYERS_DIR / base / "body-default.png").convert("RGBA").load()
    hair = {
        style: Image.open(LAYERS_DIR / base / f"hair-{style}.png").convert("RGBA").load()
        for style in HAIR_STYLES
    }
    envelope = [px for style, px in hair.items() if style != "short"]
    return [Head(body, hair["short"], envelope, f) for f in range(FRAME_COUNT)]


def _report() -> None:
    """`python3 tools/avatar_head.py` prints what it measured, as a sanity check."""
    for base in BASES:
        heads = measure(base)
        eyeless = [h.frame for h in heads if h.eye_row is None and h.dir != "up"]
        rows = sorted({h.eye_row for h in heads if h.eye_row is not None})
        tops = sorted({h.top for h in heads})
        lifts = sorted({h.top - h.env_top for h in heads})
        print(f"[{base}]")
        print(f"  head top rows        {tops}")
        print(f"  hair over the crown  {lifts} drawn rows")
        print(f"  eye rows             {rows}")
        print(f"  eyes per frame       {sorted({len(h.eyes) for h in heads if h.eyes})}")
        if eyeless:
            print(f"  !! no eyes found in frames {eyeless}")
        print()


if __name__ == "__main__":
    _report()
