import { describe, expect, it } from 'vitest'
import {
  buildConnectedPrintMask,
  buildDepthSurface,
  buildMaskedDepthSurface,
  mapMaskedPlacement,
  mapPlacement,
} from './geometry'
import type { MockupDepth } from './types'

function depth(fn: (x: number, y: number) => number): MockupDepth {
  const width = 33
  const height = 33
  return {
    width,
    height,
    values: Float32Array.from({ length: width * height }, (_, index) => fn(
      (index % width) / (width - 1), Math.floor(index / width) / (height - 1),
    )),
  }
}

describe('depth geometry', () => {
  it('keeps a flat print centered and preserves design aspect', () => {
    const surface = buildDepthSurface(depth(() => 0.5), 1, { maxSegments: 32 })
    const buffers = { uv: new Float32Array(surface.z.length * 2), printMask: new Uint8Array(surface.z.length) }
    const result = mapPlacement(surface, { x: 0.5, y: 0.5, scale: 1, rotation: 0 }, 0.5, buffers)
    const center = (16 * surface.columns + 16) * 2
    expect(result.uv[center]).toBeCloseTo(0.5)
    expect(result.uv[center + 1]).toBeCloseTo(0.5)
    const horizontal = result.uv[(16 * surface.columns + 24) * 2] - 0.5
    const vertical = 0.5 - result.uv[((24 * surface.columns + 16) * 2) + 1]
    expect(vertical / horizontal).toBeCloseTo(2, 1)
  })

  it('creates additional arc length around a curved depth profile', () => {
    const flat = buildDepthSurface(depth(() => 0.5), 1, { maxSegments: 32 })
    const curved = buildDepthSurface(depth((x) => Math.sqrt(Math.max(0, 1 - (2 * x - 1) ** 2))), 1, { maxSegments: 32 })
    const flatPlacement = mapPlacement(flat, { x: 0.5, y: 0.5, scale: 1, rotation: 0 }, 1, { uv: new Float32Array(flat.z.length * 2), printMask: new Uint8Array(flat.z.length) })
    const curvedPlacement = mapPlacement(curved, { x: 0.5, y: 0.5, scale: 1, rotation: 0 }, 1, { uv: new Float32Array(curved.z.length * 2), printMask: new Uint8Array(curved.z.length) })
    const edge = (16 * curved.columns + 29) * 2
    expect(curvedPlacement.uv[edge] - 0.5).toBeGreaterThan((flatPlacement.uv[edge] - 0.5) * 1.05)
  })

  it('switches the depth-connected print region without asking for a surface point', () => {
    const surface = buildDepthSurface(depth((x) => x < 0.5 ? 0.2 : 0.8), 1, { maxSegments: 32 })
    const buffers = {
      uv: new Float32Array(surface.z.length * 2),
      printMask: new Uint8Array(surface.z.length),
      mask: new Uint8Array(surface.z.length),
      queue: new Int32Array(surface.z.length),
    }
    const left = mapPlacement(surface, { x: 0.25, y: 0.5, scale: 1, rotation: 0 }, 0.5, buffers)
    const right = mapPlacement(surface, { x: 0.75, y: 0.5, scale: 1, rotation: 0 }, 0.5, buffers)
    expect(left.maskChanged).toBe(true)
    expect(right.maskChanged).toBe(true)
    expect(left.printMask.some(Boolean)).toBe(true)
    expect(right.printMask.some(Boolean)).toBe(true)
    expect([...buffers.mask].some((value, index) => value === 255 && index % surface.columns > surface.columns / 2)).toBe(true)
  })

  it('removes disconnected UV islands from a print footprint', () => {
    const uv = new Float32Array(25 * 2).fill(-1)
    for (const index of [7, 8, 9, 11, 12, 13, 14, 17, 18, 19]) {
      uv[index * 2] = 0.5
      uv[index * 2 + 1] = 0.5
    }
    uv[0] = 0.5
    uv[1] = 0.5
    const output = new Uint8Array(25)
    expect(buildConnectedPrintMask(5, 5, uv, new Uint8Array(25).fill(255), 12, output)).toBe(true)
    expect(output[12]).toBe(255)
    expect(output[0]).toBe(0)
  })

  it('clips the grid to a selected mask and rejects invalid depth', () => {
    const mask = { width: 5, height: 5, values: Uint8Array.from({ length: 25 }, (_, index) => {
      const x = index % 5
      const y = Math.floor(index / 5)
      return x > 0 && x < 4 && y > 0 && y < 4 ? 255 : 0
    }) }
    const surface = buildDepthSurface(depth(() => 0.5), 1, { maxSegments: 32, mask })
    expect(surface.allowed[0]).toBe(0)
    expect(surface.allowed[Math.floor(surface.rows / 2) * surface.columns + Math.floor(surface.columns / 2)]).toBe(255)
    expect(() => buildDepthSurface({ width: 2, height: 2, values: new Float32Array([NaN]) }, 1)).toThrow('Invalid depth map')
  })

  it('builds a local masked surface and keeps the print inside its connected silhouette', () => {
    const mask = {
      width: 9,
      height: 9,
      values: Uint8Array.from({ length: 81 }, (_, index) => {
        const x = index % 9
        const y = Math.floor(index / 9)
        const radius = 3.4 - Math.abs(y - 4) * 0.25
        return Math.abs(x - 4) <= radius ? 255 : 0
      }),
    }
    const surface = buildMaskedDepthSurface(
      depth((x) => 0.5 + Math.sin(x * Math.PI) * 0.35),
      mask,
      { x: 0.5, y: 0.5 },
      1,
      32,
    )
    const buffers = {
      uv: new Float32Array(surface.z.length * 2),
      printMask: new Uint8Array(surface.z.length),
      mask: new Uint8Array(surface.z.length),
      queue: new Int32Array(surface.z.length),
    }
    const mapped = mapMaskedPlacement(surface, { x: 0.5, y: 0.5, scale: 1, rotation: 0 }, 0.5, buffers)
    expect(mapped.printMask.some(Boolean)).toBe(true)
    for (let index = 0; index < mapped.printMask.length; index++) {
      if (mapped.printMask[index]) expect(surface.matte[index]).toBeGreaterThanOrEqual(128)
    }
  })
})
