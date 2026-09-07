import {
  newChatId,
  sanitizeChatId,
  validateChatText,
  type ChatErrorPayload,
  type ChatMessagePayload,
  type ChatSendPayload,
  type OfficeState,
} from '@vto/shared'

/**
 * Retransmisión del chat de la burbuja de proximidad.
 *
 * El servidor es el que decide quién lee un mensaje: toma la burbuja en la que
 * está el remitente **en ese instante** y devuelve sus miembros como únicos
 * destinatarios. El cliente no manda destinatarios ni id de burbuja, así que no
 * puede escribirle a una conversación de la que no forma parte.
 *
 * Nada se guarda: no hay historial en el estado ni acá. Lo único que se
 * recuerda por jugador son las marcas de tiempo de sus últimos mensajes, para
 * el tope de ritmo.
 *
 * El mensaje se le reenvía también al remitente: ese eco es el acuse de
 * "enviado" y lleva la hora del servidor, la misma para todos.
 */

export interface ChatSettings {
  /** Máximo de mensajes aceptados por ventana. */
  maxPerWindow: number
  /** Ancho de la ventana del tope de ritmo, en ms. */
  windowMs: number
}

export type ChatOutcome =
  | { ok: true; message: ChatMessagePayload; recipients: string[] }
  | { ok: false; error: ChatErrorPayload }

export class ChatRelay {
  /** Marcas de tiempo (ms) de los últimos mensajes aceptados, por sessionId. */
  private recent = new Map<string, number[]>()

  constructor(
    private readonly state: OfficeState,
    readonly settings: ChatSettings,
  ) {
    if (!(settings.maxPerWindow >= 1)) throw new Error('El tope de mensajes debe ser >= 1')
    if (!(settings.windowMs > 0)) throw new Error('La ventana del tope de ritmo debe ser > 0')
  }

  /**
   * Resuelve un envío: valida el texto, exige que el remitente esté en una
   * burbuja, aplica el tope de ritmo y devuelve el mensaje ya armado junto con
   * los sessionId que tienen que recibirlo (el del remitente incluido).
   */
  submit(sessionId: string, payload: ChatSendPayload | undefined, now: number): ChatOutcome {
    const id = sanitizeChatId(payload?.id) || newChatId()
    const player = this.state.players.get(sessionId)
    const bubble = player?.bubbleId ? this.state.bubbles.get(player.bubbleId) : undefined
    // Sin burbuja no hay a quién hablarle: el mensaje no va a ninguna parte.
    if (!player || !bubble) return { ok: false, error: { id, reason: 'no_bubble' } }

    const text = validateChatText(payload?.text)
    if (!text.ok) return { ok: false, error: { id, reason: text.reason } }

    if (!this.allow(sessionId, now)) return { ok: false, error: { id, reason: 'rate_limited' } }

    return {
      ok: true,
      message: {
        id,
        bubbleId: bubble.id,
        from: sessionId,
        name: player.name,
        text: text.text,
        at: now,
      },
      // Los miembros de la burbuja tal como están ahora: quien se fue hace un
      // instante ya no está en la lista y quien acaba de entrar sí.
      recipients: [...bubble.members],
    }
  }

  /** El jugador se fue de la sala: se olvida su historial de ritmo. */
  forget(sessionId: string) {
    this.recent.delete(sessionId)
  }

  /**
   * Tope de ritmo por jugador: ventana deslizante sobre los mensajes ya
   * aceptados. Evita que un cliente inunde a los demás con el relay.
   */
  private allow(sessionId: string, now: number): boolean {
    const { maxPerWindow, windowMs } = this.settings
    const stamps = (this.recent.get(sessionId) ?? []).filter((at) => now - at < windowMs)
    if (stamps.length >= maxPerWindow) {
      this.recent.set(sessionId, stamps)
      return false
    }
    stamps.push(now)
    this.recent.set(sessionId, stamps)
    return true
  }
}
