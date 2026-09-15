# architecture

How the system is put together — layers, boundaries, and how data flows.

## One Colyseus room per world

What: Each world (`first-office`, `chiron-office`) is registered as its own Colyseus room type `world_<id>` running the same `WorldRoom` class, pre-created at startup with `autoDispose = false` · Why: a room is already the unit that scopes state, participants, proximity bubbles and chat, so per-world isolation (no chat crossing worlds, no ghost avatars) comes for free instead of adding a world filter to every lookup · Where: apps/server/src/app.config.ts, apps/server/src/rooms/WorldRoom.ts · Learned: when a framework already scopes exactly what you need to isolate, add instances rather than a discriminator field

## The world registry is the single source of truth shared by client and server

What: `packages/shared/src/worlds.ts` lists every world (stable id, visible name, map file) and derives its room name; the server loads and validates those maps at boot, the client loads them on demand from the same registry · Why: client and server must agree on which worlds exist and which map each one draws, and a door names a world by id — a second list would drift · Where: packages/shared/src/worlds.ts · Learned: replaced the `MAP_FILE` / `VITE_MAP_URL` single-map overrides, which stop making sense once there is more than one world

## Focused people are outside the conversation system entirely

What: `BubbleManager` skips anyone with a `seatId` — they neither open a bubble, nor get absorbed into one, and sitting down takes them out of the one they were in · Why: "nobody can start a conversation with you" has to be enforced where bubbles are actually decided (proximity, on the server); hiding a button would leave the bubble forming anyway · Where: apps/server/src/bubbles.ts · Learned: to make something unavailable, take it out of the rule that produces it, not out of the UI that shows it

## Meetings live in one process-wide book that every world room mirrors

What: `apps/server/src/meetings.ts` holds a module-singleton `MeetingBook` with every meeting of every world; each `WorldRoom` subscribes to it and copies it into its own `state.meetings`, and `state.meetingRooms` is read off the worlds' maps once at boot · Why: a meeting booked into a First Office room has to be **listed and enterable from the Chiron Office too**, and each world is a separate Colyseus room with its own state — one list per room could not do that. The book owns the rules (who may enter, when, whether a room is free) and the room owns the world (which chair the person lands in), because only the room knows who is sitting where · Where: apps/server/src/meetings.ts (`MeetingBook`, `meetings`), apps/server/src/rooms/WorldRoom.ts (`syncMeetings`, `closeMeeting`) · Learned: entering is deliberately two steps — the book says yes, then the room places the person, and if placement fails the room calls `meetings.leave` to put the book back as it was

## A meeting's conversation is a Bubble flagged with its meetingId

What: `Bubble.meetingId` marks a bubble as a meeting's conversation. `BubbleManager` never decides its membership by distance: `onPlayerMoved` returns early while `player.meetingId` matches, `tryJoin`/`absorbNearby` skip it, `leave` does not destroy it at one member, and only `joinMeeting`/`closeMeeting` change it · Why: the members panel, the chat relay, the avatars' bubble rings and `player.bubbleId` all already work off bubbles, so making the meeting one gives every piece of that for free — and a big meeting table is wider than the proximity radius, so proximity could never have held the group together · Where: packages/shared/src/schema.ts (`Bubble.meetingId`), apps/server/src/bubbles.ts, apps/client/src/game/OfficeScene.ts (no `BubbleArea` is drawn for one) · Learned: `isAvailableToTalkNearby(player)` (not `isFocused`) is now the guard everywhere in `bubbles.ts` — a **standing** participant has no seat, so `isFocused` alone would let a passer-by pull them out of the meeting
