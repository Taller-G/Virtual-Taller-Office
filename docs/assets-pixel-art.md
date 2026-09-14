# Pixel art assets: the logo and the team avatars

What each pixel art asset added for the Taller Office is, its dimensions and how it is organised.
For licences and attribution see [`asset-licenses.md`](asset-licenses.md).

The original images (the logo and the photos of the people) live in the `Taller-G/images` repo
(`logo.png`, `person1.png`, `person2.png`, `person3.png`) and **are not modified**: the pixel art
assets are added separately, here in `virtual-taller-office`.

## Logo

- **File:** `apps/client/public/assets/logo/taller-logo-pixel.png`
- **Dimensions:** 160x32 px (5x1 tiles of 32 px), transparent background.
- **Origin:** derived from `images/logo.png` (orange arrow + the word "TALLER").
- **How it was made:** the original scaled down to the grid, the palette reduced to the brand
  colours (white, orange, dark orange) and a 1 px dark outline so it reads over light or dark
  floors of the map.
- **Use:** it is drawn as decoration for the reception, anchored to the map's `Reception` zone, in
  `apps/client/src/game/officeMap.ts` (`addReceptionLogo`). It is a sprite **without a physics
  body**, so it neither blocks the way nor interferes with the interactions; it goes as a floor
  decal (depth below furniture and avatars, which is why characters walk over it). It is loaded in
  `BootScene`; if the file were missing, the office still opens without the logo. To move it, see
  the `LOGO_ZONE_*` constants in `officeMap.ts`.

## The people's avatars

Three playable characters, one per person on the team. They keep each person's recognisable traits
(hair length and colour, clothing colour) so it is clear who is who.

| id         | Person (traits)                          | Base sprite |
| ---------- | ---------------------------------------- | ----------- |
| `persona1` | Long light/blonde hair, cream blouse     | `lucy`      |
| `persona2` | Long black hair, black leather jacket    | `nancy`     |
| `persona3` | Brown hair, light top                    | `ash`       |

- **Files:** `apps/client/public/assets/avatars/persona1.png`, `persona2.png`, `persona3.png`
- **How they were made:** with `tools/person-avatars.py` (Python + Pillow, development only). It
  starts from LimeZu's base sprites and recolours hair and clothes independently to resemble each
  person, keeping skin, outlines and shading. It is the same convention as
  `tools/recolor-avatars.py`. To regenerate them: `python3 tools/person-avatars.py`.
- **Selection:** they show up in the entry picker next to the generic avatars (the catalogue is in
  `packages/shared/src/avatars.ts`); the choice is stored in `localStorage` and survives a reload.
- **Fallback:** if a sheet failed to load, `BootScene` does not abort and `Avatar`/`avatarAnims`
  resolve that avatar to the default one, so the office still opens and never leaves a blank
  screen.

### Sprite sheet layout (the same as the rest of the avatars)

Every avatar shares exactly the same format, defined in `packages/shared/src/avatars.ts`
(`AVATAR_FRAME`, `ANIM_START`):

- **Sheet:** 1664x48 px, a single row.
- **Frame:** 32x48 px, **52 frames** per sheet (indices 0-51, from left to right).
- **Frames per animation:** 6.
- **Layout (index of the first frame of each animation):**

  | Animation | right | up    | left  | down  |
  | --------- | ----- | ----- | ----- | ----- |
  | idle      | 0-5   | 6-11  | 12-17 | 18-23 |
  | walk      | 24-29 | 30-35 | 36-41 | 42-47 |

  Frames 48-51 are the sitting pose (not used yet).

Because the three sheets share dimensions, general palette and frame count, they look consistent
with each other and with the avatars that already existed, and the engine loads them without any
reprocessing (`apps/client/src/game/BootScene.ts` walks `AVATAR_IDS`).
