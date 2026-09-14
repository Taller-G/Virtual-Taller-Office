# Licences of the graphic assets

An inventory of everything in `apps/client/public/assets/`, where it came from and under what
conditions it can be used. If you add a new asset, add it here in the same commit.

## Summary

| File                                                  | Contents                                                                                                                                                                                                               | Author                 | Licence                                   | Via       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------- | --------- |
| `tilesets/FloorAndGround.png`                         | Floors and walls (Room Builder)                                                                                                                                                                                        | LimeZu                 | LimeZu Modern Interiors                   | SkyOffice |
| `tilesets/Modern_Office_Black_Shadow.png`             | Office furniture (desks, chairs, plants...)                                                                                                                                                                            | LimeZu                 | LimeZu Modern Office                      | SkyOffice |
| `tilesets/Generic.png`                                | Generic furniture (tables, fridge, kitchen, sofas...)                                                                                                                                                                  | LimeZu                 | LimeZu Modern Interiors                   | SkyOffice |
| `tilesets/Basement.png`                               | Assorted objects (boxes, machines, shelves)                                                                                                                                                                            | LimeZu                 | LimeZu Modern Interiors                   | SkyOffice |
| `tilesets/chair.png`                                  | Chairs in 4 directions (32x64 sheet)                                                                                                                                                                                   | LimeZu                 | LimeZu Modern Office                      | SkyOffice |
| `tilesets/computer.png`                               | Desk with a computer (96x64 sheet)                                                                                                                                                                                     | LimeZu                 | LimeZu Modern Office                      | SkyOffice |
| `tilesets/whiteboard.png`                             | Whiteboard (64x64 sheet)                                                                                                                                                                                               | LimeZu                 | LimeZu Modern Office                      | SkyOffice |
| `tilesets/ChironDark.png`                             | Floors, walls and lights of the Chiron Office (8×5 sheet, 32×32): `FloorAndGround` tiles run through a cold duotone, plus hand-drawn light pools, LED strip and doorway; generated with `tools/make-chiron-tileset.py` | LimeZu (edit: Taller)  | LimeZu Modern Interiors (editing allowed) | —         |
| `tilesets/vendingmachine.png`                         | Vending machine (48x72)                                                                                                                                                                                                | LimeZu                 | LimeZu Modern Interiors                   | SkyOffice |
| `avatars/adam.png` `ash.png` `lucy.png` `nancy.png`   | Characters (32x48 sheets, 52 frames: idle/walk in 4 directions)                                                                                                                                                        | LimeZu                 | LimeZu Modern Interiors                   | SkyOffice |
| `avatars/bruno.png` `dana.png` `iris.png` `tomas.png` | Recoloured variants of the four above (clothes and hair; skin and outlines untouched), generated with `tools/recolor-avatars.py`                                                                                       | LimeZu (edits: Taller) | LimeZu Modern Interiors (editing allowed) | —         |
| `avatars/persona1.png` `persona2.png` `persona3.png`  | Taller team avatars (32x48 sheets, 52 frames), derived from `lucy`/`nancy`/`ash` by recolouring hair and clothes to resemble each person; generated with `tools/person-avatars.py`                                     | LimeZu (edits: Taller) | LimeZu Modern Interiors (editing allowed) | —         |
| `avatars/layers/{base}/body-*.png`                    | Body layer (skin, outlines, trousers, shoes) extracted from each base character and with skin-tone variants; generated with `tools/split-layers.py`                                                                    | LimeZu (edits: Taller) | LimeZu Modern Interiors (editing allowed) | —         |
| `avatars/layers/{base}/hair.png`                      | Hair layer (hair, greyscale for tinting with `setTint()`); generated with `tools/split-layers.py`                                                                                                                      | LimeZu (edits: Taller) | LimeZu Modern Interiors (editing allowed) | —         |
| `avatars/layers/{base}/top.png`                       | Top layer (torso clothing, greyscale for tinting with `setTint()`); generated with `tools/split-layers.py`                                                                                                             | LimeZu (edits: Taller) | LimeZu Modern Interiors (editing allowed) | —         |
| `avatars/layers/accessories/cap.png` `beanie.png`     | Hat accessories (32x48 sheets, 52 frames, transparent overlay); original pixel art generated with `tools/gen-accessories.py`                                                                                           | Taller                 | Own                                       | —         |
| `avatars/layers/accessories/glasses-*.png`            | Glasses accessories (32x48 sheets, 52 frames, transparent overlay); original pixel art generated with `tools/gen-accessories.py`                                                                                       | Taller                 | Own                                       | —         |
| `logo/taller-logo-pixel.png`                          | Taller logo in pixel art (160x32, transparent background), derived from `images/logo.png`                                                                                                                              | Taller                 | Own (Taller trademark)                    | —         |
| `map/chiron-office.json`                              | Floor plan of the Chiron Office (Tiled map), generated with `tools/make-chiron-map.py`                                                                                                                                 | Taller                 | Own                                       | —         |
| `map/first-office.json`                               | Floor plan of the office (Tiled map)                                                                                                                                                                                   | Taller                 | Own; derived from the SkyOffice map (MIT) | —         |

## LimeZu — Modern Interiors / Modern Office

- Author: LimeZu — <https://limezu.itch.io/>
- Packs: [Modern Interiors](https://limezu.itch.io/moderninteriors) and
  [Modern Office - Revamped](https://limezu.itch.io/modernoffice).
- Conditions published by the author on itch.io (checked on 2026-09-07):
  - **You may** edit and use the assets in any project, commercial or non-commercial.
  - **You must** credit LimeZu with a link to <https://limezu.itch.io/>.
  - **You may not** resell or redistribute the assets to third parties, edited or unedited.

What that means for this project:

- Using them in Taller's internal virtual office is allowed, the recoloured character variants
  included (the licence allows editing the assets).
- The credit is in the repo's `README.md` ("Credits" section) and has to stay there.
- The ban on redistribution means **these PNGs should not live in a public repository**. The
  `Taller-G/Virtual-Taller-Office` repo has to stay private while it holds these files; if at some
  point it becomes public, they have to be taken out of the history and served from private
  storage, or replaced with a freely licensed tileset (CC0, for instance).

## SkyOffice (source code and original map)

- Repo: <https://github.com/kevinshen56714/SkyOffice> — MIT licence, © 2021 Kuan-Hsuan Shen.
- What was taken from SkyOffice: the approach of a Tiled map with collisions by property and the
  original floor plan (`client/public/assets/map/map.json`), reworked to represent Taller's office.
- The MIT licence covers the code and the map file, **not** LimeZu's PNGs that SkyOffice
  redistributes: those remain under LimeZu's conditions described above.

## How to add a new asset

1. Check the licence before copying the file. For internal use CC0, CC-BY (with credit), MIT/OFL,
   or licences of commercial packs that allow use in projects (such as LimeZu's) are fine. Avoid
   "personal use only" and anything without an explicit licence.
2. Copy it to `apps/client/public/assets/tilesets/` and add the row to the table above.
3. If the licence requires credit, add it to the "Credits" section of the `README.md`.
4. Add it as a tileset in Tiled (see `docs/map.md`); the client loads it on its own.
