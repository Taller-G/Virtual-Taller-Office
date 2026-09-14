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
 * El contrato de las puertas: un rectángulo de clase `door` que nombra mundo y
 * spawn de destino, y spawns con nombre a los que se llega. Acá se prueba el
 * contrato puro (sin servidor ni archivos): qué lee la app de un mapa y con
 * qué mensaje rechaza uno roto.
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
      { type: 'tilelayer', id: 1, name: 'Piso', width: 2, height: 2, data },
      { type: 'objectgroup', id: 2, name: 'Objetos', objects },
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

describe('Spawns con nombre', () => {
  it('el spawn sin nombre es la entrada al mundo', () => {
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

  it('un spawn con nombre se pide por su nombre y trae su dirección', () => {
    const map = mapWith([spawn(1, undefined, 16, 16), spawn(2, 'desde-chiron', 48, 16, 'left')])
    expect(validateMap(map)).toEqual([])
    expect(findSpawnPoint(map, 'desde-chiron')).toMatchObject({ x: 48, y: 16, dir: 'left' })
    expect(findSpawnPoints(map).map((s) => s.name)).toEqual([DEFAULT_SPAWN_NAME, 'desde-chiron'])
  })

  it('pedir un spawn que no existe falla', () => {
    const map = mapWith([spawn(1, undefined, 16, 16)])
    expect(() => findSpawnPoint(map, 'no-existe')).toThrow(/llamado "no-existe"/)
  })

  it('dos spawns con el mismo nombre son un error del mapa', () => {
    const map = mapWith([
      spawn(1, undefined, 16, 16),
      spawn(2, 'llegada', 48, 16),
      spawn(3, 'llegada', 16, 48),
    ])
    expect(validateMap(map)).toContain('Hay más de un spawn llamado "llegada"')
  })

  it('un spawn con nombre sobre una pared es un error del mapa', () => {
    const map = mapWith([spawn(1, undefined, 16, 16), spawn(2, 'llegada', 48, 16)], [1, 2, 1, 1])
    expect(validateMap(map)).toContain('El spawn "llegada" cae sobre un tile que colisiona')
  })
})

describe('Puertas dentro de un mapa', () => {
  it('lee mundo y spawn destino del rectángulo', () => {
    const map = mapWith([
      spawn(1, undefined, 16, 16),
      door(2, 'A Chiron', 'chiron-office', 'desde-first-office', 32, 0),
    ])
    expect(validateMap(map)).toEqual([])
    expect(findDoors(map)).toEqual([
      {
        id: 2,
        name: 'A Chiron',
        world: 'chiron-office',
        spawn: 'desde-first-office',
        x: 32,
        y: 0,
        width: 32,
        height: 32,
      },
    ])
    expect(doorAt(map, 40, 8)?.world).toBe('chiron-office')
    expect(doorAt(map, 8, 8)).toBeUndefined()
  })

  it('alcanza con que el cuerpo del jugador toque el umbral', () => {
    const map = mapWith([
      spawn(1, undefined, 16, 16),
      door(2, 'A Chiron', 'chiron-office', 'desde-first-office', 32, 0),
    ])
    // Cuerpo de 18x12 que asoma apenas dentro de la puerta (x >= 32).
    expect(doorAtRect(map, { x: 20, y: 20, width: 18, height: 12 })?.id).toBe(2)
    // Pegado al borde pero sin tocarla: no viaja.
    expect(doorAtRect(map, { x: 14, y: 20, width: 18, height: 12 })).toBeUndefined()
    // Debajo de la puerta, alineado en x: tampoco.
    expect(doorAtRect(map, { x: 34, y: 40, width: 18, height: 12 })).toBeUndefined()
  })

  it('una puerta sin mundo o sin spawn se rechaza nombrando la puerta', () => {
    const map = mapWith([spawn(1, undefined, 16, 16), door(7, 'Puerta rota', '', '', 32, 0)])
    const problems = validateMap(map)
    expect(problems).toContain(
      'La puerta "Puerta rota" (objeto 7) no declara la propiedad "world" (mundo destino)',
    )
    expect(problems).toContain(
      'La puerta "Puerta rota" (objeto 7) no declara la propiedad "spawn" (spawn de llegada)',
    )
  })

  it('una puerta sin área se rechaza', () => {
    const broken = { ...door(9, '', 'otro', 'llegada'), width: 0, height: 0 }
    const map = mapWith([spawn(1, undefined, 16, 16), broken])
    expect(validateMap(map)).toContain(
      'La puerta objeto 9 no tiene área: tiene que ser un rectángulo',
    )
  })
})

describe('Validación cruzada entre mundos', () => {
  const chiron = mapWith([
    spawn(1, undefined, 16, 16),
    spawn(2, 'desde-first-office', 48, 16, 'down'),
  ])

  it('acepta una puerta que apunta a un mundo y un spawn que existen', () => {
    const first = mapWith([
      spawn(1, undefined, 16, 16),
      door(2, 'A Chiron', 'chiron-office', 'desde-first-office', 32, 0),
    ])
    expect(validateWorldDoors({ 'first-office': first, 'chiron-office': chiron })).toEqual([])
  })

  it('rechaza una puerta a un mundo desconocido nombrando puerta y destino', () => {
    const first = mapWith([
      spawn(1, undefined, 16, 16),
      door(42, 'A ninguna parte', 'mundo-fantasma', 'x', 32, 0),
    ])
    const [problem, ...rest] = validateWorldDoors({
      'first-office': first,
      'chiron-office': chiron,
    })
    expect(rest).toEqual([])
    expect(problem).toContain('La puerta "A ninguna parte" (objeto 42) del mundo "first-office"')
    expect(problem).toContain('lleva al mundo "mundo-fantasma", que no existe')
  })

  it('rechaza una puerta a un spawn que el mundo destino no define', () => {
    const first = mapWith([
      spawn(1, undefined, 16, 16),
      door(43, 'A Chiron', 'chiron-office', 'sin-puerta', 32, 0),
    ])
    const [problem, ...rest] = validateWorldDoors({
      'first-office': first,
      'chiron-office': chiron,
    })
    expect(rest).toEqual([])
    expect(problem).toContain('La puerta "A Chiron" (objeto 43) del mundo "first-office"')
    expect(problem).toContain(
      'llega al spawn "sin-puerta" del mundo "chiron-office", que no lo define',
    )
  })
})

describe('loadWorldMaps: los mundos se validan juntos al arrancar', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vto-worlds-'))

  function world(id: string, map: TiledMap): WorldDefinition {
    const file = join(dir, `${id}.json`)
    writeFileSync(file, JSON.stringify(map))
    return { id, name: id, mapFile: file }
  }

  const chironMap = mapWith([
    spawn(1, undefined, 16, 16),
    spawn(2, 'desde-first-office', 48, 16, 'down'),
    door(3, 'A First Office', 'first-office', 'desde-chiron', 0, 32),
  ])

  it('carga los dos mundos cuando las puertas cierran en ambos sentidos', () => {
    const maps = loadWorldMaps([
      world(
        'first-office',
        mapWith([
          spawn(1, undefined, 16, 16),
          spawn(2, 'desde-chiron', 48, 16, 'left'),
          door(3, 'A Chiron', 'chiron-office', 'desde-first-office', 0, 32),
        ]),
      ),
      world('chiron-office', chironMap),
    ])
    expect([...maps.keys()]).toEqual(['first-office', 'chiron-office'])
    expect(maps.get('chiron-office')?.spawn.name).toBe(DEFAULT_SPAWN_NAME)
  })

  it('una puerta a un mundo que no existe impide arrancar', () => {
    expect(() =>
      loadWorldMaps([
        world(
          'first-office',
          mapWith([spawn(1, undefined, 16, 16), door(8, 'A ninguna parte', 'chiron-offices', 'x')]),
        ),
        world('chiron-office', chironMap),
      ]),
    ).toThrow(
      /La puerta "A ninguna parte" \(objeto 8\).*lleva al mundo "chiron-offices", que no existe/s,
    )
  })

  it('una puerta a un spawn que no existe impide arrancar', () => {
    expect(() =>
      loadWorldMaps([
        world(
          'first-office',
          mapWith([spawn(1, undefined, 16, 16), door(9, 'A Chiron', 'chiron-office', 'garage')]),
        ),
        world('chiron-office', chironMap),
      ]),
    ).toThrow(/llega al spawn "garage" del mundo "chiron-office", que no lo define/)
  })
})
