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

## The avatar sheets are 2x art: one drawn pixel is a 2x2 block

What: inside a 32x48 frame the LimeZu art is drawn at 16x24 and scaled up, so every source pixel is an identical 2x2 block · Why: nothing in the format says so, and a layer drawn one pixel at a time still composites correctly — it just reads as a finer sprite glued onto a coarser one, which is the kind of wrongness you see without being able to name it · Where: tools/avatar_frames.py (`ART`, `get_art`, `put_art`), tools/split-layers.py · Learned: check for the doubling before drawing anything new (compare `px[x,y]` with `px[x+1,y]` and `px[x,y+1]` over a frame); tools/gen-accessories.py predates the check and its hats are drawn on the fine grid

## A tint multiplies, so a greyscale layer has to be stretched to white

What: `setTint()` multiplies the texel, so a greyscale layer that keeps the art's own luminance (an olive shirt around 40% grey) turns every colour you pick into a dark version of itself — pink hair came out maroon · Why: the layers were split by converting to luminance, which is right for keeping the shading and wrong for keeping the colour · Where: tools/split-layers.py (`normalize`) · Learned: scale each layer by a single factor so its brightest shade is white; the shading survives because the ratios do

## Every base's shoes are painted in its own shirt colour

What: on all four bases the feet reuse a shade of the shirt (adam's purple, ash's maroon, nancy's grey-blue) and lucy's reuse a skin shade, so no colour list can tell a shoe from a sleeve · Why: they are one character's palette, not a set of parts · Where: tools/split-layers.py (`frame_hem`, `SHOES`) · Learned: find the hem first — the row under the lowest shirt pixel above `HEM_MAX` — and only look for shoe colours below it; a hem guessed from how wide the silhouette is drifts by an art pixel in the frames where one leg is lifted, and a drifting hem paints a stripe of shirt in the trouser colour

## adam's hair and shirt colour sets were the wrong way round

What: `HAIR["adam"]` held the purple of his shirt and `TOP["adam"]` the olive of his hair, so `hairColor` tinted his shirt and `topColor` his hair · Why: both sets are plausible-looking lists of hex triples and nothing checks which part they land on; the split still produced two clean layers · Where: tools/split-layers.py · Learned: after splitting, compare the mean y of each layer's pixels — hair belongs around y 15, a shirt around y 34; they are impossible to mix up that way
