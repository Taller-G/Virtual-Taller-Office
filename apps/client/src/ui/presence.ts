import { Callbacks } from '@colyseus/sdk'
import {
  NAME_MAX_LENGTH,
  PLAYER_STATUS_TEXT,
  playerStatus,
  sanitizeName,
  type Player,
} from '@vto/shared'
import type { OfficeConnection, OfficeRoom } from '../network/connection'
import { avatarBadge } from './avatarThumb'
import { personColors } from './personColor'
import { toast } from './toasts'
import { youTag } from './youTag'

/**
 * The "who is in the office" panel + join/leave notices + one's own controls
 * (rename, mark yourself away).
 *
 * The list is a direct reflection of `room.state.players`: entries are added
 * in `onAdd`, removed in `onRemove` and redrawn with every change of name,
 * avatar, presence or connection. The client never adds or retains players
 * on its own; on changing room or disconnecting, it is emptied.
 *
 * The status of each row comes from `playerStatus()`, shared with the server:
 * "Focused" (sitting at a focus desk) is a state of its own, apart from away
 * and from offline, and while someone is in it nobody can open a conversation
 * with them.
 */
export function mountPresence(connection: OfficeConnection) {
  const panel = document.getElementById('presence')!
  const countEl = panel.querySelector<HTMLElement>('#presence-count')!
  const listEl = panel.querySelector<HTMLElement>('#presence-list')!
  const nameInput = panel.querySelector<HTMLInputElement>('#my-name')!
  const awayButton = panel.querySelector<HTMLButtonElement>('#away-toggle')!

  nameInput.maxLength = NAME_MAX_LENGTH

  /** Players present according to the server, by sessionId. */
  const players = new Map<string, Player>()
  let room: OfficeRoom | undefined
  const unbind: Array<() => void> = []

  const me = () => (room ? players.get(room.sessionId) : undefined)

  function render() {
    const mine = me()
    const others = [...players.entries()]
      .filter(([id]) => id !== room?.sessionId)
      .sort(([, a], [, b]) => a.name.localeCompare(b.name, 'en'))
    const rows = mine ? [[room!.sessionId, mine] as const, ...others] : others

    const n = players.size
    countEl.textContent = n === 0 ? '' : String(n)
    const colors = personColors(room)
    listEl.replaceChildren(
      ...rows.map(([id, player]) =>
        row(player, id === room?.sessionId, colors.get(id) ?? 'var(--accent-bright)'),
      ),
    )
    // Alone in the office: said out loud, so an all-but-empty list reads as a
    // fact about the office and not as a list that failed to load.
    if (mine && others.length === 0) {
      const alone = document.createElement('li')
      alone.className = 'presence__alone'
      alone.textContent = 'Nobody else is here yet.'
      listEl.append(alone)
    }

    if (mine) {
      if (document.activeElement !== nameInput) nameInput.value = mine.name
      awayButton.textContent = mine.away ? 'Back to active' : 'Mark me away'
      awayButton.setAttribute('aria-pressed', String(mine.away))
      awayButton.title = mine.away
        ? mine.awayManual
          ? 'You set the away state by hand'
          : 'Away through inactivity; move or click to come back'
        : playerStatus(mine) === 'focused'
          ? 'You are focused at a desk; marking yourself away frees the seat'
          : 'Everyone else will see you as away until you clear it'
    }
    panel.dataset.state = mine ? 'in' : 'out'
  }

  function row(player: Player, isMe: boolean, color: string): HTMLLIElement {
    const li = document.createElement('li')
    li.className = 'presence__row'
    li.dataset.session = player.sessionId
    li.dataset.me = String(isMe)
    const status = playerStatus(player)
    li.dataset.status = status
    // The person's colour, for the ring on the portrait and the name.
    li.style.setProperty('--person', color)

    const name = document.createElement('span')
    name.className = 'presence__name'
    name.textContent = player.name
    if (isMe) name.append(' ', youTag())

    const statusEl = document.createElement('span')
    statusEl.className = 'presence__status'
    statusEl.textContent = PLAYER_STATUS_TEXT[status]
    if (status === 'focused') statusEl.title = 'Heads-down at a desk: not available to talk'

    const text = document.createElement('span')
    text.className = 'presence__text'
    text.append(name, statusEl)

    li.append(avatarBadge(player.avatar, color, 40), text)
    return li
  }

  function bind(newRoom: OfficeRoom) {
    clear()
    room = newRoom
    const $ = Callbacks.get(newRoom)
    // The immediate `onAdd`s (players who were already there) raise no notice.
    let initial = true
    unbind.push(
      $.onAdd('players', (player, sessionId) => {
        players.set(sessionId, player)
        unbind.push(
          $.listen(player, 'name', render),
          $.listen(player, 'avatar', render),
          $.listen(player, 'away', render),
          $.listen(player, 'seatId', render),
          $.listen(player, 'connected', render),
        )
        if (!initial && sessionId !== newRoom.sessionId) toast(`${player.name} joined the office`)
        render()
      }),
      $.onRemove('players', (player, sessionId) => {
        players.delete(sessionId)
        if (sessionId !== newRoom.sessionId) toast(`${player.name} left the office`)
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

  // --- Own controls ----------------------------------------------------------

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
      nameInput.blur() // fires the commit on `blur` and gives the keyboard back to the game
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
