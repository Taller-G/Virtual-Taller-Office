import type { OfficeConnection, OfficeRoom } from '../network/connection'
import { avatarThumb } from './avatarThumb'
import { toast } from './toasts'

interface Member {
  sessionId: string
  name: string
  avatar: string
}

/** What has to be shown about my bubble, derived from the server's state. */
interface BubbleView {
  /** Id of my bubble, or `''` if I am in none. */
  bubbleId: string
  /** Members of my bubble: me first, then the rest by name. */
  members: Member[]
  /** There is a bubble within my reach that is at the cap and will not let me in. */
  fullNearby: boolean
  /** Member cap reported by the server. */
  maxMembers: number
}

const EMPTY: BubbleView = { bubbleId: '', members: [], fullNearby: false, maxMembers: 0 }

/**
 * The "In conversation" panel + bubble notices.
 *
 * Everything is derived from `state.bubbles` and `player.bubbleId`: the client
 * neither decides nor remembers who is in its bubble, it only draws what the
 * server says. It is recomputed with every patch (`onStateChange`) and the
 * notices come from comparing the new view with the previous one, so joining,
 * leaving, someone joining and someone leaving are each announced once.
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
      // No bubble: is there one within reach that is full?
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
      return a.name.localeCompare(b.name, 'en')
    })
    return { bubbleId: me.bubbleId, members, fullNearby: false, maxMembers }
  }

  function render(next: BubbleView, mySessionId: string) {
    const others = next.members.filter((m) => m.sessionId !== mySessionId)
    panel.dataset.state = next.bubbleId ? 'in' : next.fullNearby ? 'full' : 'none'
    titleEl.textContent = next.bubbleId
      ? `In conversation - ${next.members.length}`
      : 'In conversation'
    hintEl.textContent = next.bubbleId
      ? others.length === 0
        ? 'Waiting for someone else...'
        : ''
      : next.fullNearby
        ? `That bubble is full (cap ${next.maxMembers}).`
        : 'Walk up to someone to open a bubble.'
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
          you.textContent = 'you'
          name.append(' ', you)
        }
        li.append(avatarThumb(member.avatar, 1), name)
        return li
      }),
    )
  }

  /** Notices: joining, leaving, and who joins or leaves my bubble. */
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
          withWhom ? `You joined a conversation with ${withWhom}` : 'You opened a conversation',
        )
      } else if (previous.bubbleId) {
        // If the bubble no longer exists, it closed (a single person was
        // left); if it still exists, the one who left was me.
        toast(
          room.state.bubbles.has(previous.bubbleId)
            ? 'You left the conversation'
            : 'The conversation closed',
        )
      }
    } else if (next.bubbleId) {
      const before = new Set(previous.members.map((m) => m.sessionId))
      const after = new Set(next.members.map((m) => m.sessionId))
      for (const member of next.members) {
        if (member.sessionId !== mySessionId && !before.has(member.sessionId)) {
          toast(`${member.name} joined the conversation`)
        }
      }
      for (const member of previous.members) {
        if (member.sessionId !== mySessionId && !after.has(member.sessionId)) {
          toast(`${member.name} left the conversation`)
        }
      }
    }

    if (next.fullNearby && !previous.fullNearby) {
      toast(`That bubble is full (cap ${next.maxMembers}): you cannot join`)
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
