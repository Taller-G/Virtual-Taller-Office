import Phaser from 'phaser'
import { MAX_AGENTS, type Direction } from '@vto/shared'
import { BODY } from './Avatar'
import { MASCOT_TEXTURE, mascotAnimKey } from './mascotAnims'

/**
 * The robots that walk behind one player.
 *
 * They follow the **owner's path**, not the owner: the train keeps a trail of
 * breadcrumbs of where their player has been and puts each robot at a fixed
 * distance back along it, so they come out one behind the other and take the
 * same turns their player took instead of cutting corners in a clump. When
 * the owner stops, the targets stop with them and each robot walks the little
 * that is left and settles, still a step apart.
 *
 * They are plain sprites with **no physics body**: they collide with nothing
 * — not walls, not furniture, not players, not each other — so they can never
 * block anyone, and they are invisible to the seats, the doors and the
 * conversation bubbles, which the server decides from the players' positions
 * alone.
 *
 * The scene owns one train per avatar and drives it from `update()`; the
 * train knows nothing about the room's state beyond what it is handed.
 */

/** Distance, in px, between one robot and the next along the path. */
const SPACING = 14
/** A new breadcrumb is dropped every this many px of walking. */
const TRAIL_STEP = 2
/** Top speed of a robot, px/s: above the player's so they can catch up. */
const MAX_SPEED = 185
/**
 * How hard they steer towards their place in the line (1/s). It is what makes
 * them ease into it instead of stopping dead, and what keeps a settled robot
 * from jittering around its target. It also sets how far they lag while their
 * player is walking: a robot chasing a target that runs away at the walking
 * speed settles at `SPEED / CATCHUP` px behind it — some 11 px here, which
 * reads as trailing without ever losing them.
 */
const CATCHUP = 14
/** Below this much movement in a frame a robot counts as standing still. */
const MOVING_EPS = 0.12
/** Further than this from its place (a spawn, a teleport) it just appears there. */
const SNAP_DISTANCE = 160

/** What the train needs to know about the player it follows. */
export interface MascotOwner {
  x: number
  y: number
  dir: Direction
  away: boolean
  connected: boolean
}

/** Unit vector pointing behind someone facing `dir`. */
const BEHIND: Record<Direction, { x: number; y: number }> = {
  down: { x: 0, y: -1 },
  up: { x: 0, y: 1 },
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
}

interface Robot {
  sprite: Phaser.GameObjects.Sprite
  dir: Direction
  moving: boolean
}

interface Point {
  x: number
  y: number
}

export class MascotTrain {
  private scene: Phaser.Scene
  private robots: Robot[] = []
  /** Breadcrumbs of the owner's path, newest first. */
  private trail: Point[] = []

  constructor(scene: Phaser.Scene, owner: MascotOwner, count: number) {
    this.scene = scene
    this.trail = [{ x: owner.x, y: owner.y }]
    this.setCount(count, owner)
  }

  /** How many robots are on screen right now. */
  get count(): number {
    return this.robots.length
  }

  /**
   * Grows or shrinks the train to `count` robots. A new one appears at its
   * place in the line rather than flying in from wherever the last one was.
   */
  setCount(count: number, owner: MascotOwner): void {
    const wanted = Math.min(MAX_AGENTS, Math.max(0, Math.floor(count)))
    // Without the sheet there are no robots: the office runs on regardless.
    const available = this.scene.textures.exists(MASCOT_TEXTURE) ? wanted : 0

    while (this.robots.length > available) this.robots.pop()?.sprite.destroy()
    while (this.robots.length < available) {
      const place = this.placeFor(this.robots.length, owner)
      const sprite = this.scene.add
        .sprite(place.x, place.y + BODY.height, MASCOT_TEXTURE)
        .setOrigin(0.5, 1)
      const robot: Robot = { sprite, dir: owner.dir, moving: false }
      this.robots.push(robot)
      this.play(robot, 'idle', owner.dir)
    }
    this.applyAlpha(owner)
    for (const robot of this.robots) this.applyDepth(robot)
  }

