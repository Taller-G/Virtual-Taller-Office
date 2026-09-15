import { Bubble, isFocused, type OfficeState, type Player } from '@vto/shared'

/**
 * Proximity conversation bubbles: the semantics of WorkAdventure's "groups"
 * (`back/src/Model/Group.ts`), decided entirely on the server over the
 * synchronised state. The client can neither request nor force its own
 * membership: it only reflects `state.bubbles` and `player.bubbleId`.
 *
 * Rules:
 * - A player without a bubble who comes within `radius` of another player
 *   without a bubble forms a bubble with them. If what they have nearby is
 *   the centre of an existing bubble that is not full, they join it. If there
 *   are several options, the closest one wins.
 * - The position of the bubble is the centroid of its members and it is
 *   recomputed with every movement.
 * - A member who, on moving, ends up further than `radius` from the centroid
 *   leaves the bubble. Measuring against the centroid gives hysteresis: two
 *   people join at `radius` and only break apart at ~`2 * radius`, so it does
 *   not flicker.
 * - When a single member is left the bubble is destroyed. Those who are freed
 *   are re-evaluated right away: if they are still next to someone free, they
 *   open a new bubble without waiting for anyone to walk.
 * - A bubble with `maxMembers` members absorbs nobody else; as soon as it
 *   stops being full, it absorbs the free players within reach.
 * - Somebody **focused** (sitting at a desk, see `Player.seatId`) is outside
 *   all of this: they neither open a bubble nor get absorbed into one, and
 *   sitting down takes them out of the one they were in. Walking up to
 *   someone who is heads-down does not start a conversation with them; you
 *   have to wait until they stand up.
 *
 * Bubbles form on entering the radius, without waiting for the player to stop
 * (WorkAdventure waits until they halt): the requirement asks that both see
 * it in under 300 ms.
 */

export interface BubbleSettings {
  /** Radius in px. */
  radius: number
  /** Cap of members per bubble. */
  maxMembers: number
}

export interface BubbleEvents {
  onCreated?(bubble: Bubble): void
  onJoined?(bubble: Bubble, player: Player): void
  onLeft?(bubble: Bubble, player: Player): void
  onDestroyed?(bubble: Bubble): void
}

export class BubbleManager {
  private nextId = 1

  constructor(
    private readonly state: OfficeState,
    readonly settings: BubbleSettings,
    private readonly events: BubbleEvents = {},
  ) {
    if (!(settings.radius > 0)) throw new Error('The bubble radius must be > 0')
    if (!(settings.maxMembers >= 2)) throw new Error('The member cap must be >= 2')
    state.bubbleRadius = settings.radius
    state.bubbleMaxMembers = settings.maxMembers
  }

  get radius() {
    return this.settings.radius
  }

  get maxMembers() {
    return this.settings.maxMembers
  }

  bubbleOf(player: Player): Bubble | undefined {
    return player.bubbleId ? this.state.bubbles.get(player.bubbleId) : undefined
  }

  isFull(bubble: Bubble): boolean {
    return bubble.members.length >= this.settings.maxMembers
  }

  /**
   * Recomputes the player's membership after a change of position — or after
   * sitting down or standing up, which is why it is also what enforces that
   * someone focused is in no bubble.
   */
  onPlayerMoved(player: Player) {
    const current = this.bubbleOf(player)
    if (current && isFocused(player)) {
      // Sitting down leaves the conversation you were in.
      this.leave(current, player)
      return
    }
    if (current) {
      // If the new position leaves the player outside the centroid, they leave.
      const center = this.barycenter(current)
      if (distance(player, center) > this.settings.radius) {
        this.leave(current, player)
      } else {
        this.updatePosition(current)
        this.absorbNearby(current)
        return
      }
    }
    this.tryJoin(player)
  }

  /**
   * The player left the room: they leave their bubble (and destroy it if they
   * are the only one left). It is called **after** removing them from
   * `state.players`, so that those who are freed do not group up again with
   * someone who has already gone.
   */
  onPlayerLeft(player: Player) {
    const bubble = this.bubbleOf(player)
    if (bubble) this.leave(bubble, player)
  }

