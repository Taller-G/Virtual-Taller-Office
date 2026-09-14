# decision

A choice made and the reasoning behind it — the path taken over the alternatives.

## South wing added by growing the map canvas instead of filling the gaps

What: The three new rooms (Sala de reunión Sur, Sala de reunión Este, Sala de foco) were added by growing the Tiled canvas from 40×30 to 40×40 tiles and hanging them off the vertical corridor (cols 20-23), which was prolonged from row 28 to row 34 · Why: the free pockets inside the original 40×30 canvas were 3-5 tiles tall, too small for rooms with walls, doors and furniture; appending rows at the bottom keeps every existing object's coordinates untouched, so nothing in the old office moves · Where: apps/client/public/assets/map/oficina-taller.json · Learned: extend a Tiled map to the right or the bottom — origin-anchored coordinates then stay valid and only the tile layers need re-padding

## Travelling joins the destination world before leaving the origin

What: Crossing a door does `join` (not `joinOrCreate`) on the destination room, waits for its first state, and only then leaves the origin room with a consented leave · Why: if the destination is down, full or its map failed, the traveller must stay exactly where they were with a message instead of ending up in limbo; `joinOrCreate` would silently resurrect a world the server deliberately did not start · Where: apps/client/src/network/connection.ts (`travelTo`) · Learned: for a hand-off between two live connections, acquire the new one first and release the old one last

## Doors are crossed by walking, detected client-side

What: Each frame the client intersects its own avatar's **physics body rectangle** (the feet: `body.top === avatar.y`, 18×12 px) with the map's `door` rectangles and starts the trip; there is no key press, prompt or server-side trigger · Why: the client already resolves collisions and owns the avatar's position, so it reacts instantly; the server still decides where the traveller lands (it resolves the named spawn in its own map) · Where: apps/client/src/game/OfficeScene.ts (`checkDoors`), packages/shared/src/map.ts (`doorAtRect`) · Learned: testing a single point against a one-tile door makes the trigger band a few pixels wide and doors feel dead — overlap the whole body; and the arriving player must be re-armed, so travel only triggers again after stepping out of a door area
