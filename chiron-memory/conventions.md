# convention

A rule the codebase follows — naming, patterns, and where things live.

## Map spawns: the unnamed one is the world entrance, named ones are door arrivals

What: A map has exactly one `spawn` object without a name (or named `spawn`) — the world entrance — plus any number of named spawns, each the target of a door in another map; optional `dir` gives the facing on arrival and `radius` the scatter · Why: doors have to name where they land, and the entrance has to stay unambiguous for people entering the world from the app · Where: packages/shared/src/map.ts, docs/mapa.md · Learned: put an arrival spawn outside the return door's area (and give it a small radius) or the traveller is sent straight back
