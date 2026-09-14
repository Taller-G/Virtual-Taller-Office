import { defineServer, defineRoom, matchMaker, type RegisteredHandler } from 'colyseus'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { roomNameFor, WORLDS } from '@vto/shared'
import { config } from './config'
import { WorldRoom } from './rooms/WorldRoom'

/**
 * One registered room per world: `world_first_office`, `world_chiron_office`...
 * Each one hosts the same `WorldRoom` with its world's map, and the
 * separation between worlds (people, bubbles, chat) follows from that with no
 * extra code.
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
    // Health check for the hosting provider and for manual operation: it
    // says which worlds are alive and how many people are in each one.
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
