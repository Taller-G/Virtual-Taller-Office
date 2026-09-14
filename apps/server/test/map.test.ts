import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLASS_ZONE,
  doorAt,
  findDoors,
  findSpawnPoint,
  findSpawnPoints,
  getZones,
  isSolidAt,
  objectCollides,
  objectLayers,
  PROP_COLLIDES,
  tileCollides,
  tileLayers,
  tilesetForGid,
  validateMap,
  WORLDS,
  type SpawnPoint,
  type TiledMap,
  type Zone,
} from '@vto/shared'
import { DEFAULT_MAP_FILE, loadOfficeMap, loadWorldMaps } from '../src/map'

/** Tileset propio de la Chiron Office (ver `tools/make-chiron-tileset.py`). */
const DARK_TILESET = 'ChironDark'

/**
 * Estas pruebas corren contra el mapa REAL que se despliega. Si alguien lo
 * edita en Tiled y rompe el contrato (spawn faltante, tileset sin embeber,
 * imagen que no existe), fallan acá antes de llegar a producción.
 */
describe('Mapa de la oficina (archivo real)', () => {
  const office = loadOfficeMap(DEFAULT_MAP_FILE)
  const map = office.data

  it('cumple el contrato mínimo', () => {
    expect(validateMap(map)).toEqual([])
    expect(map.tilewidth).toBe(32)
    expect(map.tileheight).toBe(32)
  })

  it('tiene un punto de aparición sobre piso transitable', () => {
    const spawn = findSpawnPoint(map)
    expect(spawn.x).toBeGreaterThan(0)
    expect(spawn.y).toBeGreaterThan(0)
    expect(spawn.x).toBeLessThan(office.bounds.width)
    expect(spawn.y).toBeLessThan(office.bounds.height)
    expect(isSolidAt(map, spawn.x, spawn.y)).toBe(false)
    expect(spawn.radius).toBeGreaterThan(0)
  })

  it('las imágenes de todos los tilesets existen junto al mapa', () => {
    for (const ts of map.tilesets) {
      const image = resolve(dirname(office.file), ts.image)
      expect(existsSync(image), `falta ${ts.image} (tileset ${ts.name})`).toBe(true)
    }
  })

  it('tiene capas separadas de piso, paredes, muebles y objetos con colisión', () => {
    const tiles = tileLayers(map)
    expect(tiles.length).toBeGreaterThanOrEqual(2)
    // Al menos una capa de tiles sin colisiones (piso) y una con (paredes).
    const withSolid = tiles.filter((layer) =>
      layer.data.some(
        (gid, i) =>
          isSolidAt(
            map,
            (i % layer.width) * map.tilewidth,
            Math.floor(i / layer.width) * map.tileheight,
          ) && gid !== 0,
      ),
    )
    expect(withSolid.length).toBeGreaterThanOrEqual(1)
    expect(withSolid.length).toBeLessThan(tiles.length)

    const objects = objectLayers(map).filter((l) => l.objects.some((o) => o.gid))
    const solid = objects.filter((l) => l.objects.some((o) => objectCollides(l, o)))
    const decor = objects.filter((l) => l.objects.some((o) => !objectCollides(l, o)))
    expect(solid.length).toBeGreaterThanOrEqual(1)
    expect(decor.length).toBeGreaterThanOrEqual(1)
  })

  it('define las cuatro zonas mínimas de la oficina', () => {
    const names = getZones(map).map((z) => z.name.toLowerCase())
    expect(names.some((n) => n.includes('recepci'))).toBe(true)
    expect(names.some((n) => n.includes('escritorio'))).toBe(true)
    expect(names.some((n) => n.includes('reuni'))).toBe(true)
    expect(names.some((n) => n.includes('cocina'))).toBe(true)
  })

  it('tiene las salas del ala sur: dos de reunión más y una de foco', () => {
    const names = getZones(map).map((z) => z.name)
    expect(names.filter((n) => n.toLowerCase().includes('reuni')).length).toBeGreaterThanOrEqual(3)
    expect(names).toContain('Sala de foco')
  })

  it('no hay ninguna sala que atrape: se llega caminando a todas las zonas', () => {
    const spawn = findSpawnPoint(map)
    const alcanzables = reachableTiles(map, {
      col: Math.floor(spawn.x / map.tilewidth),
      row: Math.floor(spawn.y / map.tileheight),
    })
    for (const zone of getZones(map)) {
      expect(
        tilesOf(map, zone).some(({ col, row }) => alcanzables.has(`${col},${row}`)),
        `no se llega caminando a la zona "${zone.name}"`,
      ).toBe(true)
    }
  })

  it('la colisión de los objetos está en el mapa, no en código', () => {
    // Ninguna capa de objetos con muebles depende de su nombre: solo de `collides`.
    const layers = objectLayers(map).filter((l) => l.objects.some((o) => o.gid))
    for (const layer of layers) {
      const declared = layer.properties?.some((p) => p.name === PROP_COLLIDES)
      const perObject = layer.objects.every((o) =>
        o.properties?.some((p) => p.name === PROP_COLLIDES),
      )
      expect(declared || perObject, `la capa "${layer.name}" no declara collides`).toBe(true)
    }
    expect(objectLayers(map).some((l) => l.objects.some((o) => o.type === CLASS_ZONE))).toBe(true)
  })
})