  /**
   * One frame. `deltaMs` is the scene's, so the robots move at the same pace
   * whatever the frame rate.
   */
  update(deltaMs: number, owner: MascotOwner): void {
    this.record(owner)
    this.applyAlpha(owner)
    if (this.robots.length === 0) return

    const dt = Math.min(deltaMs, 100) / 1000

    for (let i = 0; i < this.robots.length; i++) {
      const robot = this.robots[i]
      // Away: they stop following and wait beside their player, idling.
      if (owner.away) {
        this.play(robot, 'idle', owner.dir)
        this.applyDepth(robot)
        continue
      }

      const place = this.placeFor(i, owner)
      const sprite = robot.sprite
      const dx = place.x - sprite.x
      const dy = place.y + BODY.height - sprite.y
      const distance = Math.hypot(dx, dy)

      if (distance > SNAP_DISTANCE) {
        sprite.setPosition(place.x, place.y + BODY.height)
        this.play(robot, 'idle', owner.dir)
        this.applyDepth(robot)
        continue
      }

      // Eases into its place: fast while far, gentle as it arrives.
      const step = Math.min(distance, Math.min(MAX_SPEED, distance * CATCHUP) * dt)
      if (step > 0 && distance > 0) {
        sprite.setPosition(sprite.x + (dx / distance) * step, sprite.y + (dy / distance) * step)
      }

      if (step > MOVING_EPS) {
        // Walking: it faces where it is going, which is the way its player
        // went — the horizontal axis wins on a diagonal, as for the avatars.
        const dir: Direction =
          Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
        this.play(robot, 'walk', dir)
      } else {
        // Settled: it turns to look the same way as its player.
        this.play(robot, 'idle', owner.dir)
      }
      this.applyDepth(robot)
    }
  }

  /** Every robot goes, with no trace left in the scene. */
  destroy(): void {
    for (const robot of this.robots) robot.sprite.destroy()
    this.robots = []
    this.trail = []
  }

  // -------------------------------------------------------------------------
  // The path
  // -------------------------------------------------------------------------

  /**
   * Drops a breadcrumb when the owner has walked far enough from the last
   * one, and forgets the tail nobody is standing on any more. It keeps
   * recording while the owner is away, so when they come back the robots
   * follow the way they actually went and not a straight line to it.
   */
  private record(owner: MascotOwner): void {
    const head = this.trail[0]
    if (!head) {
      this.trail.push({ x: owner.x, y: owner.y })
      return
    }
    if (Math.hypot(owner.x - head.x, owner.y - head.y) < TRAIL_STEP) return
    this.trail.unshift({ x: owner.x, y: owner.y })

    // The trail only has to reach the last robot in the line.
    const needed = SPACING * (this.robots.length + 1)
    let walked = 0
    for (let i = 1; i < this.trail.length; i++) {
      walked += Math.hypot(
        this.trail[i].x - this.trail[i - 1].x,
        this.trail[i].y - this.trail[i - 1].y,
      )
      if (walked >= needed) {
        this.trail.length = i + 1
        return
      }
    }
  }

  /**
   * Where robot `index` belongs: `(index + 1) * SPACING` back along the path
   * its player walked. Before they have walked that far — they just arrived,
   * or they have not moved at all — there is no path to stand on, so the ones
   * that fall off the end huddle behind their player instead of stacking on
   * the same pixel.
   */
  private placeFor(index: number, owner: MascotOwner): Point {
    const wanted = (index + 1) * SPACING
    const points: Point[] = [{ x: owner.x, y: owner.y }, ...this.trail]
    let walked = 0
    for (let i = 1; i < points.length; i++) {
      const previous = points[i - 1]
      const point = points[i]
      const length = Math.hypot(point.x - previous.x, point.y - previous.y)
      if (length === 0) continue
      if (walked + length >= wanted) {
        const k = (wanted - walked) / length
        return {
          x: previous.x + (point.x - previous.x) * k,
          y: previous.y + (point.y - previous.y) * k,
        }
      }
      walked += length
    }
    return this.huddle(index, owner, wanted - walked)
  }

  /**
   * The fallback place: behind the owner and fanned out to the sides, in rows
   * of two, so a train that has nowhere to trail still shows every robot.
   */
  private huddle(index: number, owner: MascotOwner, missing: number): Point {
    const tail = this.trail[this.trail.length - 1] ?? { x: owner.x, y: owner.y }
    const back = BEHIND[owner.dir]
    const side = index % 2 === 0 ? -1 : 1
    const row = Math.floor(index / 2) + 1
    const depth = Math.min(missing, SPACING * row)
    return {
      x: tail.x + back.x * depth + back.y * side * SPACING * 0.6,
      y: tail.y + back.y * depth + back.x * side * SPACING * 0.6,
    }
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  private play(robot: Robot, state: 'idle' | 'walk', dir: Direction): void {
    const moving = state === 'walk'
    if (robot.moving === moving && robot.dir === dir && robot.sprite.anims.currentAnim) return
    robot.moving = moving
    robot.dir = dir
    robot.sprite.play(mascotAnimKey(state, dir), true)
  }

  /**
   * Depth = the robot's feet, the same rule the avatars and the map's
   * furniture follow: it comes out in front of the floor and behind whoever
   * is standing further down the screen.
   */
  private applyDepth(robot: Robot): void {
    robot.sprite.setDepth(robot.sprite.y)
  }

  /** The robots fade with their player: dimmed while away, ghostly if offline. */
  private applyAlpha(owner: MascotOwner): void {
    const alpha = !owner.connected ? 0.35 : owner.away ? 0.6 : 1
    for (const robot of this.robots) robot.sprite.setAlpha(alpha)
  }
}
