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

What: Blocks of gids that look like one object in the tileset image are often something else entirely: the gids the First Office kitchen uses for its "counter" are a pool table, the "fridge" pair is an aquarium picture, and the second row of the wall-screen block (`5194`/`5195`) is a box plus an unrelated floor lamp, not the screen's stand · Why: LimeZu's sheets pack unrelated objects adjacently and multi-tile pieces do not align to any grid you can infer · Where: tools/make-chiron-map.py (the furniture constants) · Learned: `tools/tileset_pieces.py` now answers this from the pixels — `whole_around(gid)` grows a block until nothing is drawn through its border, and `--render` writes the candidate out as a PNG with its surroundings, which is the "look at it" step as one command

## Tall furniture blocks only the tile row at its base, never the rows its art covers

What: A cabinet, shelf or plant is drawn over two or three tile rows but only its bottom row goes in `FurnitureCollision`; the rows the art covers stay walkable · Why: it is the First Office's idiom (see its shelves) and it is what makes avatars pass behind tall furniture instead of bumping into a wall of it — depth sorting already puts them in front or behind · Where: tools/make-chiron-map.py (`Piece.solid_rows`), apps/client/public/assets/map/first-office.json · Learned: blocking every row the sprite covers kills three tile rows per cabinet and can wall a room off — the reachability test catches it, but the fix is the idiom, not a bigger gap

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

## The avatar sheets are 2x art: one drawn pixel is a 2x2 block

What: inside a 32x48 frame the LimeZu art is drawn at 16x24 and scaled up, so every source pixel is an identical 2x2 block · Why: nothing in the format says so, and a layer drawn one pixel at a time still composites correctly — it just reads as a finer sprite glued onto a coarser one, which is the kind of wrongness you see without being able to name it · Where: tools/avatar_frames.py (`ART`, `get_art`, `put_art`), tools/split-layers.py · Learned: check for the doubling before drawing anything new (compare `px[x,y]` with `px[x+1,y]` and `px[x,y+1]` over a frame) — tools/gen-accessories.py was written before the check and drew its hats on the fine grid, which is why a cap two fine rows tall read as a scratch sunk into the hair rather than as a hat; every tool now draws through `put_art`

## A tint multiplies, so a greyscale layer has to be stretched to white

What: `setTint()` multiplies the texel, so a greyscale layer that keeps the art's own luminance (an olive shirt around 40% grey) turns every colour you pick into a dark version of itself — pink hair came out maroon · Why: the layers were split by converting to luminance, which is right for keeping the shading and wrong for keeping the colour · Where: tools/split-layers.py (`normalize`) · Learned: scale each layer by a single factor so its brightest shade is white; the shading survives because the ratios do

## Every base's shoes are painted in its own shirt colour

