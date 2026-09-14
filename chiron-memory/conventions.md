# convention

A rule the codebase follows — naming, patterns, and where things live.

## Room tile vocabulary of the office map

What: Rooms are drawn with a fixed set of FloorAndGround gids: vertical walls 152 (room on its right) and 92 (room on its left), 154 for the east outer edge; top wall 994; bottom wall 217 with corners 216/213 (218 on the east edge); room floor 2383 with 2319 as the first row under the top wall; corridor floor 414 (leftmost column) + 415 · Why: the map has no autotiling — picking the wrong variant leaves visible seams, and these gids are the ones the existing rooms already use · Where: apps/client/public/assets/map/first-office.json (layers Floor and Walls) · Learned: copy the tile vocabulary from an existing room rather than guessing tiles from the tileset image

## Doorways are holes in the wall layer, not special tiles

What: A door in a vertical wall is a two-tile gap in the Walls layer with gid 788 as the cap right above it, and floor tiles underneath; in a horizontal wall it is a one-tile gap flanked by jambs 995 (left) and 993 (right) · Why: collision comes from the tiles themselves, so removing the wall tile is what makes the avatar able to walk through · Where: apps/client/public/assets/map/first-office.json · Learned: a room is trapped exactly when its wall ring has no gap — nothing in code marks a doorway

## One spawn, and every zone reachable from it

What: The map keeps exactly one spawn object (reception); rooms never get their own spawn, and a test walks a flood fill from the spawn requiring at least one reachable tile inside every zone · Why: players must always land in reception and be able to reach any room on foot; the test is what catches a room walled off by accident · Where: apps/server/test/map.test.ts

## Map spawns: the unnamed one is the world entrance, named ones are door arrivals

What: A map has exactly one `spawn` object without a name (or named `spawn`) — the world entrance — plus any number of named spawns, each the target of a door in another map; optional `dir` gives the facing on arrival and `radius` the scatter · Why: doors have to name where they land, and the entrance has to stay unambiguous for people entering the world from the app · Where: packages/shared/src/map.ts, docs/map.md · Learned: put an arrival spawn outside the return door's area (and give it a small radius) or the traveller is sent straight back
