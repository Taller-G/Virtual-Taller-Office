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
 * Relay of the proximity bubble's chat.
 *
 * The server is the one that decides who reads a message: it takes the bubble
 * the sender is in **at that instant** and returns its members as the only
 * recipients. The client sends neither recipients nor a bubble id, so it
 * cannot write to a conversation it is not part of.
 *
 * Nothing is stored: there is no history in the state nor here. The only
 * thing remembered per player are the timestamps of their latest messages,
 * for the rate limit.
 *
 * The message is relayed back to the sender too: that echo is the "sent"
 * acknowledgement and carries the server's time, the same for everyone.
 */

export interface ChatSettings {
  /** Maximum number of messages accepted per window. */
  maxPerWindow: number
  /** Width of the rate-limit window, in ms. */
  windowMs: number
}

export type ChatOutcome =
  | { ok: true; message: ChatMessagePayload; recipients: string[] }
  | { ok: false; error: ChatErrorPayload }

export class ChatRelay {
  /** Timestamps (ms) of the latest accepted messages, by sessionId. */
  private recent = new Map<string, number[]>()

  constructor(
    private readonly state: OfficeState,
    readonly settings: ChatSettings,
  ) {
    if (!(settings.maxPerWindow >= 1)) throw new Error('The message cap must be >= 1')
    if (!(settings.windowMs > 0)) throw new Error('The rate-limit window must be > 0')
  }

  /**
   * Resolves a send: validates the text, requires the sender to be in a
   * bubble, applies the rate limit and returns the assembled message together
   * with the sessionIds that have to receive it (the sender's included).
   */
  submit(sessionId: string, payload: ChatSendPayload | undefined, now: number): ChatOutcome {
    const id = sanitizeChatId(payload?.id) || newChatId()
    const player = this.state.players.get(sessionId)
    const bubble = player?.bubbleId ? this.state.bubbles.get(player.bubbleId) : undefined
    // Without a bubble there is nobody to talk to: the message goes nowhere.
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
      // The members of the bubble as they are right now: whoever left an
      // instant ago is no longer in the list, and whoever just joined is.
      recipients: [...bubble.members],
    }
  }

  /** The player left the room: their rate history is forgotten. */
  forget(sessionId: string) {
    this.recent.delete(sessionId)
  }

  /**
   * Per-player rate limit: a sliding window over the messages already
   * accepted. Keeps a client from flooding the others through the relay.
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
