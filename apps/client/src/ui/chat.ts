import {
  CHAT_MAX_LENGTH,
  CHAT_REJECTION_TEXT,
  isFocused,
  isInMeeting,
  type ChatMessagePayload,
  type ChatRejection,
} from '@vto/shared'
import { isTyping } from '../game/typingGuard'
import type { OfficeConnection, OfficeRoom } from '../network/connection'
import { avatarBadge } from './avatarThumb'
import { clearUnread, isWindowUnfocused, notifyUnread, watchFocus } from './notify'
import { personColor } from './personColor'
import { youTag } from './youTag'

/** A message in the panel's local history. */
interface Entry {
  id: string
  /** Session that sent it: messages are grouped by this, never by the name. */
  from: string
  name: string
  /** Sheet of the author when they said it, for the portrait beside the group. */
  avatar: string
  text: string
  /** Server time; on one's own not yet acknowledged, the local time. */
  at: number
  mine: boolean
  status: 'sending' | 'sent' | 'error'
  reason?: ChatRejection
}

/** Cap of the local history: old entries are dropped, nothing is stored anyway. */
const MAX_ENTRIES = 200
/** The field lets you type past the cap so it can warn you went over the limit. */
const INPUT_MAX_LENGTH = CHAT_MAX_LENGTH * 2
/**
 * Two messages from the same person closer together than this read as one
 * turn of speech: the second one goes under the first without repeating who
 * is talking.
 */
const GROUP_WINDOW_MS = 3 * 60_000
/** How long the panel stays lit after a bubble opens or after coming back. */
const SPARK_MS = 1600
/** Side of the portrait beside a group of messages, in pixels. */
const CHAT_AVATAR = 28

const HINT_NO_BUBBLE = 'Walk up to someone to talk'
/**
 * Sitting at a focus desk: there is no conversation to be had, and the reason
 * is not "nobody nearby" — somebody may be standing right next to you.
 */
const HINT_FOCUSED = 'Focused at a desk - stand up to talk'
/** Short enough not to be cut off by the field: the hint below says the rest. */
const PLACEHOLDER_NO_BUBBLE = 'Nobody nearby'
const PLACEHOLDER_FOCUSED = 'Focused at a desk'
const EMPTY_TEXT = 'No messages yet: say hello.'
/** What the log shows while there is no conversation to show. */
const DORMANT_NO_BUBBLE = 'No conversation open'
const DORMANT_FOCUSED = 'Heads-down'
/** Keys shown while a bubble is open. */
const HINT_KEYS: { keys: string[]; does: string }[] = [
  { keys: ['Tab', 'Enter'], does: 'to write' },
  { keys: ['Enter'], does: 'to send' },
  { keys: ['Esc'], does: 'to close' },
]

const time = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' })

/**
 * Puts the keyboard in the chat field as soon as there is a conversation to
 * type into.
 *
 * It waits because the two things that lead here - walking up to somebody, and
 * the card's Chat button - both land before the server has said the bubble
 * exists, and the field stays disabled until it has. It gives up quietly after
 * `timeoutMs`: arriving and finding no conversation is an ordinary outcome
 * (they walked off), not an error to report.
 */
export function focusChatInput(timeoutMs = 4000) {
  const input = document.getElementById('chat-input') as HTMLInputElement | null
  if (!input) return
  const deadline = Date.now() + timeoutMs
  const attempt = () => {
    if (!input.disabled) {
      input.focus()
      return
    }
    if (Date.now() < deadline) window.setTimeout(attempt, 100)
  }
  attempt()
}

/**
 * Is the keyboard on the game, that is, is nothing focused? Tab is the
 * browser's way of walking the controls, so it is only taken over from here;
 * from a button or any other control it keeps moving the focus as always.
 */
function onGame(): boolean {
  const active = document.activeElement
  return active === null || active === document.body || active.tagName === 'CANVAS'
}

/**
 * The bubble's conversation panel.
 *
 * The history is **local only and for this bubble only**: it starts empty at
 * the moment I join (which is why whoever joins a conversation already under
 * way does not see what came before) and it is cleared on leaving or changing
 * bubble. The server stores nothing and there is no way to ask it for what
 * already happened.
 *
 * Every message is painted with `textContent`: text with HTML tags reads
 * literally, it is never interpreted.
 *
 * My messages are shown instantly as "sending"; the echo the server returns
 * (same `id`) moves them to "sent" with the official time, and a `chat_error`
 * marks them with the reason for the rejection.
 */
