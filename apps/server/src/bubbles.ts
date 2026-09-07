import { Bubble, type OfficeState, type Player } from '@vto/shared'

/**
 * Burbujas de conversación por proximidad: la semántica de los "groups" de
 * WorkAdventure (`back/src/Model/Group.ts`), decidida íntegramente en el
 * servidor sobre el estado sincronizado. El cliente no puede pedir ni forzar
 * su pertenencia: solo refleja `state.bubbles` y `player.bubbleId`.
 *
 * Reglas:
 * - Un jugador sin burbuja que queda a menos de `radius` de otro jugador sin
 *   burbuja forma una burbuja con él. Si lo que tiene cerca es el centro de
 *   una burbuja existente que no está llena, se suma a ella. Si hay varias
 *   opciones, gana la más cercana.
 * - La posición de la burbuja es el baricentro de sus miembros y se recalcula
 *   con cada movimiento.
 * - Un miembro que, al moverse, queda a más de `radius` del baricentro sale de
 *   la burbuja. Medir contra el baricentro da histéresis: dos personas se
 *   juntan a `radius` y se sueltan recién a ~`2 * radius`, así no parpadea.
 * - Cuando queda un solo miembro la burbuja se destruye. Los que quedan
 *   libres se reevalúan en el momento: si siguen pegados a alguien libre,
 *   abren una burbuja nueva sin esperar a que alguien camine.
 * - Una burbuja con `maxMembers` miembros no absorbe a nadie más; en cuanto
 *   deja de estar llena, absorbe a los libres que tenga al alcance.
 *
 * Las burbujas se forman al entrar en el radio, sin esperar a que el jugador
 * se detenga (WorkAdventure espera a que frene): el requisito pide que ambos
 * la vean en menos de 300 ms.
 */

export interface BubbleSettings {
  /** Radio en px. */
  radius: number
  /** Tope de miembros por burbuja. */
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
    if (!(settings.radius > 0)) throw new Error('El radio de las burbujas debe ser > 0')
    if (!(settings.maxMembers >= 2)) throw new Error('El tope de miembros debe ser >= 2')
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

  /** Recalcula la pertenencia del jugador tras un cambio de posición. */
  onPlayerMoved(player: Player) {
    const current = this.bubbleOf(player)
    if (current) {
      // Si con la nueva posición el jugador queda fuera del baricentro, sale.
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
   * El jugador dejó la sala: sale de su burbuja (y la destruye si queda solo).
   * Se llama **después** de quitarlo de `state.players`, para que los que
   * queden libres no vuelvan a agruparse con quien ya se fue.
   */
  onPlayerLeft(player: Player) {
    const bubble = this.bubbleOf(player)
    if (bubble) this.leave(bubble, player)
  }

  // ---------------------------------------------------------------------------

  /** Busca el jugador libre o la burbuja no llena más cercana dentro del radio. */
  private tryJoin(player: Player) {
    const radius = this.settings.radius
    let best: { kind: 'player'; target: Player } | { kind: 'bubble'; target: Bubble } | undefined
    let bestDistance = radius

    this.state.players.forEach((other) => {
      if (other === player || other.bubbleId) return
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
      // Si estaba llena y ahora entra alguien más, se suma a quien esperaba.
      this.absorbNearby(bubble)
    }
  }

  /**
   * Vacía y quita la burbuja. Los miembros que quedan libres se reevalúan: el
   * que sigue pegado a otra persona libre abre una burbuja nueva ahí mismo,
   * sin esperar a que alguien dé un paso.
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

  /** Suma a la burbuja a los jugadores libres que estén dentro del radio de su centro. */
  private absorbNearby(bubble: Bubble) {
    this.state.players.forEach((other) => {
      if (this.isFull(bubble) || other.bubbleId) return
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
