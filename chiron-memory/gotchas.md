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

## `rem` in this client is 14px, so a width in `rem` comes out narrower than it reads

What: `html, body { font: 14px/1.4 ... }` sets the **root** font size to 14px, so `1rem` is 14px everywhere: the sidebar's `width: 20rem` rendered at 280px, not the 320px the design meant · Why: it passes review silently — the number in the stylesheet is the number in the design, and only a measurement in the browser shows the gap · Where: apps/client/src/style.css (`--side-width`, set in px on purpose) · Learned: a `font` shorthand on `html` redefines `rem` for the whole sheet; for a figure that has to land on an exact pixel width, write the pixels

## The own-message rule outranks the failed-message rule in the chat

What: `.chat__group[data-mine='true'] .chat__msg` (three in the class column) beats `.chat__msg[data-status='error']` (two), so a rejected message kept the accent background and ring and only its reason text gave it away — and since a failed message is always one's own, the whole error style was dead · Why: both rules looked right in isolation and the reason line did appear, so the bubble read as "sent" with an odd sentence under it · Where: apps/client/src/style.css (`.chat__group[data-mine] .chat__msg[data-status='error']`, matched through the group to win) · Learned: a state that only ever occurs inside a variant has to be specified at least as deeply as that variant

## A render that runs every frame must not rebuild anything you can click

What: The person card re-runs `render()` on every animation frame to stay over its avatar, and that `render` rebuilt the overflow menu and the portrait with `replaceChildren` each time — so the menu button under the pointer was destroyed and recreated sixty times a second and a click could never land on it ("element was detached from the DOM, retrying", for ever) · Why: it looks right and reads right; the menu appears, the buttons are there, hover even works, and only an actual click reveals it. Nothing about the code says "this runs 60 times a second" at the point where the DOM is built · Where: apps/client/src/ui/personCard.ts (`renderMenu`, the portrait's `shownPortrait` key) · Learned: split a per-frame render in two — what moves (a transform) and what changes (text) — and build the elements once, updating them in place; if a rebuild is unavoidable, key it so it only happens when its inputs actually changed
