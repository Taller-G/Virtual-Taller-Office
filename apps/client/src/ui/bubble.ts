import type { OfficeConnection, OfficeRoom } from '../network/connection'
import { avatarThumb } from './avatarThumb'
import { toast } from './toasts'

interface Member {
  sessionId: string
  name: string
  avatar: string
}

/** Lo que hay que mostrar sobre mi burbuja, derivado del estado del servidor. */
interface BubbleView {
  /** Id de mi burbuja, o `''` si no estoy en ninguna. */
  bubbleId: string
  /** Miembros de mi burbuja: yo primero, después el resto por nombre. */
  members: Member[]
  /** Tengo al alcance una burbuja que ya está en el tope y no me deja entrar. */
  fullNearby: boolean
  /** Tope de miembros que informa el servidor. */
  maxMembers: number
}

const EMPTY: BubbleView = { bubbleId: '', members: [], fullNearby: false, maxMembers: 0 }

/**
 * Panel "En conversación" + avisos de burbuja.
 *
 * Todo se deriva de `state.bubbles` y de `player.bubbleId`: el cliente no
 * decide ni recuerda quién está en su burbuja, solo dibuja lo que dice el
 * servidor. Se recalcula con cada patch (`onStateChange`) y los avisos salen
 * de comparar la vista nueva con la anterior, así entrar, salir, sumarse
 * alguien o irse alguien se avisan una sola vez.
 */
export function mountBubble(connection: OfficeConnection) {
  const panel = document.getElementById('bubble')!
  const titleEl = panel.querySelector<HTMLElement>('#bubble-title')!
  const hintEl = panel.querySelector<HTMLElement>('#bubble-hint')!
  const listEl = panel.querySelector<HTMLElement>('#bubble-list')!

  let previous: BubbleView = EMPTY
  let unbind: (() => void) | undefined

  function view(room: OfficeRoom): BubbleView {
    const state = room.state
    const me = state.players.get(room.sessionId)
    const maxMembers = state.bubbleMaxMembers
    if (!me) return { ...EMPTY, maxMembers }

    const bubble = me.bubbleId ? state.bubbles.get(me.bubbleId) : undefined
    if (!bubble) {
      // Sin burbuja: ¿hay alguna al alcance que esté llena?
      let fullNearby = false
      state.bubbles.forEach((other) => {
        const full = other.members.length >= maxMembers
        if (full && Math.hypot(me.x - other.x, me.y - other.y) <= state.bubbleRadius) {
          fullNearby = true
        }
      })
      return { bubbleId: '', members: [], fullNearby, maxMembers }
    }

    const members: Member[] = []
    for (const sessionId of bubble.members) {
      const player = state.players.get(sessionId)
      if (player) members.push({ sessionId, name: player.name, avatar: player.avatar })
    }
    members.sort((a, b) => {
      if (a.sessionId === room.sessionId) return -1
      if (b.sessionId === room.sessionId) return 1
      return a.name.localeCompare(b.name, 'es')
    })
    return { bubbleId: me.bubbleId, members, fullNearby: false, maxMembers }
  }

  function render(next: BubbleView, mySessionId: string) {
    const others = next.members.filter((m) => m.sessionId !== mySessionId)
    panel.dataset.state = next.bubbleId ? 'in' : next.fullNearby ? 'full' : 'none'
    titleEl.textContent = next.bubbleId
      ? `En conversación · ${next.members.length}`
      : 'En conversación'
    hintEl.textContent = next.bubbleId
      ? others.length === 0
        ? 'Esperando a alguien más…'
        : ''
      : next.fullNearby
        ? `Esa burbuja está llena (tope ${next.maxMembers}).`
        : 'Acercate a alguien para abrir una burbuja.'
    listEl.replaceChildren(
      ...next.members.map((member) => {
        const li = document.createElement('li')
        li.className = 'bubble__row'
        li.dataset.session = member.sessionId
        const name = document.createElement('span')
        name.className = 'bubble__name'
        name.textContent = member.name
        if (member.sessionId === mySessionId) {
          const you = document.createElement('span')
          you.className = 'presence__you'
          you.textContent = 'vos'
          name.append(' ', you)
        }
        li.append(avatarThumb(member.avatar, 1), name)
        return li
      }),
    )
  }

  /** Avisos: entrar, salir, y quién se suma o se va de mi burbuja. */
  function announce(next: BubbleView, mySessionId: string, room: OfficeRoom) {
    const names = (members: Member[]) =>
      members
        .filter((m) => m.sessionId !== mySessionId)
        .map((m) => m.name)
        .join(', ')

    if (next.bubbleId !== previous.bubbleId) {
      if (next.bubbleId) {
        const withWhom = names(next.members)
        toast(
          withWhom ? `Entraste en una conversación con ${withWhom}` : 'Abriste una conversación',
        )
      } else if (previous.bubbleId) {
        // Si la burbuja ya no existe, se cerró (quedó una sola persona);
        // si sigue existiendo, el que salió fui yo.
        toast(
          room.state.bubbles.has(previous.bubbleId)
            ? 'Saliste de la conversación'
            : 'Se cerró la conversación',
        )
      }
    } else if (next.bubbleId) {
      const before = new Set(previous.members.map((m) => m.sessionId))
      const after = new Set(next.members.map((m) => m.sessionId))
      for (const member of next.members) {
        if (member.sessionId !== mySessionId && !before.has(member.sessionId)) {
          toast(`${member.name} se sumó a la conversación`)
        }
      }
      for (const member of previous.members) {
        if (member.sessionId !== mySessionId && !after.has(member.sessionId)) {
          toast(`${member.name} se fue de la conversación`)
        }
      }
    }

    if (next.fullNearby && !previous.fullNearby) {
      toast(`Esa burbuja está llena (tope ${next.maxMembers}): no podés entrar`)
    }
  }

  function bind(room: OfficeRoom) {
    unbind?.()
    previous = EMPTY
    const refresh = () => {
      const next = view(room)
      announce(next, room.sessionId, room)
      render(next, room.sessionId)
      previous = next
    }
    const handler = () => refresh()
    room.onStateChange(handler)
    unbind = () => room.onStateChange.remove(handler)
    refresh()
  }

  function clear() {
    unbind?.()
    unbind = undefined
    previous = EMPTY
    render(EMPTY, '')
  }

  connection.on('room', bind)
  if (connection.room) bind(connection.room)
  connection.on('status', (status) => {
    if (status === 'disconnected') clear()
  })
  render(EMPTY, '')
}
