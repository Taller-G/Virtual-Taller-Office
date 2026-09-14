/**
 * The worlds of the virtual office.
 *
 * A world is a place with its own map, its own people and its own chat: the
 * "First Office" is the first one, and you reach the others by **walking
 * through a door** (objects of class `door` in the map, see `docs/map.md`).
 *
 * This registry is the single source of truth, shared by client and server:
 * the server brings up one room per world and validates their maps at boot;
 * the client reads from here the map it has to draw and the name it shows.
 * Adding a world means adding an entry and its map file.
 */
export interface WorldDefinition {
  /** Internal, stable identifier: this is what doors name. */
  id: string
  /** Name shown inside the game. */
  name: string
  /** Tiled map file, inside `apps/client/public/assets/map/`. */
  mapFile: string
}

export const WORLDS: readonly WorldDefinition[] = [
  { id: 'first-office', name: 'First Office', mapFile: 'first-office.json' },
  { id: 'chiron-office', name: 'Chiron Office', mapFile: 'chiron-office.json' },
]

/** The world you enter when opening the app. */
export const DEFAULT_WORLD_ID = WORLDS[0].id

/** Public folder from which the client serves the maps. */
export const MAP_BASE_URL = '/assets/map/'

export function getWorld(id: string): WorldDefinition | undefined {
  return WORLDS.find((w) => w.id === id)
}

/** Visible name of the world; the id as a last resort. */
export function worldName(id: string): string {
  return getWorld(id)?.name ?? id
}

/**
 * Name under which a world's room is registered in Colyseus. One world = one
 * persistent room: participants, bubbles and chat stay separate without any
 * extra work.
 */
export function roomNameFor(worldId: string): string {
  return `world_${worldId.replace(/-/g, '_')}`
}

/** The world of a registered room, or `undefined` if the name is not a world's. */
export function worldForRoomName(roomName: string): WorldDefinition | undefined {
  return WORLDS.find((w) => roomNameFor(w.id) === roomName)
}

/** URL of the world's map as the client serves it. */
export function mapUrlFor(world: WorldDefinition): string {
  return `${MAP_BASE_URL}${world.mapFile}`
}
