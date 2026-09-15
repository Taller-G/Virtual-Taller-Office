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

## An author `display` rule silently defeats `el.hidden = true`

What: `[hidden]` in the UA stylesheet is an attribute selector of the same specificity as a class, and the author sheet wins on cascade origin — so `.avatar-grid { display: grid }` and `.appearance-editor { display: flex }` kept both entry-screen panels rendered at once no matter what `setMode()` set `hidden` to · Why: the tab bar looked wired up and toggled `aria-selected` correctly, so the symptom read as "the card is too tall", not "the tabs do nothing" · Where: apps/client/src/style.css (the global `[hidden] { display: none !important }` near the top), apps/client/src/ui/entry.ts (`setMode`) · Learned: any project that toggles the `hidden` property needs that one global rule once; without it every new class that sets `display` is a latent bug

## A `<fieldset>` will not pass a constrained height to its children

What: `display: flex` on a fieldset applies to the anonymous content box the browser wraps its children in, and that box keeps `height: auto` — so the fieldset itself shrank as a flex item while its inner scroller stayed at full content height and overflowed, painting the appearance editor straight over the submit button · Why: every measurement of the fieldset looked right (it really did shrink), so the bug only shows if you also measure the child · Where: apps/client/src/ui/entry.ts (the avatar group), apps/client/index.html · Learned: for a flex/grid container that must hand a constrained height down, use a `div` with `role="group"` + `aria-labelledby` instead of `fieldset`/`legend` — same semantics to a screen reader, none of the anonymous-box behaviour

## Headless Chrome ignores `::-webkit-scrollbar`, so screenshots cannot prove a scrollbar

What: The same page gives `offsetWidth - clientWidth` of 0 in headless Chrome and 8px headed, so a styled scrollbar is absent from every headless screenshot even though real users see it · Why: it reads as "my CSS did not apply" and invites chasing a bug that is not there · Where: verified against apps/client/src/style.css (`.entry__panels::-webkit-scrollbar`) · Learned: assert scroll behaviour with `scrollHeight > clientHeight`, and check scrollbar _rendering_ with a headed browser

## A CSS animation restarted on the next frame never runs in a background tab

What: The panel's highlight was restarted the usual way — drop the class, add it back inside `requestAnimationFrame` — and it simply did not happen while the window was in the background, because rAF does not fire in a page that is not being painted; restarting with `for (const animation of el.getAnimations()) animation.currentTime = 0` works everywhere · Why: it fails exactly where the effect matters most (the highlight that says "you missed something" is queued for a window nobody is looking at) and passes every test run in a visible window · Where: apps/client/src/ui/chat.ts (`spark`) · Learned: `getAnimations()` flushes styles and gives the running animation directly, so it needs neither the rAF hop nor the `void el.offsetWidth` reflow trick that the linter rejects anyway

## Vite's first page load can throw away a form that was just submitted

What: Driving the client over CDP, the first page load after starting `npm run dev` submits the entry form, the server logs the join, and then Vite finishes optimizing dependencies and forces a full reload: the fresh page is back at the entry screen with `window.__vto` gone and the session orphaned · Why: it reads as "the client cannot join", and the server log showing a successful join sends you looking in the wrong place · Where: automated runs against `http://localhost:5173/?debug` · Learned: wait for `window.__vto` to exist before submitting, and retry the whole entry once if the room does not appear — or warm the dev server with a throwaway page load first

## Phaser's `setTint()` is a multiply, and reproducing it on a 2D canvas needs a second pass

What: a greyscale layer coloured with `setTint(hex)` in the game is reproduced outside Phaser by drawing the frame, then `globalCompositeOperation = 'multiply'` + `fillRect` with the tint, then `'destination-in'` and drawing the frame again · Why: `multiply` is composited source-over, so on its own it also paints the tint across the frame's transparent pixels and the sprite comes out inside a solid rectangle; the `destination-in` pass puts the frame's own silhouette back. No CSS filter does a per-channel multiply, which is why the entry preview is a canvas and not stacked DOM sprites · Where: apps/client/src/ui/avatarPreview.ts (`tintedFrame`) · Learned: verify such a composite against an offline reference (PIL doing `r*tint//255` per channel) rather than by eye — the two agreed pixel-for-pixel, which is what proved the preview faithful to the office

## A base whose hair and clothes share a colour cannot be split by colour alone

What: in `tools/split-layers.py` adam's `HAIR` and `TOP` colour sets were swapped, so the "hair" swatch recoloured his shirt and vice versa — and once unswapped it turned out his olive is _both_ hair (rows 2-27) and trousers (rows 36-45), and his purple _both_ shirt (rows 26-43) and shoes (rows 44-45), so each needs a row bound (`HAIR_SPATIAL` / `TOP_SPATIAL`, `{base: (colours, max_y)}`) · Why: the split is a pure colour lookup, so one shared colour silently drags a second body part into the tinted layer; nobody noticed the swap because until the entry screen had a preview you could not see the result without entering the office · Where: tools/split-layers.py (`HAIR`, `TOP`, `HAIR_SPATIAL`, `TOP_SPATIAL`, `classify_pixel`), apps/client/public/assets/avatars/layers/adam/ · Learned: before trusting a colour set, print the rows each colour occupies across all 52 frames and look for two bands — cut the bound in the gap between them, never at the first row of the lower part

## A dev server killed by `--strictPort` lets a sibling worktree answer on your port

What: this repo is worked on in several git worktrees at once, each running `npm run dev`; a Vite started with `--strictPort` on a port a neighbour already holds exits immediately, and requests to that port are then served by the _other worktree's_ code — the browser shows a stale UI and the change under test looks as though it never applied · Why: the symptom is indistinguishable from a broken build or a cache problem, and the page still loads and works · Where: verified against `http://localhost:5199` answering from a different worktree's vite process · Learned: before trusting any browser check, confirm the port's owner — `ps -o args -p $(lsof -nP -iTCP:<port> -sTCP:LISTEN -t)` must print your own worktree path — and pick an unusual port; the same applies to the Colyseus server port
