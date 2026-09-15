# gotcha

A non-obvious pitfall or trap, learned the hard way.

## Never leave a floor tile under a colliding wall tile

What: In the Floor layer, a non-zero tile at a position where Walls has a colliding tile makes the "has separate layers for floor, walls, furniture and colliding objects" test fail · Why: that test classifies a tile layer as a collision layer when any of its non-zero tiles sits on a solid position, and it requires at least one layer without collisions · Where: apps/server/test/map.test.ts · Learned: when building walls, clear the floor underneath them (and only put floor in the doorway gaps)

## The Taller logo is positioned by code, not by the map

What: The logo is a floor decal placed by addReceptionLogo() at LOGO_ZONE_FRAC_X of the width of the zone named "Reception" — moving it means editing that fraction, not the Tiled file; the free floor band is x 696-928 at y 160-192, between the waiting bench and the reception counter · Why: the logo is an app asset, not map data, so the map stays replaceable without losing the branding · Where: apps/client/src/game/officeMap.ts

## A scene restart tears down the camera manager before avatars are destroyed

What: On Phaser's SHUTDOWN (fired by `scene.restart()` when travelling to another world) `this.cameras` is already undefined, so `this.cameras.main.stopFollow()` inside avatar cleanup throws · Why: the scene's systems are shut down before our SHUTDOWN handler runs its own cleanup · Where: apps/client/src/game/OfficeScene.ts (`removeAvatar`) · Learned: cleanup that runs on scene shutdown must treat scene systems as possibly gone (`this.cameras?.main?.…`)

## A bubble dissolves between two MOVEs, so chat sent right after moving can be rejected

What: Moving two players to the same spot with separate `MOVE` messages breaks their bubble for the instants between the two messages; a `CHAT_SEND` in that window comes back as `no_bubble` · Why: bubble membership is recomputed on every clamped move, so a player who moved first is momentarily alone · Where: apps/server/src/bubbles.ts, apps/server/test/travel.room.test.ts · Learned: in room tests, wait for both players to be at their positions AND sharing a bubble id before asserting on chat

## Copying furniture from the First Office by rectangle drags in its wall decoration

What: Extracting a piece of furniture from `first-office.json` with a tile rectangle (`piece()` in `tools/make-chiron-map.py`) also catches the `FloorAndGround` objects sitting there — the white skirting strip the First Office paints on its walls as decorative objects — plus whatever stray chair or stool belongs to the neighbouring furniture · Why: the filter is purely geometric (object anchor inside the rect), and a LimeZu assembly is a pile of overlapping sprites with no grouping, so nothing says where one piece ends · Where: tools/make-chiron-map.py (`piece`) · Learned: skip every object whose gid belongs to `FloorAndGround` (gid < 2561), keep the rectangle tight, and render the result — a plant piece that quietly carried a stool got placed five times before it showed up

## Multi-tile furniture gids in these packs cannot be guessed from the sheet

What: Blocks of gids that look like one object in the tileset image are often something else entirely: the gids the First Office kitchen uses for its "counter" are a pool table, the "fridge" pair is an aquarium picture, and the second row of the wall-screen block (`5194`/`5195`) is a box plus an unrelated floor lamp, not the screen's stand · Why: LimeZu's sheets pack unrelated objects adjacently and multi-tile pieces do not align to any grid you can infer · Where: tools/make-chiron-map.py (the furniture constants) · Learned: before placing a block, render those exact gids side by side as an image and look at it; reading the tileset overview is not enough

## Tall furniture blocks only the tile row at its base, never the rows its art covers

What: A cabinet, shelf or plant is drawn over two or three tile rows but only its bottom row goes in `FurnitureCollision`; the rows the art covers stay walkable · Why: it is the First Office's idiom (see its shelves) and it is what makes avatars pass behind tall furniture instead of bumping into a wall of it — depth sorting already puts them in front or behind · Where: tools/make-chiron-map.py (`shelf`, `plant`), apps/client/public/assets/map/first-office.json · Learned: blocking every row the sprite covers kills three tile rows per cabinet and can wall a room off — the reachability test catches it, but the fix is the idiom, not a bigger gap

## Two tilesets with the same name in one map: the second one silently renders as the first

What: the Chiron map copies the First Office's tilesets to reuse its furniture by gid, and the First Office embeds `ChironDark` for the doorway — so the map ended up with two tilesets called `ChironDark`, and every gid of the one it appended resolved against the other: the wall sign rendered as nothing at all · Why: Phaser registers a tileset image by name, so the second `addTilesetImage('ChironDark', ...)` returns the one already registered, with the wrong `firstgid`; the offline renderer, which resolves by "greatest firstgid <= gid", drew it correctly and hid the bug · Where: tools/make-chiron-map.py (`build`, the tilesets filter) · Learned: rendering a map outside the game is not proof it renders in the game — and a name collision in map data fails silently, so filter the inherited tilesets by name

## Pinning someone to a seat needs the same rectangle the client offered it with

What: a seat is offered as soon as the player's _body_ overlaps it, so a `MOVE` still in flight when they sit reports a position up to ~37 px from the seat's centre — further than a tile; releasing the seat on "moved more than a tile" therefore threw people straight back out of the chair, and the symptom was a desk that simply stopped accepting you after you had used it once · Why: the client and the server were answering "is this player at that seat?" with two different notions of where somebody is standing · Where: packages/shared/src/map.ts (`PLAYER_BODY`, `isAtSeat`), apps/server/src/rooms/WorldRoom.ts (`onMove`) · Learned: when a client offers an action from a region, the server has to judge that action against the very same region — share the predicate, do not re-derive it as a distance
