import { listen } from '@colyseus/tools'
import { matchMaker } from 'colyseus'
import { roomNameFor, WORLDS } from '@vto/shared'
import app from './app.config'
import { config } from './config'
import { worldMaps } from './map'

/**
 * Keeps every world's room alive from boot. That way two clients joining at
 * the same time cannot create two instances of the same world in parallel,
 * and a door always finds its destination standing.
 */
async function ensureWorldRooms() {
  for (const world of WORLDS) {
    const name = roomNameFor(world.id)
    const existing = await matchMaker.query({ name })
    if (existing.length > 0) continue
    const room = await matchMaker.createRoom(name, {})
    console.log(`[server] world "${world.name}" ready (room ${name}, roomId=${room.roomId})`)
  }
}

// The maps of every world are read and validated before listening: a broken
// door or an invalid map has to fail here, not with people inside.
worldMaps()

await listen(app, config.port)
await ensureWorldRooms()