describe('loadOfficeMap: mapas inválidos fallan con mensaje claro', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vto-map-'))

  function write(name: string, content: unknown) {
    const file = join(dir, name)
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content))
    return file
  }

  const minimal: TiledMap = {
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
      { type: 'tilelayer', id: 1, name: 'Piso', width: 2, height: 2, data: [1, 1, 2, 1] },
      {
        type: 'objectgroup',
        id: 2,
        name: 'Spawn',
        objects: [{ id: 1, type: 'spawn', point: true, x: 16, y: 16 }],
      },
    ],
  }

  it('acepta un mapa mínimo válido', () => {
    const office = loadOfficeMap(write('ok.json', minimal))
    expect(office.spawn).toEqual({ name: 'default', x: 16, y: 16, radius: 32, dir: 'down' })
    expect(office.bounds).toEqual({ width: 64, height: 64 })
  })

  it('archivo inexistente', () => {
    expect(() => loadOfficeMap(join(dir, 'nope.json'))).toThrow(/No se pudo leer el mapa/)
  })

  it('JSON roto', () => {
    expect(() => loadOfficeMap(write('bad.json', '{ not json'))).toThrow(/no es JSON válido/)
  })

  it('sin spawn', () => {
    const noSpawn = { ...minimal, layers: [minimal.layers[0]] }
    expect(() => loadOfficeMap(write('nospawn.json', noSpawn))).toThrow(/exactamente un objeto/)
  })

  it('spawn sobre una pared', () => {
    const onWall = {
      ...minimal,
      layers: [
        minimal.layers[0],
        {
          type: 'objectgroup',
          id: 2,
          name: 'Spawn',
          objects: [{ id: 1, type: 'spawn', point: true, x: 16, y: 48 }],
        },
      ],
    }
    expect(() => loadOfficeMap(write('wall.json', onWall))).toThrow(/tile que colisiona/)
  })

  it('tileset externo (no embebido)', () => {
    const external = {
      ...minimal,
      tilesets: [{ firstgid: 1, source: 't.tsx' }],
    }
    expect(() => loadOfficeMap(write('ext.json', external))).toThrow(/no está embebido/)
  })
})

/**
 * Los mapas reales de todos los mundos, cargados como los carga el servidor al
 * arrancar: cada uno válido por su cuenta y las puertas cerrando entre ellos.
 */
