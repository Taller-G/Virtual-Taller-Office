import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLASS_DOOR,
  CLASS_SPAWN,
  DEFAULT_SPAWN_NAME,
  doorAt,
  doorAtRect,
  findDoors,
  findSpawnPoint,
  findSpawnPoints,
  PROP_COLLIDES,
  PROP_DOOR_SPAWN,
  PROP_DOOR_WORLD,
  PROP_SPAWN_DIR,
  validateMap,
  validateWorldDoors,
  type TiledMap,
  type TiledObject,
  type WorldDefinition,
} from '@vto/shared'
import { loadWorldMaps } from '../src/map'

/**
 * The contract of the doors: a rectangle of class `door` that names the
 * destination world and spawn, and named spawns that get arrived at. What is
 * tested here is the pure contract (no server, no files): what the app reads
 * from a map and with which message it rejects a broken one.
 */
function mapWith(objects: TiledObject[], data = [1, 1, 1, 1]): TiledMap {
  return {
    orientation: 'orthogonal',
    width: 2,
    height: 2,
    tilewidth: 32,
    tileheight: 32,
    tilesets: [
      {
        name: 't',
        firstgid: 1,
        image: 't.png',
        imagewidth: 64,
        imageheight: 32,
        tilewidth: 32,
        tileheight: 32,
        tilecount: 2,
        columns: 2,
        tiles: [{ id: 1, properties: [{ name: PROP_COLLIDES, type: 'bool', value: true }] }],
      },
    ],
    layers: [
      { type: 'tilelayer', id: 1, name: 'Floor', width: 2, height: 2, data },
      { type: 'objectgroup', id: 2, name: 'Objects', objects },
    ],
  }
}

const spawn = (id: number, name: string | undefined, x: number, y: number, dir?: string) =>
  ({
    id,
    name,
    type: CLASS_SPAWN,
    point: true,
    x,
    y,
    properties: dir ? [{ name: PROP_SPAWN_DIR, type: 'string', value: dir }] : undefined,
  }) satisfies TiledObject

const door = (id: number, name: string, world: unknown, target: unknown, x = 0, y = 0) =>
  ({
    id,
    name,
    type: CLASS_DOOR,
    x,
    y,
    width: 32,
    height: 32,
    properties: [
      { name: PROP_DOOR_WORLD, type: 'string', value: world },
      { name: PROP_DOOR_SPAWN, type: 'string', value: target },
    ],
  }) satisfies TiledObject

describe('Named spawns', () => {
  it('the spawn without a name is the entrance to the world', () => {
    const map = mapWith([spawn(1, undefined, 16, 16)])
    expect(validateMap(map)).toEqual([])
    expect(findSpawnPoint(map)).toEqual({
      name: DEFAULT_SPAWN_NAME,
      x: 16,
      y: 16,
      radius: 32,
      dir: 'down',
    })
  })

  it('a named spawn is asked for by its name and carries its direction', () => {
    const map = mapWith([spawn(1, undefined, 16, 16), spawn(2, 'from-chiron', 48, 16, 'left')])
    expect(validateMap(map)).toEqual([])
    expect(findSpawnPoint(map, 'from-chiron')).toMatchObject({ x: 48, y: 16, dir: 'left' })
    expect(findSpawnPoints(map).map((s) => s.name)).toEqual([DEFAULT_SPAWN_NAME, 'from-chiron'])
  })

  it('asking for a spawn that does not exist fails', () => {
    const map = mapWith([spawn(1, undefined, 16, 16)])
    expect(() => findSpawnPoint(map, 'does-not-exist')).toThrow(/named "does-not-exist"/)
  })

  it('two spawns with the same name are an error in the map', () => {
    const map = mapWith([
      spawn(1, undefined, 16, 16),
      spawn(2, 'arrival', 48, 16),
      spawn(3, 'arrival', 16, 48),
    ])
    expect(validateMap(map)).toContain('There is more than one spawn named "arrival"')
  })

  it('a named spawn on a wall is an error in the map', () => {
    const map = mapWith([spawn(1, undefined, 16, 16), spawn(2, 'arrival', 48, 16)], [1, 2, 1, 1])
    expect(validateMap(map)).toContain('The spawn "arrival" falls on a colliding tile')
  })
})

