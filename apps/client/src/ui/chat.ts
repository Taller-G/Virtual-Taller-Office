import {
  CHAT_MAX_LENGTH,
  CHAT_REJECTION_TEXT,
  type ChatMessagePayload,
  type ChatRejection,
} from '@vto/shared'
import { isTyping } from '../game/typingGuard'
import type { OfficeConnection, OfficeRoom } from '../network/connection'
import { clearUnread, isWindowUnfocused, notifyUnread, watchFocus } from './notify'

/** Un mensaje en el historial local del panel. */
interface Entry {
  id: string
  name: string
  text: string
  /** Hora del servidor; en los propios todavía sin acuse, la hora local. */
  at: number
  mine: boolean
  status: 'sending' | 'sent' | 'error'
  reason?: ChatRejection
}

/** Tope del historial local: lo viejo se descarta, nada se guarda igual. */
const MAX_ENTRIES = 200
/** El campo deja escribir de más para poder avisar que se pasó del límite. */
const INPUT_MAX_LENGTH = CHAT_MAX_LENGTH * 2

const HINT_NO_BUBBLE = 'Acercate a alguien para conversar'
const HINT_IN_BUBBLE = 'Enter para escribir · Esc para cerrar'

const time = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' })

/**
 * Panel de conversación de la burbuja.
 *
 * El historial es **solo local y solo de esta burbuja**: arranca vacío en el
 * momento en que entro (por eso quien se suma a una charla en curso no ve lo
 * anterior) y se borra al salir o al cambiar de burbuja. El servidor no guarda
 * nada y no hay forma de pedirle lo que ya pasó.
 *
 * Todo mensaje se pinta con `textContent`: el texto con etiquetas HTML se lee
 * literal, nunca se interpreta.
 *
 * Mis mensajes se muestran al instante como "enviando"; el eco que devuelve el
 * servidor (mismo `id`) los pasa a "enviado" con la hora oficial, y un
 * `chat_error` los marca con el motivo del rechazo.
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
  /** Burbuja a la que pertenece el historial de abajo. `''` = ninguna. */
  let bubbleId = ''
  let entries: Entry[] = []
  /** Motivo del último rechazo, hasta que se corrija el texto. */
  let rejection: ChatRejection | undefined

  const canChat = () => bubbleId !== ''

  function renderHint() {
    hintEl.textContent = rejection
      ? CHAT_REJECTION_TEXT[rejection]
      : canChat()
        ? HINT_IN_BUBBLE
        : HINT_NO_BUBBLE
    hintEl.dataset.tone = rejection ? 'error' : 'info'
  }

  function renderCount() {
    const length = inputEl.value.trim().length
    countEl.textContent = length > 0 ? `${length}/${CHAT_MAX_LENGTH}` : ''
    countEl.dataset.tone = length > CHAT_MAX_LENGTH ? 'error' : 'info'
  }

  function renderLog() {
    logEl.replaceChildren(
      ...entries.map((entry) => {
        const li = document.createElement('li')
        li.className = 'chat__msg'
        li.dataset.mine = String(entry.mine)
        li.dataset.status = entry.status

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

        const text = document.createElement('p')
        text.className = 'chat__text'
        // Texto plano a propósito: `<b>hola</b>` se lee tal cual.
        text.textContent = entry.text

        li.append(head, text)
        if (entry.mine) {
          const status = document.createElement('p')
          status.className = 'chat__status'
          status.textContent =
            entry.status === 'sent'
              ? 'Enviado'
              : entry.status === 'sending'
                ? 'Enviando…'
                : `No se envió: ${CHAT_REJECTION_TEXT[entry.reason ?? 'offline']}`
          li.append(status)
        }
        return li
      }),
    )
    logEl.scrollTop = logEl.scrollHeight
  }

  function render() {
    panel.dataset.state = canChat() ? 'in' : 'none'
    inputEl.disabled = !canChat()
    inputEl.placeholder = canChat() ? 'Escribí un mensaje…' : HINT_NO_BUBBLE
    renderHint()
    renderCount()
    renderLog()
  }

  function push(entry: Entry) {
    entries.push(entry)
    if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES)
  }

  /** Cambié de burbuja (o salí): el historial de la anterior se descarta. */
  function setBubble(next: string) {
    if (next === bubbleId) return
    bubbleId = next
    entries = []
    rejection = undefined
    if (!canChat()) {
      inputEl.value = ''
      inputEl.blur()
    }
    render()
  }

  function onIncoming(message: ChatMessagePayload) {
    // Defensa por si llega algo de una burbuja que ya no es la mía (mensaje
    // en vuelo mientras me alejaba): no entra al historial.
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
      // Rechazado antes de salir a la red: el texto queda para corregirlo.
      rejection = result.reason
      renderHint()
      return
    }
    rejection = undefined
    // Se muestra al instante como "enviando": el eco del servidor lo confirma.
    push({
      id: result.id,
      name: room?.state.players.get(room.sessionId)?.name ?? 'Vos',
      text: result.text,
      at: Date.now(),
      mine: true,
      status: 'sending',
    })
    inputEl.value = ''
    render()
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

  // Esc cierra el campo (y descarta el borrador); el foco vuelve al juego.
  inputEl.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    inputEl.value = ''
    rejection = undefined
    inputEl.blur()
    renderHint()
    renderCount()
  })

  // Enter abre el campo, pero solo dentro de una burbuja: sin burbuja no pasa
  // nada y queda a la vista la pista de acercarse a alguien.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.defaultPrevented) return
    // Si ya se está escribiendo en algún campo (el del chat, mi nombre, la
    // pantalla de entrada), el Enter es de ese campo, no de acá.
    if (isTyping()) return
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
    panel.classList.remove('chat--alert')
  })

  render()
}
