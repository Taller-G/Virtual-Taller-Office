# gotcha

A non-obvious pitfall or trap, learned the hard way.

## Never leave a floor tile under a colliding wall tile

What: In the Piso layer, a non-zero tile at a position where Paredes has a colliding tile makes the "capas separadas de piso, paredes…" test fail · Why: that test classifies a tile layer as a collision layer when any of its non-zero tiles sits on a solid position, and it requires at least one layer without collisions · Where: apps/server/test/map.test.ts · Learned: when building walls, clear the floor underneath them (and only put floor in the doorway gaps)

## The Taller logo is positioned by code, not by the map

What: The logo is a floor decal placed by addReceptionLogo() at LOGO_ZONE_FRAC_X of the width of the zone named "Recepción" — moving it means editing that fraction, not the Tiled file; the free floor band is x 696-928 at y 160-192, between the waiting bench and the reception counter · Why: the logo is an app asset, not map data, so the map stays replaceable without losing the branding · Where: apps/client/src/game/officeMap.ts
