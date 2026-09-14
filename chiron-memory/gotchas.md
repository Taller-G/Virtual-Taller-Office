# gotcha

A non-obvious pitfall or trap, learned the hard way.

## A scene restart tears down the camera manager before avatars are destroyed

What: On Phaser's SHUTDOWN (fired by `scene.restart()` when travelling to another world) `this.cameras` is already undefined, so `this.cameras.main.stopFollow()` inside avatar cleanup throws · Why: the scene's systems are shut down before our SHUTDOWN handler runs its own cleanup · Where: apps/client/src/game/OfficeScene.ts (`removeAvatar`) · Learned: cleanup that runs on scene shutdown must treat scene systems as possibly gone (`this.cameras?.main?.…`)

## A bubble dissolves between two MOVEs, so chat sent right after moving can be rejected

What: Moving two players to the same spot with separate `MOVE` messages breaks their bubble for the instants between the two messages; a `CHAT_SEND` in that window comes back as `no_bubble` · Why: bubble membership is recomputed on every clamped move, so a player who moved first is momentarily alone · Where: apps/server/src/bubbles.ts, apps/server/test/travel.room.test.ts · Learned: in room tests, wait for both players to be at their positions AND sharing a bubble id before asserting on chat
