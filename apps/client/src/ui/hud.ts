import { Callbacks } from '@colyseus/sdk'
import { worldName } from '@vto/shared'
import type { ConnectionStatus, OfficeConnection } from '../network/connection'

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  connecting: 'Conectando…',
  connected: 'Conectado',
  reconnecting: 'Se cortó la conexión. Reconectando…',
  disconnected: 'Desconectado',
}

/**
 * Barra superior: estado de conexión, en qué mundo estoy, identidad propia y
 * cuánta gente hay **en este mundo** (cada mundo es su propia sala).
 */
export function mountHud(connection: OfficeConnection) {
  const hud = document.getElementById('hud')!
  const statusEl = document.getElementById('hud-status')!
  const worldEl = document.getElementById('hud-world')!
  const playersEl = document.getElementById('hud-players')!
  let myName = ''
  let unbind: (() => void)[] = []

  const showWorld = (name: string) => {
    worldEl.textContent = name
    worldEl.hidden = name === ''
  }
  // El nombre del mundo lo dice el servidor al entrar; al cruzar una puerta se
  // actualiza en cuanto la sala nueva contesta.
  connection.on('roomInfo', (info) => showWorld(info.name))
  connection.on('world', (worldId) => showWorld(worldName(worldId)))

  connection.on('status', (status, detail) => {
    hud.dataset.status = status
    let text = STATUS_TEXT[status]
    if (status === 'connected' && myName) text += ` como ${myName}`
    if (detail && status !== 'connected') text += ` · ${detail}`
    statusEl.textContent = text
    if (status !== 'connected' && status !== 'reconnecting') playersEl.textContent = ''
    if (status === 'disconnected') showWorld('')
  })

  connection.on('room', (room) => {
    for (const off of unbind.splice(0)) off()
    const $ = Callbacks.get(room)
    const refresh = () => {
      const n = room.state.players.size
      playersEl.textContent = `${n} ${n === 1 ? 'persona' : 'personas'} en este mundo`
      const me = room.state.players.get(room.sessionId)
      if (me && me.name !== myName) {
        myName = me.name
        if (connection.status === 'connected') {
          statusEl.textContent = `${STATUS_TEXT.connected} como ${myName}`
        }
      }
    }
    unbind = [
      $.onAdd('players', (player, sessionId) => {
        refresh()
        if (sessionId === room.sessionId) unbind.push($.listen(player, 'name', refresh))
      }),
      $.onRemove('players', refresh),
    ]
  })
}
