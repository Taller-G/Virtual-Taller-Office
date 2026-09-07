import { Callbacks } from '@colyseus/sdk'
import { ROOM_DISPLAY_NAME } from '@vto/shared'
import type { ConnectionStatus, OfficeConnection } from '../network/connection'

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  connecting: 'Conectando…',
  connected: `Conectado a ${ROOM_DISPLAY_NAME}`,
  reconnecting: 'Se cortó la conexión. Reconectando…',
  disconnected: 'Desconectado',
}

/** Barra superior: estado de conexión, identidad propia y cantidad de jugadores. */
export function mountHud(connection: OfficeConnection) {
  const hud = document.getElementById('hud')!
  const statusEl = document.getElementById('hud-status')!
  const playersEl = document.getElementById('hud-players')!
  let myName = ''
  let unbind: (() => void)[] = []

  connection.on('status', (status, detail) => {
    hud.dataset.status = status
    let text = STATUS_TEXT[status]
    if (status === 'connected' && myName) text += ` como ${myName}`
    if (detail && status !== 'connected') text += ` · ${detail}`
    statusEl.textContent = text
    if (status !== 'connected' && status !== 'reconnecting') playersEl.textContent = ''
  })

  connection.on('room', (room) => {
    for (const off of unbind.splice(0)) off()
    const $ = Callbacks.get(room)
    const refresh = () => {
      const n = room.state.players.size
      playersEl.textContent = `${n} ${n === 1 ? 'persona' : 'personas'} en la oficina`
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
