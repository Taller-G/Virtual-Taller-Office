# Virtual Taller Office

Taller's 2D virtual office, Gather style: avatars in shared worlds in real time.
This repository holds the **foundation**: a web client, a real-time server and the **worlds** —the
**First Office**, which everyone enters, and the **Chiron Office**, dark, reached by crossing a
door— with a solid connection cycle (joining, leaving, refreshing, losing the network, the server
going down); the **2D map of each world** (reception, desks, meeting rooms, focus room, kitchen)
with walls and furniture that block the way; **real-time presence**: each person picks a name and an
avatar, moves with the arrow keys or WASD, sees everyone else move with animation, and a panel shows
who is around and who is away; and **proximity conversation bubbles**: walking up to someone opens a
group the server computes by radius, the same for everyone.

Each world is a [Tiled](https://www.mapeditor.org/) file anyone on the team can edit without
touching code —doors included—: see [`docs/map.md`](docs/map.md).

Stack: [Phaser 3](https://phaser.io/) + [Colyseus 0.18](https://colyseus.io/) + [Vite](https://vite.dev/),
all in TypeScript.

## Structure

```
apps/
  client/        Web client (Vite + Phaser 3 + @colyseus/sdk). Deployed as a static site.
    public/assets/map/       Tiled maps of the worlds (first-office.json, chiron-office.json)
    public/assets/tilesets/  Images of the tilesets the map uses
    public/assets/avatars/   Sprite sheets of the 8 avatars (<id>.png)
  server/        Node server (Colyseus). Deployed separately, as its own service.
packages/
  shared/        Shared contracts: worlds, messages, state schema, map, avatar catalogue and identity.
tools/
  recolor-avatars.py   Generates the 4 recoloured avatar variants (development only, Python + Pillow).
  person-avatars.py    Generates the 3 team avatars (persona1/2/3) from the base sprites (development only).
  make-chiron-map.py   Generates the Chiron Office map from the First Office tilesets (development only).
docs/
  map.md               How to edit the maps in Tiled, the contract (doors included) and how to add a world
  asset-licenses.md    Origin and licence of each graphic asset
  assets-pixel-art.md  Logo and team avatars: dimensions and layout of the sprite sheets
```

It is a monorepo with npm workspaces. The client imports the state definitions from `@vto/shared`
and, as types only, the server's room: a typo in a room or message name is a compile error, but
nothing from the server ends up in the browser bundle.

## Requirements

- **Node 22 or later** (Colyseus 0.18 requires it). There is an `.nvmrc`: with nvm, `nvm use` is
  enough.
- npm 10 (comes with Node 22).

## Running in development

```bash
git clone https://github.com/Taller-G/Virtual-Taller-Office.git
cd Virtual-Taller-Office
nvm use            # or make sure Node 22 is active
npm install
npm run dev
```

`npm run dev` brings up both parts with a single command:

| Part   | URL                     | Reload                              |
| ------ | ----------------------- | ----------------------------------- |
| Server | `ws://localhost:2567`   | `tsx watch`: restarts on save       |
| Client | `http://localhost:5173` | Vite HMR                            |

Open `http://localhost:5173` in two different browsers: each one picks a name and an avatar and both
show up in the First Office. Walking to the door at the back of the reception takes you to the
Chiron Office. `http://localhost:2567/health` returns the server's status, which worlds are up and
how many people are in each one.

To run a single part: `npm run dev -w apps/server` or `npm run dev -w apps/client`.

## Configuration (environment variables)

Nothing is hard-coded: the port and the server URL come from the environment. Each app has a
documented `.env.example` and a `.env.development` with the local values.

### Server (`apps/server`)

| Variable                  | Default         | What it does                                                                         |
| ------------------------- | --------------- | ------------------------------------------------------------------------------------ |
| `PORT`                    | `2567`          | HTTP + WebSocket port.                                                                |
| `MAX_CLIENTS`             | `50`            | Maximum number of simultaneous players **per world**.                                 |
| `RECONNECT_GRACE_SECONDS` | `2`             | Seconds a player's seat is held after their network dropped, before removing them.    |
| `AWAY_AFTER_SECONDS`      | `300`           | Seconds without moving after which the avatar shows as "away" to everyone else.        |
| `PING_INTERVAL_MS`        | `2000`          | How often each socket is pinged.                                                      |
| `PING_MAX_RETRIES`        | `2`             | Pings without an answer before the connection is given up for dead.                   |
| `BUBBLE_RADIUS_PX`        | 2 tiles (64 px) | Radius of a conversation bubble. Empty = 2 tiles of the loaded map.                   |
| `BUBBLE_MAX_MEMBERS`      | `6`             | Maximum number of people in a single bubble.                                          |

`@colyseus/tools` automatically loads `.env.development` or `.env.production` according to
`NODE_ENV`. In production the usual thing is to define the variables in the hosting provider.

### Client (`apps/client`)

| Variable          | Default (dev)         | What it does                                            |
| ----------------- | --------------------- | ------------------------------------------------------- |
| `VITE_SERVER_URL` | `ws://localhost:2567` | Public URL of the Colyseus server. `wss://` in production. |
| `VITE_PORT`       | `5173`                | Port of Vite's development server.                      |

Vite injects `VITE_SERVER_URL` **at build time**: to point the static site at another server it has
to be rebuilt. If it is missing, the client fails at startup with a clear message.

## The worlds, the map and the movement

- **One world, one map, one room.** The worlds are declared in `packages/shared/src/worlds.ts` (a
  stable id, the visible name and the map file). The server registers and brings up **one room per
  world**, so each one has its people, its bubbles and its chat without sharing anything with the
  others.
- **Doors.** An object of class `door` in the map names the world and the arrival point it leads to.
  It is crossed **by walking**: on stepping on it, the screen fades to black, the client joins the
  destination's room and only then leaves the origin's, and appears at the spawn the door names,
  facing inwards. If the destination is unavailable, you stay where you were with a notice. At
  startup, the server validates every door of every world.
- **The map is data.** `apps/client/public/assets/map/first-office.json` is a Tiled map with layers
  for floor, walls, decorative furniture and colliding furniture, plus the spawn points, the doors
  and the named zones. Replacing it with another valid one changes the office without touching code.
  The full contract is in [`docs/map.md`](docs/map.md).
- **Collisions from the map.** A tile blocks if its tileset marks it with `collides: true`; a piece
  of furniture blocks if it or its layer has `collides: true`. The code knows no layer names.
- **Spawn from the map.** The server reads the same files the client draws at startup, takes the
  object of class `spawn` without a name (the world's entrance) and places each player at random
  within its radius; whoever arrives through a door appears at the named spawn that door mentions.
  If a map is not valid, the server does not start and explains why.
- **Movement.** Arrow keys or WASD move your own avatar with Arcade physics against walls and
  furniture. The camera follows the player with zoom 2 and `pixelArt` so the pixel art stays crisp.
- **Debug.** `http://localhost:5173/?debug` draws the collision bodies, the spawn points with their
  radius and the door areas with their destination, and exposes `window.__vto`.

## Avatars, movement and presence

- **Identity.** On joining you pick a visible name (up to 20 characters) and one of the 8 avatars in
  the catalogue (`packages/shared/src/avatars.ts`). They travel as `joinOrCreate` options; the
  server validates them (the name trimmed, the avatar from the catalogue; failing that, `Guest-xxxx`
  and the default avatar) and stores them in the state. The browser remembers the last choice. The
  name can be changed afterwards from the panel.
- **Animation.** Each avatar is a 52-frame sheet (32x48): idle and walking in four directions. Your
  own is animated according to its velocity; diagonally the horizontal axis wins.
- **Synchronisation.** The client sends `move` `{x, y, dir, moving}` **at most 20 times per second
  and only when something changed**; the server clamps the position to the map, validates the
  direction and replicates the state to everyone. The other avatars do not jump: they slide towards
  the latest position received with framerate-independent exponential smoothing (tau = 80 ms) and
  only "snap" if the distance is huge or the tab was hidden. Their animation comes from
  `dir`/`moving`.
- **The server is the source of truth.** The "In the office" panel and the avatars on screen are
  created in `onAdd` and destroyed in `onRemove` of the `players` map; the client never adds or
  retains players on its own. When someone joins or leaves a discreet notice appears.
- **Away.** After `AWAY_AFTER_SECONDS` (300 by default) without moving, the server marks the player
  as away: everyone else sees them dimmed with the "away" badge and that is how they show in the
  panel; on moving they go back to active. The "Mark me away" button sets the state by hand: in that
  case moving does **not** clear it, only the same button does.
- **Typing does not move you.** While a text field has the focus, the game's keyboard is switched
  off and stops capturing the arrow keys and space, so the field's caret works and the avatar does
  not move.

## Proximity conversation bubbles

Walking up to someone means something concrete and **shared by everyone**: the server decides who is
in each conversation, so it never happens that two people see different bubbles. It is the
radius-based group model of [WorkAdventure](https://github.com/workadventure/workadventure) (its
`back/src/Model/Group.ts`), not SkyOffice's, where proximity triggers a video call.

- **The server builds the bubbles.** After every movement (already clamped to the map), the room
  recomputes the membership: two players without a bubble who come within `BUBBLE_RADIUS_PX` open
  one; whoever has no bubble and comes within reach of one that is not full joins it. If there are
  several options the closest one wins.
- **The centre is the centroid.** The bubble sits at the average of its members' positions and is
  recomputed with every step.
- **Leaving is moving away from the centre.** A member leaves when they end up further than one
  radius from the centroid. Measuring against the centre (and not against each member) gives
  hysteresis: two people join at `R` and only break apart at `~2R`, so the bubble does not flicker
  with one step too many. When **a single member is left, the bubble is destroyed**.
- **Cap of people.** A bubble with `BUBBLE_MAX_MEMBERS` members absorbs nobody else; whoever walks
  up sees the "bubble full" notice and can open their own with someone else.
- **On screen.** Each bubble is drawn as an area of the real radius the server reports, centred on
  the centroid and sliding with the same smoothing as the avatars: your own highlighted and with the
  count of people, the others barely visible. The members of my bubble carry a ring at their feet
  and the side panel lists who is inside.
- **Notices.** A toast on joining and leaving a bubble, and when someone joins or leaves.
- **The client cannot force its bubble.** The protocol has no bubble message at all: membership
  travels only from server to client (`Player.bubbleId` and `state.bubbles`). The only thing the
  client sends is its position, and the server clamps it to the map **before** deciding.

## How the connection works

- **One persistent room per world.** The server registers `world_<id>` for every world in the
  registry (`world_first_office`, `world_chiron_office`) with `autoDispose = false` and creates them
  at startup; the client calls `joinOrCreate` on the initial world's and always lands in that
  instance. There is no lobby, no custom rooms and no passwords.
- **Travelling.** Crossing a door is joining the destination world's room (with `join`: if that
  world is not up, the trip fails instead of creating one) and only then leaving the origin's, so
  nobody is left halfway or as a ghost on both sides.
- **Joining.** On joining, the server adds a `Player` to the state under the `sessionId` key and
  sends the client its identifier and the room's metadata. The SDK synchronises the whole state and
  after that only the changes.
- **Closing or refreshing the tab.** The client issues a consented `leave` on `pagehide`; the server
  removes them instantly and everyone else sees them disappear. Refreshing joins with a new session,
  so there is never a duplicate.
- **Losing the network.** If the socket drops without notice, the server marks the player as
  disconnected (their avatar dims for everyone else) and holds their seat for
  `RECONNECT_GRACE_SECONDS`. If they come back in time they keep the session; if not, they are
  removed.
- **Server down or restarted.** The client shows "Disconnected" and retries on its own with
  exponential backoff (1 s, 2 s, 4 s... up to 10 s) until it gets back in. Nothing has to be touched.

## Quality

```bash
npm run lint          # ESLint (flat config + typescript-eslint)
npm run format        # Prettier
npm run typecheck     # tsc across the three packages
npm test              # Vitest: connect / disconnect cycle against a real server
npm run check         # all of the above
```

The tests (`apps/server/test`) bring up a real Colyseus server with `@colyseus/testing` and connect
SDK clients: they check that two clients see each other, that a consented leave removes the player
immediately, that a disconnection without notice removes them in under 3 seconds, that reconnecting
within the grace period keeps the session, that refreshing several times leaves exactly one player,
that the player appears at the map's spawn, that movement (position, direction, animation) is
replicated clamped to the map, that the chosen name and avatar reach everyone (and invalid ones fall
back), that renaming is replicated, that inactivity marks "away" and moving clears it, and that the
manual away state is only cleared by hand. The bubbles have their own tests: the pure logic in
`test/bubbles.test.ts` (creation by radius, centroid, hysteresis, cap, destruction when one is left)
and the behaviour against the real room in `test/bubbles.room.test.ts` (both clients see the same
bubble in under 300 ms, a third one joins and all three see three members, whoever walks away leaves
and the others stay, when one is left it disappears, the N+1th player does not join a full bubble,
and a fake position from the client neither creates nor breaks bubbles other than the ones the
server computes). They also validate the **real maps** of every world (`test/map.test.ts`): a single
entrance on walkable floor, the office's zones (the meeting wing's rooms included), that every one
of them is reachable on foot from the spawn, embedded tilesets with their images present, collisions
declared in the map, and the doors of the First Office and the Chiron Office matching up both ways
without falling on walls or furniture. For the First Office they also check what its floor plan
promises: that every meeting room is a named zone with the same ten seats around its table, all of
them facing it, reachable on foot from the spawn and from the Chiron door, that you can leave one
with the room full, that no doorway is narrower than two tiles and that a conversation inside a
meeting room does not reach through its walls. The **contract of the doors** has its tests in
`test/doors.test.ts` (named spawns, a door without a destination, a door to a world or to a spawn
that does not exist: the server does not start and names the door and what is missing) and
**travelling between worlds** in `test/travel.room.test.ts` (you arrive at the spawn the door names
facing inwards, the away state travels with the player, those who stay stop seeing them and those at
the destination see them arrive, the chat of one world does not reach the other and a world that is
down is not brought up by crossing its door). The **avatar catalogue** and the normalisation of
names are in `test/identity.test.ts`.

## Deployment

Client and server are deployed **separately**.

### Server (Node service)

```bash
npm ci
npm run build -w apps/server        # produces apps/server/build/index.mjs (ESM bundle)
NODE_ENV=production PORT=2567 npm start -w apps/server
```

With Docker, building from the repo root:

```bash
docker build -f apps/server/Dockerfile -t vto-server .
docker run -p 2567:2567 -e PORT=2567 vto-server
```

It runs on any host with Node 22 or containers (Render, Railway, Fly.io, a VM with PM2). It needs
WebSocket support. Behind a reverse proxy (nginx, Caddy) the `Upgrade` and `Connection` headers have
to be forwarded. The `GET /health` endpoint works as a health check.

### Client (static site)

```bash
VITE_SERVER_URL=wss://office.your-domain.com npm run build -w apps/client
# publish apps/client/dist
```

Any static hosting works (Netlify, Vercel, Cloudflare Pages, GitHub Pages, an S3 bucket). Set
`VITE_SERVER_URL` as a build environment variable in the provider and use `wss://` if the site is
served over HTTPS: browsers block `ws://` from secure pages.

## References

The design takes [SkyOffice](https://github.com/kevinshen56714/SkyOffice) as a reference (a Colyseus
Room with synchronised player state, a client listening for additions/removals and a Tiled map with
collisions by property), but it is written from scratch on the current versions of Colyseus (0.18,
`@colyseus/sdk`, `@colyseus/schema` 5 without decorators), Phaser 3.90 and Vite 8. The office's
floor plan starts from the SkyOffice map (MIT) reworked for Taller.

## Credits

- Graphics (tiles, furniture, characters): [LimeZu](https://limezu.itch.io/) — the _Modern
  Interiors_ and _Modern Office_ packs. Four of the eight avatars are recolours of LimeZu's
  characters (editing allowed by the licence). Use is allowed in commercial and non-commercial
  projects with credit; they **may not be redistributed**, which is why this repository has to stay
  private while it holds them. Details in [`docs/asset-licenses.md`](docs/asset-licenses.md).
- Original map and approach: [SkyOffice](https://github.com/kevinshen56714/SkyOffice), MIT
  © 2021 Kuan-Hsuan Shen.