describe('Mundos (archivos reales)', () => {
  const worlds = loadWorldMaps()

  it('carga un mapa por cada mundo del registro', () => {
    expect([...worlds.keys()]).toEqual(WORLDS.map((w) => w.id))
    for (const [id, world] of worlds) {
      expect(validateMap(world.data), `mapa de ${id}`).toEqual([])
    }
  })

  it('la First Office y la Chiron Office están conectadas en los dos sentidos', () => {
    const first = worlds.get('first-office')!.data
    const chiron = worlds.get('chiron-office')!.data

    const toChiron = findDoors(first)
    expect(toChiron).toHaveLength(1)
    expect(toChiron[0]).toMatchObject({ world: 'chiron-office', spawn: 'desde-first-office' })

    const toFirst = findDoors(chiron)
    expect(toFirst).toHaveLength(1)
    expect(toFirst[0]).toMatchObject({ world: 'first-office', spawn: 'desde-chiron' })

    // Cada puerta llega a un spawn que existe y que no está sobre la puerta de
    // vuelta: si no, se volvería al mundo anterior al instante.
    const arrival = findSpawnPoint(chiron, 'desde-first-office')
    expect(doorAt(chiron, arrival.x, arrival.y)).toBeUndefined()
    const back = findSpawnPoint(first, 'desde-chiron')
    expect(doorAt(first, back.x, back.y)).toBeUndefined()

    // Y se llega de espaldas al vano por el que se entró, no mirándolo: si no,
    // el primer paso hacia adelante es volver por donde se vino.
    expect(facingAwayFromDoor(chiron, arrival), 'llegada a Chiron').toBe(true)
    expect(facingAwayFromDoor(first, back), 'vuelta a la First Office').toBe(true)
  })

  it('ningún spawn ni puerta cae sobre una pared o un mueble sólido', () => {
    for (const [id, world] of worlds) {
      const map = world.data
      const furniture = tilesBlockedByFurniture(map)
      const libre = (x: number, y: number) =>
        !furniture.has(tileKey(map, x, y)) && !isSolidAt(map, x, y)

      for (const spawn of findSpawnPoints(map)) {
        expect(libre(spawn.x, spawn.y), `${id}: spawn "${spawn.name}"`).toBe(true)
      }
      for (const door of findDoors(map)) {
        const x = door.x + door.width / 2
        const y = door.y + door.height / 2
        expect(libre(x, y), `${id}: puerta "${door.name}"`).toBe(true)
      }
    }
  })

  it('ningún mundo se puede abandonar caminando: las paredes lo cierran', () => {
    for (const [id, world] of worlds) {
      const map = world.data
      const alcanzables = reachableTiles(map, {
        col: Math.floor(world.spawn.x / map.tilewidth),
        row: Math.floor(world.spawn.y / map.tileheight),
      })
      // `reachableTiles` ya trata el afuera del mapa como bloqueado, así que
      // el síntoma de un agujero en el muro es llegar caminando a su borde.
      for (const key of alcanzables) {
        const [col, row] = key.split(',').map(Number)
        expect(
          col > 0 && row > 0 && col < map.width - 1 && row < map.height - 1,
          `${id}: se camina hasta el borde del mapa en (${col},${row}): falta pared`,
        ).toBe(true)
      }
    }
  })

  it('a la puerta de cada mundo se llega caminando desde su entrada', () => {
    for (const [id, world] of worlds) {
      const map = world.data
      const entry = world.spawn
      const alcanzables = reachableTiles(map, {
        col: Math.floor(entry.x / map.tilewidth),
        row: Math.floor(entry.y / map.tileheight),
      })
      for (const door of findDoors(map)) {
        const key = tileKey(map, door.x + door.width / 2, door.y + door.height / 2)
        expect(
          alcanzables.has(key),
          `${id}: no se llega caminando a la puerta "${door.name}"`,
        ).toBe(true)
      }
    }
  })
})

/**
 * El mapa de la Chiron Office: el segundo mundo, oscuro y de planta abierta.
 * Lo que se chequea acá es lo que lo hace habitable (que se llegue caminando a
 * todas sus zonas, que la llegada caiga en el vestíbulo) y lo que lo hace
 * *otro lugar*: que esté pintado con su propio tileset oscuro.
 */
describe('Chiron Office (archivo real)', () => {
  const chiron = loadWorldMaps().get('chiron-office')!
  const map = chiron.data

  it('tiene un vestíbulo de llegada y varias zonas más, todas con nombre', () => {
    const zones = getZones(map)
    const names = zones.map((z) => z.name)
    expect(names).toContain('Vestíbulo')
    expect(names.length).toBeGreaterThanOrEqual(3)
    for (const zone of zones) expect(zone.name.trim(), 'zona sin nombre').not.toBe('')
    // Sin nombres repetidos: dos etiquetas iguales en el mapa no se entienden.
    expect(new Set(names).size).toBe(names.length)
  })

  it('se llega caminando desde la entrada a todas sus zonas', () => {
    const alcanzables = reachableTiles(map, {
      col: Math.floor(chiron.spawn.x / map.tilewidth),
      row: Math.floor(chiron.spawn.y / map.tileheight),
    })
    for (const zone of getZones(map)) {
      expect(
        tilesOf(map, zone).some(({ col, row }) => alcanzables.has(`${col},${row}`)),
        `no se llega caminando a la zona "${zone.name}"`,
      ).toBe(true)
    }
  })

  it('se llega desde la First Office al vestíbulo, no a cualquier lado', () => {
    const arrival = findSpawnPoint(map, 'desde-first-office')
    const zone = getZones(map).find(
      (z) =>
        arrival.x >= z.x &&
        arrival.x < z.x + z.width &&
        arrival.y >= z.y &&
        arrival.y < z.y + z.height,
    )
    expect(zone?.name).toBe('Vestíbulo')
  })

  it('está pintado con su propio tileset oscuro, no con el de la First Office', () => {
    const dark = map.tilesets.find((ts) => ts.name === DARK_TILESET)
    expect(dark, `falta el tileset ${DARK_TILESET}`).toBeDefined()
    expect(existsSync(resolve(dirname(chiron.file), dark!.image))).toBe(true)

    // Todos los tiles dibujados salen de ahí: si alguno viniera del pack claro
    // se vería un parche iluminado en el medio de la oficina.
    const ajenos = new Set<string>()
    for (const layer of tileLayers(map)) {
      for (const gid of layer.data) {
        if (!gid) continue
        const ts = tilesetForGid(map, gid)
        if (ts && ts.name !== DARK_TILESET) ajenos.add(ts.name)
      }
    }
    expect([...ajenos]).toEqual([])
  })

  it('tiene su capa de luces, que no bloquea el paso', () => {
    const layers = tileLayers(map)
    expect(layers.length).toBeGreaterThanOrEqual(3)
    // Las luces se dibujan sobre el piso; ninguna puede volver sólido un tile
    // por el que ya se caminaba.
    const luces = layers.find((l) => l.name === 'Luces')
    expect(luces, 'falta la capa "Luces"').toBeDefined()
    for (const [i, gid] of luces!.data.entries()) {
      if (!gid) continue
      const col = i % luces!.width
      const row = Math.floor(i / luces!.width)
      expect(tileCollides(map, gid), `la luz en (${col},${row}) bloquea el paso`).toBe(false)
    }
  })
})

