import type { BuiltMap } from './officeMap'

/**
 * Walking somewhere by yourself.
 *
 * The map already knows what blocks the way - the colliding tiles of its
 * layers and the furniture bodies - so the grid below is read off it rather
 * than maintained alongside it: nothing has to be kept in step when the map
 * changes.
 *
 * It is a tile grid and not a finer one because the avatar's body is 18x12 px
 * inside a 32 px tile, so a tile the body fits in at all it fits in with room
 * to spare, and walking centre to centre never clips a corner.
 */

export interface Grid {
  width: number
  height: number
  /** Side of a tile in px. */
  tile: number
  /** One byte per tile, 1 = cannot be walked on. Row-major. */
  blocked: Uint8Array
}

export interface Point {
  x: number
  y: number
}

/** Reads the grid off a built map. Done once per map, not once per request. */
export function buildGrid(map: BuiltMap): Grid {
  const { width, height, tileWidth } = map.tilemap
  const blocked = new Uint8Array(width * height)

  // Colliding tiles of every layer that has any.
  for (const layer of map.collisionLayers) {
    for (const row of layer.layer.data) {
      for (const tile of row) {
        if (
          tile &&
          tile.collides &&
          tile.x >= 0 &&
          tile.y >= 0 &&
          tile.x < width &&
          tile.y < height
        ) {
          blocked[tile.y * width + tile.x] = 1
        }
      }
    }
  }

  // Furniture: every static body, rasterised onto the tiles it covers.
  for (const child of map.solids.getChildren()) {
    const body = (child as { body?: { x: number; y: number; width: number; height: number } }).body
    if (!body) continue
    const x0 = Math.floor(body.x / tileWidth)
    const y0 = Math.floor(body.y / tileWidth)
    // -1 on the far edge: a body ending exactly on a boundary does not block
    // the tile after it.
    const x1 = Math.floor((body.x + body.width - 1) / tileWidth)
    const y1 = Math.floor((body.y + body.height - 1) / tileWidth)
    for (let y = Math.max(0, y0); y <= Math.min(height - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(width - 1, x1); x++) blocked[y * width + x] = 1
    }
  }

  return { width, height, tile: tileWidth, blocked }
}

const isBlocked = (grid: Grid, x: number, y: number) =>
  x < 0 || y < 0 || x >= grid.width || y >= grid.height || grid.blocked[y * grid.width + x] === 1

/** The centre of a tile, in world pixels. */
const centre = (grid: Grid, x: number, y: number): Point => ({
  x: x * grid.tile + grid.tile / 2,
  y: y * grid.tile + grid.tile / 2,
})

/**
 * The nearest tile that can be stood on, searched outwards in rings.
 *
 * Both ends need it: you can be standing on a tile the grid calls blocked
 * (the body is smaller than a tile, so it fits in places the tile map says
 * are solid) and the person you are walking to may be standing on one too.
 */
function nearestFree(grid: Grid, x: number, y: number, maxRadius = 12): Point | undefined {
  if (!isBlocked(grid, x, y)) return { x, y }
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        // Only the ring itself, not the filled square: it keeps the search
        // ordered by distance so the first hit really is the nearest.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        if (!isBlocked(grid, x + dx, y + dy)) return { x: x + dx, y: y + dy }
      }
    }
  }
  return undefined
}

/** The eight neighbours, diagonals last so ties prefer a straight step. */
const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const

/**
 * A path from one world point to another, as world-space waypoints.
 *
 * A* over the tile grid, eight-way, refusing to cut a corner: a diagonal step
 * is only taken when both tiles it squeezes between are free, so the avatar
 * never clips the corner of a desk on its way past.
 *
 * Returns `undefined` when there is no way through - which the caller has to
 * say out loud rather than walking into a wall trying.
 */
export function findPath(grid: Grid, from: Point, to: Point): Point[] | undefined {
  const start = nearestFree(grid, Math.floor(from.x / grid.tile), Math.floor(from.y / grid.tile))
  const goal = nearestFree(grid, Math.floor(to.x / grid.tile), Math.floor(to.y / grid.tile))
  if (!start || !goal) return undefined
  if (start.x === goal.x && start.y === goal.y) return []

  const size = grid.width * grid.height
  const index = (x: number, y: number) => y * grid.width + x
  const cameFrom = new Int32Array(size).fill(-1)
  const gScore = new Float64Array(size).fill(Infinity)
  const closed = new Uint8Array(size)

  const h = (x: number, y: number) => {
    // Octile: the true cost of the cheapest unobstructed 8-way walk, so it
    // never overestimates and A* stays optimal.
    const dx = Math.abs(x - goal.x)
    const dy = Math.abs(y - goal.y)
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy)
  }

  const startIdx = index(start.x, start.y)
  gScore[startIdx] = 0
  // A small binary heap: the office is 1600 tiles, and a linear scan of the
  // open set is what makes a walk across it visibly stutter.
  const heap: { f: number; x: number; y: number }[] = [
    { f: h(start.x, start.y), x: start.x, y: start.y },
  ]
  const push = (node: { f: number; x: number; y: number }) => {
    heap.push(node)
    let i = heap.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (heap[parent].f <= heap[i].f) break
      ;[heap[parent], heap[i]] = [heap[i], heap[parent]]
      i = parent
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let small = i
        if (l < heap.length && heap[l].f < heap[small].f) small = l
        if (r < heap.length && heap[r].f < heap[small].f) small = r
        if (small === i) break
        ;[heap[small], heap[i]] = [heap[i], heap[small]]
        i = small
      }
    }
    return top
  }

  while (heap.length > 0) {
    const current = pop()
    const currentIdx = index(current.x, current.y)
    if (closed[currentIdx]) continue
    closed[currentIdx] = 1

    if (current.x === goal.x && current.y === goal.y) {
      const path: Point[] = []
      let idx = currentIdx
      while (idx !== -1 && idx !== startIdx) {
        path.push(centre(grid, idx % grid.width, Math.floor(idx / grid.width)))
        idx = cameFrom[idx]
      }
      return path.reverse()
    }

    for (const [dx, dy] of STEPS) {
      const nx = current.x + dx
      const ny = current.y + dy
      if (isBlocked(grid, nx, ny)) continue
      // No cutting corners: a diagonal needs both of its sides free.
      if (dx !== 0 && dy !== 0) {
        if (
          isBlocked(grid, current.x + dx, current.y) ||
          isBlocked(grid, current.x, current.y + dy)
        ) {
          continue
        }
      }
      const nIdx = index(nx, ny)
      if (closed[nIdx]) continue
      const step = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1
      const tentative = gScore[currentIdx] + step
      if (tentative >= gScore[nIdx]) continue
      gScore[nIdx] = tentative
      cameFrom[nIdx] = currentIdx
      push({ f: tentative + h(nx, ny), x: nx, y: ny })
    }
  }
  return undefined
}