export function mountChat(connection: OfficeConnection) {
  const panel = document.getElementById('chat')!
  const logEl = document.getElementById('chat-log')!
  const hintEl = document.getElementById('chat-hint')!
  const formEl = document.getElementById('chat-form') as HTMLFormElement
  const inputEl = document.getElementById('chat-input') as HTMLInputElement
  const countEl = document.getElementById('chat-count')!

  inputEl.maxLength = INPUT_MAX_LENGTH

  let room: OfficeRoom | undefined
  let unbind: (() => void) | undefined
  /** Bubble the history below belongs to. `''` = none. */
  let bubbleId = ''
  /** I am sitting at a focus desk: the reason there is no bubble to talk in. */
  let focused = false
  let entries: Entry[] = []
  /** Reason for the latest rejection, until the text is corrected. */
  let rejection: ChatRejection | undefined
  let sparkTimer: number | undefined

  const canChat = () => bubbleId !== ''

  /**
   * Lights the panel for a moment so the eye finds it: when a bubble opens
   * (before anyone presses Tab) and when one comes back to a window that
   * received a message. It only paints - nothing moves and the focus is left
   * exactly where it was.
   */
  function spark() {
    clearTimeout(sparkTimer)
    panel.classList.add('chat--spark')
    // If it was already lit (a second bubble right after the first), it starts
    // over instead of carrying on with what was left of the animation.
    for (const animation of panel.getAnimations()) animation.currentTime = 0
    sparkTimer = window.setTimeout(() => panel.classList.remove('chat--spark'), SPARK_MS)
  }

  function renderHint() {
    hintEl.dataset.tone = rejection ? 'error' : 'info'
    if (rejection) {
      hintEl.textContent = CHAT_REJECTION_TEXT[rejection]
      return
    }
    if (!canChat()) {
      hintEl.textContent = focused ? HINT_FOCUSED : HINT_NO_BUBBLE
      return
    }
    // In a bubble the hint is the keyboard's map: which key opens the field,
    // which one sends and which one closes it.
    hintEl.replaceChildren(
      ...HINT_KEYS.map(({ keys, does }) => {
        const item = document.createElement('span')
        item.className = 'chat__hintkey'
        keys.forEach((key, index) => {
          if (index > 0) item.append('/')
          const kbd = document.createElement('kbd')
          kbd.textContent = key
          item.append(kbd)
        })
        item.append(` ${does}`)
        return item
      }),
    )
  }

  function renderCount() {
    const length = inputEl.value.trim().length
    countEl.textContent = length > 0 ? `${length}/${CHAT_MAX_LENGTH}` : ''
    countEl.dataset.tone = length > CHAT_MAX_LENGTH ? 'error' : 'info'
  }

  /**
   * A run of messages by the same person, close enough together to read as one
   * turn of speech: who is talking is said once at the top and the portrait
   * stands beside the whole run.
   */
  interface Group {
    from: string
    name: string
    avatar: string
    mine: boolean
    entries: Entry[]
  }

  function groupsOf(list: Entry[]): Group[] {
    const groups: Group[] = []
    let last: Entry | undefined
    for (const entry of list) {
      const open = groups[groups.length - 1]
      // The times of one's own are local until the server echoes them, so the
      // gap is measured in absolute value: it can go slightly backwards.
      const carries =
        open !== undefined &&
        last !== undefined &&
        last.from === entry.from &&
        Math.abs(entry.at - last.at) < GROUP_WINDOW_MS
      if (carries) open.entries.push(entry)
      else {
        groups.push({
          from: entry.from,
          name: entry.name,
          avatar: entry.avatar,
          mine: entry.mine,
          entries: [entry],
        })
      }
      last = entry
    }
    return groups
  }

  /**
   * The portrait beside a group. Someone whose sheet is not known - a message
   * from whoever left the office before it was drawn - gets their initial in
   * their own colour rather than a hole in the row.
   */
  function portrait(group: Group, color: string): HTMLElement {
    if (group.avatar) return avatarBadge(group.avatar, color, CHAT_AVATAR)
    const el = document.createElement('span')
    el.className = 'avatar-badge chat__initial'
    el.setAttribute('aria-hidden', 'true')
    el.style.setProperty('--person', color)
    el.style.width = `${CHAT_AVATAR}px`
    el.style.height = `${CHAT_AVATAR}px`
    el.textContent = [...group.name][0]?.toUpperCase() ?? '?'
    return el
  }

  /** One message: what was said, and underneath, quietly, when and how it went. */
  function bubbleOf(entry: Entry): HTMLElement {
    const msg = document.createElement('div')
    msg.className = 'chat__msg'
    msg.dataset.status = entry.status

    const text = document.createElement('p')
    text.className = 'chat__text'
    // Plain text on purpose: `<b>hi</b>` reads exactly as written.
    text.textContent = entry.text
    msg.append(text)

    const foot = document.createElement('p')
    foot.className = 'chat__foot'
    const at = document.createElement('time')
    at.className = 'chat__time'
    at.dateTime = new Date(entry.at).toISOString()
    at.textContent = time.format(entry.at)
    foot.append(at)
    // How one's own went is a footnote next to the time: a tick, or the word
    // while it is on its way.
    if (entry.mine && entry.status !== 'error') {
      const state = document.createElement('span')
      state.className = 'chat__state'
      state.textContent = entry.status === 'sent' ? 'Sent' : 'Sending...'
      foot.append(state)
    }
    msg.append(foot)

    // A rejection is the one state that has to be read, so it says why right
    // there instead of leaving the message looking like any other.
    if (entry.status === 'error') {
      const why = document.createElement('p')
      why.className = 'chat__why'
      why.textContent = `Not sent: ${CHAT_REJECTION_TEXT[entry.reason ?? 'offline']}`
      msg.append(why)
    }
    return msg
  }

  function groupEl(group: Group): HTMLLIElement {
    const li = document.createElement('li')
    li.className = 'chat__group'
    li.dataset.mine = String(group.mine)
    // One's own messages are in the accent tone, but the name above them is
    // still the colour this person is drawn in everywhere else in the panel.
    const color = personColor(room, group.from)
    li.style.setProperty('--person', color)

    const head = document.createElement('p')
    head.className = 'chat__meta'
    const name = document.createElement('span')
    name.className = 'chat__author'
    name.textContent = group.name
    head.append(name)
    if (group.mine) head.append(youTag())

    const stack = document.createElement('div')
    stack.className = 'chat__stack'
    stack.append(head, ...group.entries.map(bubbleOf))

    li.append(portrait(group, color), stack)
    return li
  }

  /** The log while there is no conversation: dormant, not broken. */
  function dormant(): HTMLLIElement {
    const li = document.createElement('li')
    li.className = 'chat__dormant'
    li.textContent = focused ? DORMANT_FOCUSED : DORMANT_NO_BUBBLE
    return li
  }

  function renderLog() {
    if (!canChat()) {
      // Out of a bubble nothing of the conversation is left on screen: the
      // area keeps its shape and says it is waiting, and the hint below says
      // what to do about it.
      logEl.replaceChildren(dormant())
      return
    }
    if (entries.length === 0) {
      const empty = document.createElement('li')
      empty.className = 'chat__empty'
      empty.textContent = EMPTY_TEXT
      logEl.replaceChildren(empty)
      return
    }
    logEl.replaceChildren(...groupsOf(entries).map(groupEl))
    logEl.scrollTop = logEl.scrollHeight
  }

  function render() {
    panel.dataset.state = canChat() ? 'in' : focused ? 'focused' : 'none'
    inputEl.disabled = !canChat()
    inputEl.placeholder = canChat()
      ? 'Write a message...'
      : focused
        ? PLACEHOLDER_FOCUSED
        : PLACEHOLDER_NO_BUBBLE
    renderHint()
    renderCount()
    renderLog()
  }

  function push(entry: Entry) {
    entries.push(entry)
    if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES)
  }

  /** I changed bubble (or left): the previous one's history is discarded. */
  function setBubble(next: string) {
    if (next === bubbleId) return
    bubbleId = next
    entries = []
    rejection = undefined
    if (!canChat()) {
      inputEl.value = ''
      inputEl.blur()
      panel.classList.remove('chat--spark')
    }
    render()
    // A bubble just opened: the panel says so on its own, without asking for
    // the keyboard, and whoever wants it presses Tab.
    if (canChat()) spark()
  }

  function onIncoming(message: ChatMessagePayload) {
    // A guard in case something arrives from a bubble that is no longer mine
    // (a message in flight while I was walking away): it does not enter the
    // history.
    if (!canChat() || message.bubbleId !== bubbleId) return

    const mine = message.from === room?.sessionId
    if (mine) {
      const pending = entries.find((entry) => entry.id === message.id)
      if (pending) {
        pending.status = 'sent'
        pending.at = message.at
        pending.text = message.text
        renderLog()
        return
      }
    }
    push({
      id: message.id,
      from: message.from,
      name: message.name,
      avatar: room?.state.players.get(message.from)?.avatar ?? '',
      text: message.text,
      at: message.at,
      mine,
      status: 'sent',
    })
    renderLog()
    if (!mine && isWindowUnfocused()) {
      notifyUnread()
      panel.classList.add('chat--alert')
    }
  }

  function onError(id: string, reason: ChatRejection) {
    const entry = entries.find((e) => e.id === id)
    if (entry) {
      entry.status = 'error'
      entry.reason = reason
    }
    rejection = reason
    renderHint()
    renderLog()
  }

  function send() {
    const result = connection.sendChat(inputEl.value)
    if (!result.ok) {
      // Rejected before hitting the network: the text stays so it can be fixed.
      rejection = result.reason
      renderHint()
      return
    }
    rejection = undefined
    // Shown instantly as "sending": the server's echo confirms it.
    const me = room ? room.state.players.get(room.sessionId) : undefined
    push({
      id: result.id,
      from: room?.sessionId ?? '',
      name: me?.name ?? 'You',
      avatar: me?.avatar ?? '',
      text: result.text,
      at: Date.now(),
      mine: true,
      status: 'sending',
    })
    inputEl.value = ''
    // Sent: the focus is released so the avatar can move again right away
    // (while a text field has the focus, the keyboard does not reach the
    // game). Another Enter or Tab reopens the field to carry on talking.
    inputEl.blur()
    render()
  }

  /** Closes the field discarding the draft and gives the keyboard back to the game. */
  function close() {
    inputEl.value = ''
    rejection = undefined
    inputEl.blur()
    renderHint()
    renderCount()
  }

  formEl.addEventListener('submit', (event) => {
    event.preventDefault()
    send()
  })

  inputEl.addEventListener('input', () => {
    rejection = undefined
    renderHint()
    renderCount()
  })

  inputEl.addEventListener('keydown', (event) => {
    // Enter sends. It is handled here instead of letting the browser fire the
    // implicit submit so the event can be marked as handled: the same keydown
    // keeps bubbling up to the document listener, which would otherwise focus
    // the field again as soon as it is released.
    if (event.key === 'Enter') {
      event.preventDefault()
      send()
      return
    }
    // Esc closes the field (and discards the draft); the focus goes back to the game.
    if (event.key !== 'Escape') return
    event.preventDefault()
    close()
  })

  // Enter and Tab both open the field, but only inside a bubble: without a
  // bubble nothing happens and the hint about walking up to someone stays
  // visible.
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return
    if (event.key !== 'Enter' && event.key !== 'Tab') return
    // If something is already being typed in a field (the chat's, my name,
    // the entry screen), the key belongs to that field, not to this.
    if (isTyping()) return
    // Shift+Tab and the browser's own combinations are left alone.
    if (event.key === 'Tab' && (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey)) {
      return
    }
    // Neither key is taken from a control that has the focus: Tab is the
    // browser's way of walking them and Enter is how a button is pressed, so
    // both are only borrowed from the one place that has no controls - the
    // game. Without this, Enter on any button (the card's, the away toggle)
    // would fire it and steal the keyboard for the chat field at once.
    if (!onGame()) return
    if (!canChat()) return
    event.preventDefault()
    inputEl.focus()
  })

  function bind(next: OfficeRoom) {
    unbind?.()
    room = next
    const refresh = () => {
      const me = next.state.players.get(next.sessionId)
      // A participant sitting at a meeting table holds a seat but is not
      // heads-down: what is open to them is the meeting's conversation.
      const nowFocused = me ? isFocused(me) && !isInMeeting(me) : false
      const changed = nowFocused !== focused
      focused = nowFocused
      setBubble(me?.bubbleId ?? '')
      // `setBubble` only redraws when the bubble changed; sitting down and
      // standing up change the reason the panel is empty, not the bubble.
      if (changed) render()
    }
    next.onStateChange(refresh)
    unbind = () => next.onStateChange.remove(refresh)
    setBubble('')
    refresh()
  }

  function clear() {
    unbind?.()
    unbind = undefined
    room = undefined
    focused = false
    setBubble('')
    render()
  }

  connection.on('room', bind)
  if (connection.room) bind(connection.room)
  connection.on('status', (status) => {
    if (status === 'disconnected') clear()
  })
  connection.on('chat', onIncoming)
  connection.on('chatError', (error) => onError(error.id, error.reason))

  watchFocus(() => {
    clearUnread()
    // Back at the window: the standing mark goes, but the panel lights up
    // once more so it is obvious where what was missed is.
    const missed = panel.classList.contains('chat--alert')
    panel.classList.remove('chat--alert')
    if (missed && canChat()) spark()
  })

  render()
}
