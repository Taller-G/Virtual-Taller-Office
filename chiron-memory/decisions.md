# decision

A choice made and the reasoning behind it — the path taken over the alternatives.

## South wing added by growing the map canvas instead of filling the gaps

What: The three new rooms (Sala de reunión Sur, Sala de reunión Este, Sala de foco) were added by growing the Tiled canvas from 40×30 to 40×40 tiles and hanging them off the vertical corridor (cols 20-23), which was prolonged from row 28 to row 34 · Why: the free pockets inside the original 40×30 canvas were 3-5 tiles tall, too small for rooms with walls, doors and furniture; appending rows at the bottom keeps every existing object's coordinates untouched, so nothing in the old office moves · Where: apps/client/public/assets/map/oficina-taller.json · Learned: extend a Tiled map to the right or the bottom — origin-anchored coordinates then stay valid and only the tile layers need re-padding
