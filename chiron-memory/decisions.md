# decision

A choice made and the reasoning behind it — the path taken over the alternatives.

## Travelling joins the destination world before leaving the origin

What: Crossing a door does `join` (not `joinOrCreate`) on the destination room, waits for its first state, and only then leaves the origin room with a consented leave · Why: if the destination is down, full or its map failed, the traveller must stay exactly where they were with a message instead of ending up in limbo; `joinOrCreate` would silently resurrect a world the server deliberately did not start · Where: apps/client/src/network/connection.ts (`travelTo`) · Learned: for a hand-off between two live connections, acquire the new one first and release the old one last

## Doors are crossed by walking, detected client-side

What: The client checks its own avatar's feet against the map's `door` rectangles each frame and starts the trip; there is no key press, prompt or server-side trigger · Why: the client already resolves collisions and owns the avatar's position, so it reacts instantly; the server still decides where the traveller lands (it resolves the named spawn in its own map) · Where: apps/client/src/game/OfficeScene.ts (`checkDoors`) · Learned: the arriving player must be re-armed — travel only triggers again after stepping out of a door area, otherwise arriving next to the return door bounces you back
