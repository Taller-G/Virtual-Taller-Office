import { isFocused, isInMeeting } from '@vto/shared'
import type { OfficeConnection, OfficeRoom } from '../network/connection'
import { avatarBadge } from './avatarThumb'
import { personColors } from './personColor'
import { toast } from './toasts'
import { youTag } from './youTag'

interface Member {
  sessionId: string
  name: string
  avatar: string
}

/** What has to be shown about my bubble, derived from the server's state. */
interface BubbleView {
  /** Id of my bubble, or `''` if I am in none. */
  bubbleId: string
  /**
   * Title of the meeting this conversation is, or `''` for an ordinary
   * proximity bubble. A meeting's members are not the people near you, and
   * saying which meeting it is, is what makes that read right.
   */
  meeting: string
  /** Members of my bubble: me first, then the rest by name. */
  members: Member[]
  /** There is a bubble within my reach that is at the cap and will not let me in. */
  fullNearby: boolean
  /** I am sitting at a focus desk: no conversation until I stand up. */
  focused: boolean
  /** Member cap reported by the server. */
  maxMembers: number
}

const EMPTY: BubbleView = {
  bubbleId: '',
  meeting: '',
  members: [],
  fullNearby: false,
  focused: false,
  maxMembers: 0,
}

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

    // Sitting at a meeting table is not being heads-down: a participant holds
    // a seat, but their conversation is the meeting's and it is wide open.
    const focused = isFocused(me) && !isInMeeting(me)
    const bubble = me.bubbleId ? state.bubbles.get(me.bubbleId) : undefined
    if (!bubble) {
      // No bubble: is there one within reach that is full? (While focused the
      // answer does not matter: none of them would take me anyway.) A meeting
      // is never the answer either: it is not full, it is simply not mine —
      // you get into one by entering it, not by standing next to it.
      let fullNearby = false
      state.bubbles.forEach((other) => {
        if (other.meetingId !== '') return
        const full = other.members.length >= maxMembers
        if (!focused && full && Math.hypot(me.x - other.x, me.y - other.y) <= state.bubbleRadius) {
          fullNearby = true
        }
      })
      return { bubbleId: '', meeting: '', members: [], fullNearby, focused, maxMembers }
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
    const meeting = bubble.meetingId ? (state.meetings.get(bubble.meetingId)?.title ?? '') : ''
    return { bubbleId: me.bubbleId, meeting, members, fullNearby: false, focused, maxMembers }
  }

  function render(next: BubbleView, mySessionId: string, room?: OfficeRoom) {
    const others = next.members.filter((m) => m.sessionId !== mySessionId)
    panel.dataset.state = next.bubbleId
      ? 'in'
      : next.focused
        ? 'focused'
        : next.fullNearby
          ? 'full'
          : 'none'
    titleEl.textContent = next.bubbleId
      ? next.meeting
        ? `${next.meeting} - ${next.members.length}`
        : `In conversation - ${next.members.length}`
      : 'In conversation'
    hintEl.textContent = next.bubbleId
      ? others.length === 0
        ? next.meeting
          ? 'Waiting for the others to come in...'
          : 'Waiting for someone else...'
        : ''
      : next.focused
        ? 'Focused at a desk: nobody can start a conversation with you. Press E or move to stand up.'
        : next.fullNearby
          ? `That bubble is full (cap ${next.maxMembers}).`
          : 'Walk up to someone to open a bubble.'
    const colors = personColors(room)
    listEl.replaceChildren(
      ...next.members.map((member) => {
        const color = colors.get(member.sessionId) ?? 'var(--accent-bright)'
        const li = document.createElement('li')
        li.className = 'bubble__row'
        li.dataset.session = member.sessionId
        li.dataset.me = String(member.sessionId === mySessionId)
        li.style.setProperty('--person', color)
        const name = document.createElement('span')
        name.className = 'bubble__name'
        name.textContent = member.name
        if (member.sessionId === mySessionId) name.append(' ', youTag())
        li.append(avatarBadge(member.avatar, color, 26), name)
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
        // A meeting announces itself by name: it is somewhere you went, not
        // somebody you happened to end up next to.
        if (next.meeting) toast(`You are in "${next.meeting}"`)
        else {
          toast(
            withWhom ? `You joined a conversation with ${withWhom}` : 'You opened a conversation',
          )
        }
      } else if (previous.bubbleId) {
        // If the bubble no longer exists, it closed (a single person was
        // left); if it still exists, the one who left was me.
        // A meeting that ended says so on its own (see `meetingEnded`), so
        // this only speaks for an ordinary bubble.
        if (!previous.meeting) {
          toast(
            room.state.bubbles.has(previous.bubbleId)
              ? 'You left the conversation'
              : 'The conversation closed',
          )
        }
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
    if (next.focused && !previous.focused)
      toast('Focused: conversations are off until you stand up')
  }

  function bind(room: OfficeRoom) {
    unbind?.()
    previous = EMPTY
    const refresh = () => {
      const next = view(room)
      announce(next, room.sessionId, room)
      render(next, room.sessionId, room)
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