  // ---------------------------------------------------------------------------

  /** Looks for the closest free player or non-full bubble within the radius. */
  private tryJoin(player: Player) {
    if (isFocused(player)) return
    const radius = this.settings.radius
    let best: { kind: 'player'; target: Player } | { kind: 'bubble'; target: Bubble } | undefined
    let bestDistance = radius

    this.state.players.forEach((other) => {
      if (other === player || other.bubbleId || isFocused(other)) return
      const d = distance(player, other)
      if (d <= bestDistance) {
        bestDistance = d
        best = { kind: 'player', target: other }
      }
    })

    this.state.bubbles.forEach((bubble) => {
      if (this.isFull(bubble)) return
      const d = distance(player, bubble)
      if (d <= bestDistance) {
        bestDistance = d
        best = { kind: 'bubble', target: bubble }
      }
    })

    if (!best) return
    if (best.kind === 'bubble') {
      this.join(best.target, player)
      this.absorbNearby(best.target)
    } else {
      this.create([player, best.target])
    }
  }

  private create(members: Player[]) {
    const bubble = new Bubble({ id: `b${this.nextId++}` })
    this.state.bubbles.set(bubble.id, bubble)
    for (const member of members) {
      bubble.members.push(member.sessionId)
      member.bubbleId = bubble.id
    }
    this.updatePosition(bubble)
    this.events.onCreated?.(bubble)
    for (const member of members) this.events.onJoined?.(bubble, member)
    this.absorbNearby(bubble)
  }

  private join(bubble: Bubble, player: Player) {
    bubble.members.push(player.sessionId)
    player.bubbleId = bubble.id
    this.updatePosition(bubble)
    this.events.onJoined?.(bubble, player)
  }

  private leave(bubble: Bubble, player: Player) {
    const index = bubble.members.indexOf(player.sessionId)
    if (index >= 0) bubble.members.splice(index, 1)
    player.bubbleId = ''
    this.events.onLeft?.(bubble, player)

    if (bubble.members.length <= 1) {
      this.destroy(bubble)
    } else {
      this.updatePosition(bubble)
      // If it was full and now someone else fits, whoever was waiting joins.
      this.absorbNearby(bubble)
    }
  }

  /**
   * Empties and removes the bubble. The members that are freed are
   * re-evaluated: whoever is still next to another free person opens a new
   * bubble right there, without waiting for anyone to take a step.
   */
  private destroy(bubble: Bubble) {
    const freed: Player[] = []
    for (const sessionId of [...bubble.members]) {
      const member = this.state.players.get(sessionId)
      if (member) {
        member.bubbleId = ''
        freed.push(member)
        this.events.onLeft?.(bubble, member)
      }
    }
    bubble.members.clear()
    this.state.bubbles.delete(bubble.id)
    this.events.onDestroyed?.(bubble)
    for (const member of freed) {
      if (!member.bubbleId) this.tryJoin(member)
    }
  }

  /** Adds to the bubble the free players that are within the radius of its centre. */
  private absorbNearby(bubble: Bubble) {
    this.state.players.forEach((other) => {
      if (this.isFull(bubble) || other.bubbleId || isFocused(other)) return
      if (distance(other, bubble) <= this.settings.radius) this.join(bubble, other)
    })
  }

  private updatePosition(bubble: Bubble) {
    const { x, y } = this.barycenter(bubble)
    bubble.x = x
    bubble.y = y
  }

  private barycenter(bubble: Bubble): { x: number; y: number } {
    let x = 0
    let y = 0
    let n = 0
    for (const sessionId of bubble.members) {
      const member = this.state.players.get(sessionId)
      if (!member) continue
      x += member.x
      y += member.y
      n++
    }
    return n === 0 ? { x: bubble.x, y: bubble.y } : { x: x / n, y: y / n }
  }
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
