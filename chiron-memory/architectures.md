# architecture

How the system is put together — layers, boundaries, and how data flows.

## One Colyseus room per world

What: Each world (`first-office`, `chiron-office`) is registered as its own Colyseus room type `world_<id>` running the same `WorldRoom` class, pre-created at startup with `autoDispose = false` · Why: a room is already the unit that scopes state, participants, proximity bubbles and chat, so per-world isolation (no chat crossing worlds, no ghost avatars) comes for free instead of adding a world filter to every lookup · Where: apps/server/src/app.config.ts, apps/server/src/rooms/WorldRoom.ts · Learned: when a framework already scopes exactly what you need to isolate, add instances rather than a discriminator field

## The world registry is the single source of truth shared by client and server

What: `packages/shared/src/worlds.ts` lists every world (stable id, visible name, map file) and derives its room name; the server loads and validates those maps at boot, the client loads them on demand from the same registry · Why: client and server must agree on which worlds exist and which map each one draws, and a door names a world by id — a second list would drift · Where: packages/shared/src/worlds.ts · Learned: replaced the `MAP_FILE` / `VITE_MAP_URL` single-map overrides, which stop making sense once there is more than one world

## Focused people are outside the conversation system entirely

What: `BubbleManager` skips anyone with a `seatId` — they neither open a bubble, nor get absorbed into one, and sitting down takes them out of the one they were in · Why: "nobody can start a conversation with you" has to be enforced where bubbles are actually decided (proximity, on the server); hiding a button would leave the bubble forming anyway · Where: apps/server/src/bubbles.ts · Learned: to make something unavailable, take it out of the rule that produces it, not out of the UI that shows it
