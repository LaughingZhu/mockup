import type { MockupDepth, SurfaceMask, SurfaceProvider } from '@visible-surface-mockup/core'
import depthData from './samples/cup-depth.json'
import maskData from './samples/cup-mask.json'

type DepthRows = { width: number; height: number; rows: string[] }
type MaskRows = { width: number; height: number; rows: string[] }

const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'

function decodeDepth(data: DepthRows): MockupDepth {
  if (data.rows.length !== data.height || data.rows.some((row) => row.length !== data.width)) throw new Error('Invalid sample depth')
  return {
    width: data.width,
    height: data.height,
    values: Float32Array.from(data.rows.join('').split('').map((char) => alphabet.indexOf(char) / (alphabet.length - 1))),
  }
}

function decodeMask(data: MaskRows): SurfaceMask {
  if (data.rows.length !== data.height || data.rows.some((row) => row.length !== data.width)) throw new Error('Invalid sample mask')
  return {
    width: data.width,
    height: data.height,
    values: Uint8Array.from(data.rows.join('').split('').map((char) => char === '#' ? 255 : 0)),
  }
}

export const bundledDepth = decodeDepth(depthData)
export const bundledMask = decodeMask(maskData)
export const DEMO_DEPTH_MODEL = 'Depth Anything V2 Small'
export const DEMO_SURFACE_MODEL = 'SAM ViT-B'
export const DEMO_MODEL_LABEL = DEMO_DEPTH_MODEL + ' + ' + DEMO_SURFACE_MODEL

function flatDepth(size = 32): MockupDepth {
  return { width: size, height: size, values: new Float32Array(size * size).fill(0.5) }
}

function fullMask(size = 32): SurfaceMask {
  return { width: size, height: size, values: new Uint8Array(size * size).fill(255) }
}

/** Deterministic local output for the fixed two-model demo pipeline. */
export function createBundledProvider(): SurfaceProvider {
  return {
    async analyze(input, signal) {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, 180)
        signal.addEventListener('abort', () => { window.clearTimeout(timer); reject(signal.reason) }, { once: true })
      })
      signal.throwIfAborted()
      return {
        version: 1,
        sourceKey: input.sourceKey,
        model: input.sourceKey === 'sample-cup' ? DEMO_MODEL_LABEL : 'Local full-frame fallback',
        depth: input.sourceKey === 'sample-cup' ? bundledDepth : flatDepth(),
        candidates: [{
          id: input.sourceKey === 'sample-cup' ? 'cup-body' : 'uploaded-frame',
          score: input.sourceKey === 'sample-cup' ? 0.99 : 0.5,
          mask: input.sourceKey === 'sample-cup' ? bundledMask : fullMask(),
          maskRef: input.sourceKey === 'sample-cup' ? 'samples/cup-mask.json' : 'runtime/full-frame',
        }],
      }
    },
  }
}