describe('Doors within a map', () => {
  it('reads the destination world and spawn from the rectangle', () => {
    const map = mapWith([
      spawn(1, undefined, 16, 16),
      door(2, 'To Chiron', 'chiron-office', 'from-first-office', 32, 0),
    ])
    expect(validateMap(map)).toEqual([])
    expect(findDoors(map)).toEqual([
      {
        id: 2,
        name: 'To Chiron',
        world: 'chiron-office',
        spawn: 'from-first-office',
        x: 32,
        y: 0,
        width: 32,
        height: 32,
      },
    ])
    expect(doorAt(map, 40, 8)?.world).toBe('chiron-office')
    expect(doorAt(map, 8, 8)).toBeUndefined()
  })

  it('it is enough for the player\'s body to touch the threshold', () => {
    const map = mapWith([
      spawn(1, undefined, 16, 16),
      door(2, 'To Chiron', 'chiron-office', 'from-first-office', 32, 0),
    ])
    // An 18x12 body that pokes just inside the door (x >= 32).
    expect(doorAtRect(map, { x: 20, y: 20, width: 18, height: 12 })?.id).toBe(2)
    // Right up against the edge but not touching it: no travel.
    expect(doorAtRect(map, { x: 14, y: 20, width: 18, height: 12 })).toBeUndefined()
    // Below the door, aligned in x: no travel either.
    expect(doorAtRect(map, { x: 34, y: 40, width: 18, height: 12 })).toBeUndefined()
  })

  it('a door without a world or without a spawn is rejected, naming the door', () => {
    const map = mapWith([spawn(1, undefined, 16, 16), door(7, 'Broken door', '', '', 32, 0)])
    const problems = validateMap(map)
    expect(problems).toContain(
      'The door "Broken door" (object 7) does not declare the property "world" (destination world)',
    )
    expect(problems).toContain(
      'The door "Broken door" (object 7) does not declare the property "spawn" (arrival spawn)',
    )
  })

  it('a door without an area is rejected', () => {
    const broken = { ...door(9, '', 'other', 'arrival'), width: 0, height: 0 }
    const map = mapWith([spawn(1, undefined, 16, 16), broken])
    expect(validateMap(map)).toContain('The door object 9 has no area: it has to be a rectangle')
  })
})

describe('Cross-validation between worlds', () => {
  const chiron = mapWith([
    spawn(1, undefined, 16, 16),
    spawn(2, 'from-first-office', 48, 16, 'down'),
  ])

  it('accepts a door pointing at a world and a spawn that exist', () => {
    const first = mapWith([
      spawn(1, undefined, 16, 16),
      door(2, 'To Chiron', 'chiron-office', 'from-first-office', 32, 0),
    ])
    expect(validateWorldDoors({ 'first-office': first, 'chiron-office': chiron })).toEqual([])
  })

  it('rejects a door to an unknown world, naming door and destination', () => {
    const first = mapWith([
      spawn(1, undefined, 16, 16),
      door(42, 'To nowhere', 'ghost-world', 'x', 32, 0),
    ])
    const [problem, ...rest] = validateWorldDoors({
      'first-office': first,
      'chiron-office': chiron,
    })
    expect(rest).toEqual([])
    expect(problem).toContain('The door "To nowhere" (object 42) of world "first-office"')
    expect(problem).toContain('leads to world "ghost-world", which does not exist')
  })

  it('rejects a door to a spawn the destination world does not define', () => {
    const first = mapWith([
      spawn(1, undefined, 16, 16),
      door(43, 'To Chiron', 'chiron-office', 'no-door', 32, 0),
    ])
    const [problem, ...rest] = validateWorldDoors({
      'first-office': first,
      'chiron-office': chiron,
    })
    expect(rest).toEqual([])
    expect(problem).toContain('The door "To Chiron" (object 43) of world "first-office"')
    expect(problem).toContain(
      'arrives at spawn "no-door" of world "chiron-office", which does not define it',
    )
  })
})

describe('loadWorldMaps: the worlds are validated together at boot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vto-worlds-'))

  function world(id: string, map: TiledMap): WorldDefinition {
    const file = join(dir, `${id}.json`)
    writeFileSync(file, JSON.stringify(map))
    return { id, name: id, mapFile: file }
  }

  const chironMap = mapWith([
    spawn(1, undefined, 16, 16),
    spawn(2, 'from-first-office', 48, 16, 'down'),
    door(3, 'To the First Office', 'first-office', 'from-chiron', 0, 32),
  ])

  it('loads both worlds when the doors match up in both directions', () => {
    const maps = loadWorldMaps([
      world(
        'first-office',
        mapWith([
          spawn(1, undefined, 16, 16),
          spawn(2, 'from-chiron', 48, 16, 'left'),
          door(3, 'To Chiron', 'chiron-office', 'from-first-office', 0, 32),
        ]),
      ),
      world('chiron-office', chironMap),
    ])
    expect([...maps.keys()]).toEqual(['first-office', 'chiron-office'])
    expect(maps.get('chiron-office')?.spawn.name).toBe(DEFAULT_SPAWN_NAME)
  })

  it('a door to a world that does not exist prevents startup', () => {
    expect(() =>
      loadWorldMaps([
        world(
          'first-office',
          mapWith([spawn(1, undefined, 16, 16), door(8, 'To nowhere', 'chiron-offices', 'x')]),
        ),
        world('chiron-office', chironMap),
      ]),
    ).toThrow(
      /The door "To nowhere" \(object 8\).*leads to world "chiron-offices", which does not exist/s,
    )
  })

  it('a door to a spawn that does not exist prevents startup', () => {
    expect(() =>
      loadWorldMaps([
        world(
          'first-office',
          mapWith([spawn(1, undefined, 16, 16), door(9, 'To Chiron', 'chiron-office', 'garage')]),
        ),
        world('chiron-office', chironMap),
      ]),
    ).toThrow(/arrives at spawn "garage" of world "chiron-office", which does not define it/)
  })
})
