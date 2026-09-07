import { defineServer, defineRoom, matchMaker } from 'colyseus'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { ROOM_NAME, ROOM_DISPLAY_NAME } from '@vto/shared'
import { config } from './config'
import { OficinaTallerRoom } from './rooms/OficinaTallerRoom'

const server = defineServer({
  rooms: {
    [ROOM_NAME]: defineRoom(OficinaTallerRoom),
  },

  transport: new WebSocketTransport({
    pingInterval: config.pingIntervalMs,
    pingMaxRetries: config.pingMaxRetries,
  }),

  express: (app) => {
    // Chequeo de salud para el proveedor de hosting y para operar a mano.
    app.get('/health', async (_req, res) => {
      const rooms = await matchMaker.query({ name: ROOM_NAME })
      res.json({
        status: 'ok',
        room: ROOM_DISPLAY_NAME,
        rooms: rooms.length,
        players: rooms.reduce((total, room) => total + room.clients, 0),
      })
    })
  },
})

export default server
