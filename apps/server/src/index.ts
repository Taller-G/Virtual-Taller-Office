import { listen } from '@colyseus/tools'
import { matchMaker } from 'colyseus'
import { roomNameFor, WORLDS } from '@vto/shared'
import app from './app.config'
import { config } from './config'
import { worldMaps } from './map'

/**
 * Deja viva la sala de cada mundo desde el arranque. Así dos clientes que
 * entran a la vez no pueden crear dos instancias del mismo mundo en paralelo,
 * y una puerta siempre encuentra su destino en pie.
 */
async function ensureWorldRooms() {
  for (const world of WORLDS) {
    const name = roomNameFor(world.id)
    const existing = await matchMaker.query({ name })
    if (existing.length > 0) continue
    const room = await matchMaker.createRoom(name, {})
    console.log(`[servidor] mundo "${world.name}" listo (sala ${name}, roomId=${room.roomId})`)
  }
}

// Los mapas de todos los mundos se leen y validan antes de escuchar: una
// puerta rota o un mapa inválido tienen que fallar acá, no con gente adentro.
worldMaps()

await listen(app, config.port)
await ensureWorldRooms()
