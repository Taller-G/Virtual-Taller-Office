import { listen } from '@colyseus/tools'
import { matchMaker } from 'colyseus'
import { ROOM_NAME, ROOM_DISPLAY_NAME } from '@vto/shared'
import app from './app.config'
import { config } from './config'

/**
 * Garantiza que la sala única exista desde el arranque. Así dos clientes que
 * entran a la vez no pueden crear dos instancias en paralelo: `joinOrCreate`
 * siempre encuentra la que ya está viva.
 */
async function ensureSingleRoom() {
  const existing = await matchMaker.query({ name: ROOM_NAME })
  if (existing.length > 0) return
  const room = await matchMaker.createRoom(ROOM_NAME, {})
  console.log(`[servidor] sala "${ROOM_DISPLAY_NAME}" lista (roomId=${room.roomId})`)
}

await listen(app, config.port)
await ensureSingleRoom()
