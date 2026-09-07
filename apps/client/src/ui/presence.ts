import { Callbacks } from '@colyseus/sdk'
import { NAME_MAX_LENGTH, sanitizeName, type Player } from '@vto/shared'
import type { OfficeConnection, OfficeRoom } from '../network/connection'
import { avatarThumb } from './avatarThumb'
import { toast } from './toasts'

/**
 * Panel "quién está en la oficina" + avisos de entrada/salida + controles
 * propios (renombrar, marcarse ausente).
 *
 * La lista es un reflejo directo de `room.state.players`: se agrega en
 * `onAdd`, se quita en `onRemove` y se redibuja con cada cambio de nombre,
 * avatar, ausente o conexión. El cliente nunca agrega ni retiene jugadores por
 * su cuenta; al cambiar de sala o desconectarse, se vacía.
 */
export function mountPresence(connection: OfficeConnection) {
  const panel = document.getElementById('presence')!
  const countEl = panel.querySelector<HTMLElement>('#presence-count')!
  const listEl = panel.querySelector<HTMLElement>('#presence-list')!
  const nameInput = panel.querySelector<HTMLInputElement>('#my-name')!
  const awayButton = panel.querySelector<HTMLButtonElement>('#away-toggle')!

  nameInput.maxLength = NAME_MAX_LENGTH

  /** Jugadores presentes según el servidor, por sessionId. */
  const players = new Map<string, Player>()
  let room: OfficeRoom | undefined
  const unbind: Array<() => void> = []

  const me = () => (room ? players.get(room.sessionId) : undefined)

  function render() {
    const mine = me()
    const others = [...players.entries()]
      .filter(([id]) => id !== room?.sessionId)
      .sort(([, a], [, b]) => a.name.localeCompare(b.name, 'es'))
    const rows = mine ? [[room!.sessionId, mine] as const, ...others] : others

    const n = players.size
    countEl.textContent = n === 0 ? '' : String(n)
    listEl.replaceChildren(...rows.map(([id, player]) => row(player, id === room?.sessionId)))

    if (mine) {
      if (document.activeElement !== nameInput) nameInput.value = mine.name
      awayButton.textContent = mine.away ? 'Volver a activo' : 'Marcarme ausente'
      awayButton.setAttribute('aria-pressed', String(mine.away))
      awayButton.title = mine.away
        ? mine.awayManual
          ? 'Fijaste el estado ausente a mano'
          : 'Ausente por inactividad; movete o hacé clic para volver'
        : 'Los demás te verán como ausente hasta que lo quites'
    }
    panel.dataset.state = mine ? 'in' : 'out'
  }

  function row(player: Player, isMe: boolean): HTMLLIElement {
    const li = document.createElement('li')
    li.className = 'presence__row'
    li.dataset.session = player.sessionId
    li.dataset.status = !player.connected ? 'offline' : player.away ? 'away' : 'active'
    const name = document.createElement('span')
    name.className = 'presence__name'
    name.textContent = player.name
    if (isMe) {
      const you = document.createElement('span')
      you.className = 'presence__you'
      you.textContent = 'vos'
      name.append(' ', you)
    }
    const status = document.createElement('span')
    status.className = 'presence__status'
    status.textContent = !player.connected ? 'sin conexión' : player.away ? 'ausente' : 'activo'
    li.append(avatarThumb(player.avatar, 1), name, status)
    return li
  }

  function bind(newRoom: OfficeRoom) {
    clear()
    room = newRoom
    const $ = Callbacks.get(newRoom)
    // Los `onAdd` inmediatos (jugadores que ya estaban) no generan aviso.
    let initial = true
    unbind.push(
      $.onAdd('players', (player, sessionId) => {
        players.set(sessionId, player)
        unbind.push(
          $.listen(player, 'name', render),
          $.listen(player, 'avatar', render),
          $.listen(player, 'away', render),
          $.listen(player, 'connected', render),
        )
        if (!initial && sessionId !== newRoom.sessionId) toast(`${player.name} entró a la oficina`)
        render()
      }),
      $.onRemove('players', (player, sessionId) => {
        players.delete(sessionId)
        if (sessionId !== newRoom.sessionId) toast(`${player.name} salió de la oficina`)
        render()
      }),
    )
    initial = false
    render()
  }

  function clear() {
    for (const off of unbind.splice(0)) off()
    players.clear()
    room = undefined
    render()
  }

  connection.on('room', bind)
  if (connection.room) bind(connection.room)
  connection.on('status', (status) => {
    if (status === 'disconnected') clear()
  })

  // --- Controles propios -----------------------------------------------------

  const commitName = () => {
    const name = sanitizeName(nameInput.value)
    const mine = me()
    if (!mine) return
    if (!name) {
      nameInput.value = mine.name
      return
    }
    if (name !== mine.name) connection.setName(name)
  }
  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      nameInput.blur() // dispara el commit en `blur` y devuelve el teclado al juego
    } else if (event.key === 'Escape') {
      nameInput.value = me()?.name ?? ''
      nameInput.blur()
    }
  })
  nameInput.addEventListener('blur', commitName)

  awayButton.addEventListener('click', () => {
    const mine = me()
    if (!mine) return
    connection.setAway(!mine.away)
    awayButton.blur()
  })

  render()
}