/** Clave de la celda que contiene el punto. */
function tileKey(map: TiledMap, x: number, y: number): string {
  return `${Math.floor(x / map.tilewidth)},${Math.floor(y / map.tileheight)}`
}

/** Tiles que ocupa una zona. */
function tilesOf(map: TiledMap, zone: Zone) {
  const out: { col: number; row: number }[] = []
  for (
    let row = Math.floor(zone.y / map.tileheight);
    row * map.tileheight < zone.y + zone.height;
    row++
  )
    for (
      let col = Math.floor(zone.x / map.tilewidth);
      col * map.tilewidth < zone.x + zone.width;
      col++
    )
      out.push({ col, row })
  return out
}

/** Tiles bloqueados por un mueble con colisión (los tiles los cubre `isSolidAt`). */
function tilesBlockedByFurniture(map: TiledMap): Set<string> {
  const blocked = new Set<string>()
  for (const layer of objectLayers(map)) {
    for (const obj of layer.objects) {
      if (!obj.gid || !objectCollides(layer, obj)) continue
      const tileset = tilesetForGid(map, obj.gid)
      const width = obj.width ?? tileset?.tilewidth ?? map.tilewidth
      const height = obj.height ?? tileset?.tileheight ?? map.tileheight
      // En Tiled la `y` de un objeto-tile es su borde inferior.
      for (
        let row = Math.floor((obj.y - height) / map.tileheight);
        row * map.tileheight < obj.y;
        row++
      )
        for (
          let col = Math.floor(obj.x / map.tilewidth);
          col * map.tilewidth < obj.x + width;
          col++
        )
          blocked.add(`${col},${row}`)
    }
  }
  return blocked
}

/**
 * ¿El punto de llegada queda de espaldas a la puerta por la que se entró? Se
 * mide contra la puerta más cercana del mismo mapa, que es la que le
 * corresponde: `dir` tiene que apuntar hacia adentro, lejos de ella.
 */
function facingAwayFromDoor(map: TiledMap, spawn: SpawnPoint): boolean {
  const doors = findDoors(map)
  expect(doors.length, 'el mapa no tiene puertas').toBeGreaterThan(0)
  const nearest = doors
    .map((d) => ({ x: d.x + d.width / 2, y: d.y + d.height / 2 }))
    .reduce((best, c) =>
      Math.hypot(c.x - spawn.x, c.y - spawn.y) < Math.hypot(best.x - spawn.x, best.y - spawn.y)
        ? c
        : best,
    )
  const away = { x: spawn.x - nearest.x, y: spawn.y - nearest.y }
  const facing = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  }[spawn.dir]
  return facing.x * away.x + facing.y * away.y > 0
}

/**
 * Tiles a los que se llega caminando desde `start`, con la misma noción de
 * "bloqueado" que usa el juego: tiles con `collides` y muebles con colisión.
 */
function reachableTiles(map: TiledMap, start: { col: number; row: number }): Set<string> {
  const furniture = tilesBlockedByFurniture(map)
  const blocked = (col: number, row: number) =>
    col < 0 ||
    row < 0 ||
    col >= map.width ||
    row >= map.height ||
    furniture.has(`${col},${row}`) ||
    isSolidAt(
      map,
      col * map.tilewidth + map.tilewidth / 2,
      row * map.tileheight + map.tileheight / 2,
    )

  const seen = new Set<string>([`${start.col},${start.row}`])
  const pending = [start]
  while (pending.length > 0) {
    const { col, row } = pending.pop()!
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next = { col: col + dc, row: row + dr }
      const key = `${next.col},${next.row}`
      if (seen.has(key) || blocked(next.col, next.row)) continue
      seen.add(key)
      pending.push(next)
    }
  }
  return seen
}
