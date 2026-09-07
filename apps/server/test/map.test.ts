import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLASS_ZONE,
  findSpawnPoint,
  getZones,
  isSolidAt,
  objectCollides,
  objectLayers,
  PROP_COLLIDES,
  tileLayers,
  validateMap,
  type TiledMap,
} from '@vto/shared'
import { DEFAULT_MAP_FILE, loadOfficeMap } from '../src/map'

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
    expect(office.spawn).toEqual({ x: 16, y: 16, radius: 32 })
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
