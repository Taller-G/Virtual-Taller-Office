/**
 * Los mundos de la oficina virtual.
 *
 * Un mundo es un lugar con su propio mapa, su propia gente y su propio chat:
 * la "First Office" es el primero, y se llega a los demás **caminando por una
 * puerta** (objetos de clase `door` en el mapa, ver `docs/mapa.md`).
 *
 * Este registro es la única fuente de verdad, compartida por cliente y
 * servidor: el servidor levanta una sala por mundo y valida sus mapas al
 * arrancar; el cliente carga de acá el mapa que tiene que dibujar y el nombre
 * que muestra. Agregar un mundo es agregar una entrada y su archivo de mapa.
 */
export interface WorldDefinition {
  /** Identificador interno y estable: es lo que nombran las puertas. */
  id: string
  /** Nombre visible dentro del juego. */
  name: string
  /** Archivo del mapa Tiled, dentro de `apps/client/public/assets/map/`. */
  mapFile: string
}

export const WORLDS: readonly WorldDefinition[] = [
  { id: 'first-office', name: 'First Office', mapFile: 'oficina-taller.json' },
  { id: 'chiron-office', name: 'Chiron Office', mapFile: 'chiron-office.json' },
]

/** Mundo al que se entra al abrir la app. */
export const DEFAULT_WORLD_ID = WORLDS[0].id

/** Carpeta pública donde el cliente sirve los mapas. */
export const MAP_BASE_URL = '/assets/map/'

export function getWorld(id: string): WorldDefinition | undefined {
  return WORLDS.find((w) => w.id === id)
}

/** Nombre visible del mundo; el id como último recurso. */
export function worldName(id: string): string {
  return getWorld(id)?.name ?? id
}

/**
 * Nombre con el que se registra la sala de un mundo en Colyseus. Un mundo =
 * una sala persistente: participantes, burbujas y chat quedan separados sin
 * hacer nada más.
 */
export function roomNameFor(worldId: string): string {
  return `world_${worldId.replace(/-/g, '_')}`
}

/** El mundo de una sala registrada, o `undefined` si el nombre no es de un mundo. */
export function worldForRoomName(roomName: string): WorldDefinition | undefined {
  return WORLDS.find((w) => roomNameFor(w.id) === roomName)
}

/** URL del mapa del mundo tal como lo sirve el cliente. */
export function mapUrlFor(world: WorldDefinition): string {
  return `${MAP_BASE_URL}${world.mapFile}`
}
