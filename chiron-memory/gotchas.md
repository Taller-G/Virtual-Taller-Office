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
