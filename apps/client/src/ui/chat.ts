import {
  CHAT_MAX_LENGTH,
  CHAT_REJECTION_TEXT,
  type ChatMessagePayload,
  type ChatRejection,
} from '@vto/shared'
import { isTyping } from '../game/typingGuard'
import type { OfficeConnection, OfficeRoom } from '../network/connection'
import { clearUnread, isWindowUnfocused, notifyUnread, watchFocus } from './notify'

/** A message in the panel's local history. */
interface Entry {
  id: string
  /** Session that sent it: messages are grouped by this, never by the name. */
  from: string
  name: string
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

const HINT_NO_BUBBLE = 'Walk up to someone to talk'
/** Short enough not to be cut off by the field: the hint below says the rest. */
const PLACEHOLDER_NO_BUBBLE = 'Nobody nearby'
const EMPTY_TEXT = 'No messages yet: say hello.'
/** Keys shown while a bubble is open. */
const HINT_KEYS: { keys: string[]; does: string }[] = [
  { keys: ['Tab', 'Enter'], does: 'to write' },
  { keys: ['Enter'], does: 'to send' },
  { keys: ['Esc'], does: 'to close' },
]

const time = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' })

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
      hintEl.textContent = HINT_NO_BUBBLE
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

  /** The row that opens a message: who is talking and when. */
  function metaOf(entry: Entry): HTMLElement {
    const head = document.createElement('p')
    head.className = 'chat__meta'
    const name = document.createElement('span')
    name.className = 'chat__author'
    name.textContent = entry.name
    const at = document.createElement('time')
    at.className = 'chat__time'
    at.dateTime = new Date(entry.at).toISOString()
    at.textContent = time.format(entry.at)
    head.append(name, at)
    return head
  }

  /** How my message is going: understated, except when it did not arrive. */
  function statusOf(entry: Entry): HTMLElement {
    const status = document.createElement('p')
    status.className = 'chat__status'
    status.textContent =
      entry.status === 'sent'
        ? 'Sent'
        : entry.status === 'sending'
          ? 'Sending...'
          : `Not sent: ${CHAT_REJECTION_TEXT[entry.reason ?? 'offline']}`
    return status
  }

  function renderLog() {
    if (!canChat()) {
      // Out of a bubble nothing of the conversation is left on screen.
      logEl.replaceChildren()
      return
    }
    if (entries.length === 0) {
      const empty = document.createElement('li')
      empty.className = 'chat__empty'
      empty.textContent = EMPTY_TEXT
      logEl.replaceChildren(empty)
      return
    }
    logEl.replaceChildren(
      ...entries.map((entry, index) => {
        const previous = entries[index - 1]
        // The times of one's own are local until the server echoes them, so
        // the gap is measured in absolute value: it can go slightly backwards.
        const grouped =
          previous !== undefined &&
          previous.from === entry.from &&
          Math.abs(entry.at - previous.at) < GROUP_WINDOW_MS

        const li = document.createElement('li')
        li.className = 'chat__msg'
        li.dataset.mine = String(entry.mine)
        li.dataset.status = entry.status
        li.dataset.grouped = String(grouped)

        const text = document.createElement('p')
        text.className = 'chat__text'
        // Plain text on purpose: `<b>hi</b>` reads exactly as written.
        text.textContent = entry.text
        // Grouped it carries no visible time, so it keeps it within reach.
        if (grouped) text.title = time.format(entry.at)

        if (!grouped) li.append(metaOf(entry))
        li.append(text)
        if (entry.mine) li.append(statusOf(entry))
        return li
      }),
    )
    logEl.scrollTop = logEl.scrollHeight
  }

  function render() {
    panel.dataset.state = canChat() ? 'in' : 'none'
    inputEl.disabled = !canChat()
    inputEl.placeholder = canChat() ? 'Write a message...' : PLACEHOLDER_NO_BUBBLE
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
    push({
      id: result.id,
      from: room?.sessionId ?? '',
      name: room?.state.players.get(room.sessionId)?.name ?? 'You',
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
    if (event.key === 'Tab') {
      // Shift+Tab and the browser's own combinations are left alone, and the
      // shortcut is only taken from the game: from a control, Tab goes on
      // walking the panel as it always has.
      if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return
      if (!onGame()) return
    }
    if (!canChat()) return
    event.preventDefault()
    inputEl.focus()
  })

  function bind(next: OfficeRoom) {
    unbind?.()
    room = next
    const refresh = () => setBubble(next.state.players.get(next.sessionId)?.bubbleId ?? '')
    next.onStateChange(refresh)
    unbind = () => next.onStateChange.remove(refresh)
    setBubble('')
    refresh()
  }

  function clear() {
    unbind?.()
    unbind = undefined
    room = undefined
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