What: on all four bases the feet reuse a shade of the shirt (adam's purple, ash's maroon, nancy's grey-blue) and lucy's reuse a skin shade, so no colour list can tell a shoe from a sleeve · Why: they are one character's palette, not a set of parts · Where: tools/split-layers.py (`frame_hem`, `SHOES`) · Learned: find the hem first — the row under the lowest shirt pixel above `HEM_MAX` — and only look for shoe colours below it; a hem guessed from how wide the silhouette is drifts by an art pixel in the frames where one leg is lifted, and a drifting hem paints a stripe of shirt in the trouser colour

## `rem` in this client is 14px, so a width in `rem` comes out narrower than it reads

What: `html, body { font: 14px/1.4 ... }` sets the **root** font size to 14px, so `1rem` is 14px everywhere: the sidebar's `width: 20rem` rendered at 280px, not the 320px the design meant · Why: it passes review silently — the number in the stylesheet is the number in the design, and only a measurement in the browser shows the gap · Where: apps/client/src/style.css (`--side-width`, set in px on purpose) · Learned: a `font` shorthand on `html` redefines `rem` for the whole sheet; for a figure that has to land on an exact pixel width, write the pixels

## The own-message rule outranks the failed-message rule in the chat

What: `.chat__group[data-mine='true'] .chat__msg` (three in the class column) beats `.chat__msg[data-status='error']` (two), so a rejected message kept the accent background and ring and only its reason text gave it away — and since a failed message is always one's own, the whole error style was dead · Why: both rules looked right in isolation and the reason line did appear, so the bubble read as "sent" with an odd sentence under it · Where: apps/client/src/style.css (`.chat__group[data-mine] .chat__msg[data-status='error']`, matched through the group to win) · Learned: a state that only ever occurs inside a variant has to be specified at least as deeply as that variant

## A render that runs every frame must not rebuild anything you can click

What: The person card re-runs `render()` on every animation frame to stay over its avatar, and that `render` rebuilt the overflow menu and the portrait with `replaceChildren` each time — so the menu button under the pointer was destroyed and recreated sixty times a second and a click could never land on it ("element was detached from the DOM, retrying", for ever) · Why: it looks right and reads right; the menu appears, the buttons are there, hover even works, and only an actual click reveals it. Nothing about the code says "this runs 60 times a second" at the point where the DOM is built · Where: apps/client/src/ui/personCard.ts (`renderMenu`, the portrait's `shownPortrait` key) · Learned: split a per-frame render in two — what moves (a transform) and what changes (text) — and build the elements once, updating them in place; if a rebuild is unavoidable, key it so it only happens when its inputs actually changed

## Phaser's `setTint()` is a multiply, and reproducing it on a 2D canvas needs a second pass

What: a greyscale layer coloured with `setTint(hex)` in the game is reproduced outside Phaser by drawing the frame, then `globalCompositeOperation = 'multiply'` + `fillRect` with the tint, then `'destination-in'` and drawing the frame again · Why: `multiply` is composited source-over, so on its own it also paints the tint across the frame's transparent pixels and the sprite comes out inside a solid rectangle; the `destination-in` pass puts the frame's own silhouette back. No CSS filter does a per-channel multiply, which is why the entry preview is a canvas and not stacked DOM sprites · Where: apps/client/src/ui/avatarPreview.ts (`tintedFrame`) · Learned: verify such a composite against an offline reference (PIL doing `r*tint//255` per channel) rather than by eye — the two agreed pixel-for-pixel, which is what proved the preview faithful to the office

## A base whose hair and clothes share a colour cannot be split by colour alone

What: in `tools/split-layers.py` adam's `HAIR` and `TOP` colour sets were swapped, so the "hair" swatch recoloured his shirt and vice versa — and once unswapped it turned out his olive is _both_ hair (rows 2-27) and trousers (rows 36-45), and his purple _both_ shirt (rows 26-43) and shoes (rows 44-45), so neither can be resolved by colour alone · Why: the split is a pure colour lookup, so one shared colour silently drags a second body part into the tinted layer; nobody noticed the swap because until the entry screen had a preview you could not see the result without entering the office · Where: tools/split-layers.py (`HAIR`, `TOP`, `PANTS`, `SHOES`, `frame_hem`, `classify_pixel`), apps/client/public/assets/avatars/layers/adam/ · Learned: the hem settles both — above it the colour is hair or shirt, below it the leg split owns the pixel — so the bound is measured once per frame instead of hard-coded per colour; and before trusting a colour set, print the rows each colour occupies across all 52 frames and look for two bands — cut the bound in the gap between them, never at the first row of the lower part

## A dev server killed by `--strictPort` lets a sibling worktree answer on your port

What: this repo is worked on in several git worktrees at once, each running `npm run dev`; a Vite started with `--strictPort` on a port a neighbour already holds exits immediately, and requests to that port are then served by the _other worktree's_ code — the browser shows a stale UI and the change under test looks as though it never applied · Why: the symptom is indistinguishable from a broken build or a cache problem, and the page still loads and works · Where: verified against `http://localhost:5199` answering from a different worktree's vite process · Learned: before trusting any browser check, confirm the port's owner — `ps -o args -p $(lsof -nP -iTCP:<port> -sTCP:LISTEN -t)` must print your own worktree path — and pick an unusual port; the same applies to the Colyseus server port

## Headless Chrome leaves the keyboard dead in the game unless focus is emulated

What: Driving the client over CDP, the avatar never moves: `showEntry` focuses the name field, the typing guard pauses Phaser's KeyboardManager, and on submit `blur()` fires **no** `focusout` in a headless page, so it is never resumed — `Emulation.setFocusEmulationEnabled` is what restores the event and with it the keys · Why: the guard's contract is that a text field losing the focus re-enables the game's keys, and headless silently breaks the second half of it; the symptom is a silent one — keys are dispatched, `document.hasFocus()` is true, and `scene.keys.*.isDown` simply stays false · Where: apps/client/src/game/typingGuard.ts (`installTypingGuard`), driven from a CDP harness · Learned: also worth knowing when driving this client at all — `window.__vto` (game + connection) only exists with `?debug` in the URL, and the entry card's controls are in `index.html` from the start, so wait for `#entry` to stop being `hidden` before reading what `showEntry` put in them

## An eye is a one-pixel-wide dark run strictly inside the head, and nothing less

What: Locating the eyes to hang glasses on them needs both halves of that rule at once — the outline ringing the head is the same near-black and runs two pixels thick on some walk frames, so "dark" alone finds the outline; and on ash the hair covers the cheek to the right of one eye, leaving that eye on the _edge_ of the body layer though it is in the middle of the face, so "inside the opaque body pixels" alone loses it · Why: each test on its own looks right on the one frame you check it against, and fails on a different base or a different frame of the walk cycle · Where: tools/avatar_head.py (`Head._find_eyes`), read against the body layer but bounded by the body+hair silhouette · Learned: the eye row moves independently of the crown — idle frame 4 drops the face a row while the head top stays put — so measure it per frame rather than as an offset from the top of the head

## A hat anchored to a clamped row detaches from the head twice a second

What: The hat's crown is modelled one drawn row above the skull, which on adam falls outside the frame on the walk frames that lift his head (his crown already reaches row 0); clamping that anchor to 0 pins the dome to the frame edge while the head bobs underneath it, so the cap visibly grows and shrinks a row through the cycle · Why: the clamp looks like defensive hygiene and its cost is invisible in any single frame — it only shows as a flicker in motion · Where: tools/gen-accessories.py (`crown_top`, and the drift assertion in `verify`) · Learned: clamp at the point of drawing (`put_art` already drops what falls off the frame), never at the anchor — an anchor that is allowed to go out of bounds keeps a constant relationship to what it is attached to, which is the whole point of an anchor

## A block of gids that renders is not a block of gids that is a whole object

What: half the Chiron Office's furniture was a rectangle cut across a LimeZu object or glued out of two of them — both armchairs were one half of a two-tile-wide chair, the Archive's cabinets were a three-wide slice of a two-wide locker (so every one carried an empty column), the wall screens' second row was an unrelated grey slab that hung under them in mid-air, and the Night Café's counter was a worktop from one piece over a sink from another eleven columns away · Why: the sheets pack unrelated objects flush against each other and nothing in the file says where one ends, so a block picked off the tileset image looks plausible, renders without an error, and is wrong; the offline renderer, Tiled and the map tests all draw it just as happily · Where: tools/make-chiron-map.py (the `Piece` palette), tools/tileset_pieces.py · Learned: the sheet answers the question in pixels — ink that crosses the block's border means the border is drawn *through* something rather than around it, and `cut_sides()` finds it exactly; `make-chiron-map.py` now runs that on every piece and refuses to write the map, so this class of bug cannot be committed again

## Some rows of these sheets pack identical objects with no seam at all

What: `cut_sides()` is exact everywhere except the sofa row of `Basement`, where the next sofa starts in the very next pixel column — so a block holding exactly one whole sofa still reports ink crossing its right edge · Why: connectivity cannot separate them either (flood-filling that row returns all nine tiles as one blob), so there is no automatic answer: a piece there has to say which sides it abuts a neighbour on · Where: tools/make-chiron-map.py (`Piece.abuts`, only `SOFA` uses it) · Learned: make the exception a named field that shows up in the diff rather than a lowered threshold — a cut on any side that is not listed still fails the build

## Calling `travelTo` from the console does not take you to the other world

What: driving the client over CDP, `window.__vto.connection.travelTo('chiron-office', ...)` returns `{ok: true}` and the header changes to "Chiron Office", but the scene goes on drawing the world you left — the screenshot shows the First Office's kitchen with the other world's name over it · Why: crossing a door is two steps, and only the first is on the connection: `OfficeScene.checkDoors` calls `travelTo` and *then* `this.scene.restart({ worldId })`; the restart is what loads the other map · Where: apps/client/src/game/OfficeScene.ts (`checkDoors`) · Learned: to check a world in the real client, walk into the door rectangle with key events — the shortcut proves nothing about the map you wanted to look at

## A panel that redraws on every state patch swallows its own clicks

What: `apps/client/src/ui/meetings.ts` keeps a signature string per redrawable part (the list, the room `<select>`, the invitee checkboxes) and rebuilds nothing until that signature changes · Why: `room.onStateChange` fires several times a second — everybody's footsteps are in the state — and `replaceChildren` destroys the node under the pointer before the click lands, so the Enter/Leave/Cancel buttons and the invite checkboxes would be effectively unclickable · Where: apps/client/src/ui/meetings.ts (`drawn`, `drawnRooms`, `drawnRoster`) · Learned: the same trap as the person card's per-frame render — any DOM driven by `onStateChange` needs this, not only per-frame ones

## A seated meeting participant is not "Focused"

What: `apps/client/src/ui/bubble.ts` and `ui/chat.ts` compute `focused` as `isFocused(me) && !isInMeeting(me)` · Why: a participant holds a seat at the meeting table, so `isFocused` alone is true for them, and the panels announced "Focused: conversations are off until you stand up" to somebody who was in the middle of a meeting conversation. On the server the same distinction is `playerStatus`, which puts `meeting` ahead of `focused` · Where: apps/client/src/ui/bubble.ts, apps/client/src/ui/chat.ts, packages/shared/src/schema.ts (`playerStatus`, `isInMeeting`) · Learned: found only by reading the toast log of a real browser run — the unit tests had no opinion about what the panel said
