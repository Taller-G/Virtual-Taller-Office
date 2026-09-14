import { defineServer, defineRoom, matchMaker, type RegisteredHandler } from 'colyseus'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { roomNameFor, WORLDS } from '@vto/shared'
import { config } from './config'
import { WorldRoom } from './rooms/WorldRoom'

/**
 * Una sala registrada por mundo: `world_first_office`, `world_chiron_office`…
 * Cada una hospeda el mismo `WorldRoom` con el mapa de su mundo, y la
 * separación entre mundos (gente, burbujas, chat) sale de ahí sin más código.
 */
const rooms: Record<string, RegisteredHandler> = Object.fromEntries(
  WORLDS.map((world) => [roomNameFor(world.id), defineRoom(WorldRoom, { worldId: world.id })]),
)

const server = defineServer({
  rooms,

  transport: new WebSocketTransport({
    pingInterval: config.pingIntervalMs,
    pingMaxRetries: config.pingMaxRetries,
  }),

  express: (app) => {
    // Chequeo de salud para el proveedor de hosting y para operar a mano:
    // dice qué mundos están vivos y cuánta gente hay en cada uno.
    app.get('/health', async (_req, res) => {
      const worlds = []
      for (const world of WORLDS) {
        const rooms = await matchMaker.query({ name: roomNameFor(world.id) })
        worlds.push({
          id: world.id,
          name: world.name,
          rooms: rooms.length,
          players: rooms.reduce((total, room) => total + room.clients, 0),
        })
      }
      res.json({
        status: 'ok',
        worlds,
        players: worlds.reduce((total, world) => total + world.players, 0),
      })
    })
  },
})

export default server
