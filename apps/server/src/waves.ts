import type { OfficeState, WavePayload, WaveSendPayload } from '@vto/shared'

/**
 * Relay of waves.
 *
 * A wave is the lightest thing one person can send another: no text, no
 * history, no bubble. It deliberately ignores proximity - waving is how you
 * catch the eye of someone on the other side of the room, and requiring you
 * to already be standing next to them would leave it with nothing to do.
 *
 * The only thing remembered is when each person last waved, for the cooldown:
 * without one the button is a way to spam somebody with toasts.
 */

export interface WaveSettings {
  /** Shortest gap between two waves from the same person, in ms. */
  cooldownMs: number
}

export type WaveRejection = 'unknown_target' | 'self' | 'cooldown'

export type WaveOutcome =
  { ok: true; wave: WavePayload; to: string } | { ok: false; reason: WaveRejection }

export class WaveRelay {
  /** When each person last waved (ms), by sessionId. */
  private last = new Map<string, number>()

  constructor(
    private readonly state: OfficeState,
    readonly settings: WaveSettings,
  ) {
    if (!(settings.cooldownMs >= 0)) throw new Error('The wave cooldown must be >= 0')
  }

  /**
   * Resolves a wave: the sender and the target have to be in the room, they
   * cannot be the same person, and the sender has to be off cooldown.
   */
  submit(from: string, payload: WaveSendPayload | undefined, now: number): WaveOutcome {
    const to = typeof payload?.to === 'string' ? payload.to : ''
    const sender = this.state.players.get(from)
    if (!sender) return { ok: false, reason: 'unknown_target' }
    if (to === from) return { ok: false, reason: 'self' }
    if (!to || !this.state.players.has(to)) return { ok: false, reason: 'unknown_target' }

    const previous = this.last.get(from)
    if (previous !== undefined && now - previous < this.settings.cooldownMs) {
      return { ok: false, reason: 'cooldown' }
    }
    this.last.set(from, now)
    return { ok: true, to, wave: { from, name: sender.name } }
  }

  /** Whoever leaves stops being remembered: nothing is kept about them. */
  forget(sessionId: string) {
    this.last.delete(sessionId)
  }
}
