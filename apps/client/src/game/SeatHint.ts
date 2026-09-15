import Phaser from 'phaser'
import type { Seat } from '@vto/shared'
import { OVERLAY_DEPTH } from './officeMap'

/** The key that sits down and stands up again. */
export const SIT_KEY = 'E'

const FREE = { text: `Press ${SIT_KEY} to sit`, background: '#4c1d95dd', color: '#ede9fe' }
const TAKEN = { text: 'Seat taken', background: '#0b0b0ee0', color: '#a1a1aa' }

/** What the person standing at a seat can do with it. */
export type SeatOffer = 'free' | 'taken'

/** How far above the seat the label sits: clear of whoever stands on it. */
const ABOVE_SEAT = 30

/**
 * The label that makes sitting down discoverable: it appears over the seat
 * you are standing on and says whether you can take it or whether somebody
 * else has it.
 *
 * Nothing is drawn once you are sitting: the point of a focus desk is to be
 * left alone, and a label parked over your own head for as long as you work
 * is the opposite of that. How to get up again is in the sidebar, next to
 * why you cannot be talked to.
 *
 * It is a hint, not a control: what actually happens is decided by the server
 * (see `WorldRoom.onSit`). Nothing here remembers anything — the scene calls
 * `show` with what the state says every frame, and `hide` when there is no
 * seat under the feet.
 */
export class SeatHint {
  private label: Phaser.GameObjects.Text
  private shownFor = ''
  private offer?: SeatOffer

  constructor(scene: Phaser.Scene) {
    this.label = scene.add
      .text(0, 0, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '8px',
        fontStyle: 'bold',
        padding: { x: 3, y: 2 },
      })
      .setResolution(4)
      .setOrigin(0.5, 1)
      .setDepth(OVERLAY_DEPTH)
      .setVisible(false)
  }

  show(seat: Seat, offer: SeatOffer) {
    if (this.shownFor === seat.name && this.offer === offer) return
    this.shownFor = seat.name
    this.offer = offer
    const style = offer === 'free' ? FREE : TAKEN
    this.label.setText(style.text)
    this.label.setBackgroundColor(style.background)
    this.label.setColor(style.color)
    // Above the chair, clear of the avatar standing on it.
    this.label.setPosition(seat.x + seat.width / 2, seat.y - ABOVE_SEAT)
    this.label.setVisible(true)
  }

  hide() {
    if (this.shownFor === '') return
    this.shownFor = ''
    this.offer = undefined
    this.label.setVisible(false)
  }

  destroy() {
    this.label.destroy()
  }
}
