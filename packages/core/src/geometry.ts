import type { MockupDepth, SurfaceMask, SurfacePlacement, SurfacePoint } from './types'

export type DepthSurface = {
  columns: number
  rows: number
  aspect: number
  z: Float32Array
  horizontal: Float32Array
  vertical: Float32Array
  allowed: Uint8Array
  /** Depth-connected region labels used by the whole-image placement path. */
  labels: Int32Array
}

export type PlacementBuffers = {
  uv: Float32Array
  printMask: Uint8Array
  queue?: Int32Array
  mask?: Uint8Array
  initialized?: boolean
  region?: number
}

function assertFinite(value: number, label: string) {
  if (!Number.isFinite(value)) throw new Error(`Invalid ${label}`)
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function sampleArray(width: number, height: number, values: Float32Array, u: number, v: number) {
  const x = clamp(u, 0, 1) * (width - 1)
  const y = clamp(v, 0, 1) * (height - 1)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = x - x0
  const ty = y - y0
  const top = values[y0 * width + x0] * (1 - tx) + values[y0 * width + x1] * tx
  const bottom = values[y1 * width + x0] * (1 - tx) + values[y1 * width + x1] * tx
  return top * (1 - ty) + bottom * ty
}

export function sampleDepth(depth: MockupDepth, u: number, v: number) {
  if (depth.width < 1 || depth.height < 1 || depth.values.length !== depth.width * depth.height) {
    throw new Error('Invalid depth map')
  }
  return sampleArray(depth.width, depth.height, depth.values, u, v)
}

function maskAt(mask: SurfaceMask | undefined, u: number, v: number) {
  if (!mask) return 255
  const x = Math.round(clamp(u, 0, 1) * (mask.width - 1))
  const y = Math.round(clamp(v, 0, 1) * (mask.height - 1))
  return mask.values[y * mask.width + x] ?? 0
}

/**
 * Build one displaced grid. The grid is reused for every placement change, so
 * moving the design only updates UV attributes and a connected print mask.
 */
export function buildDepthSurface(
  depth: MockupDepth,
  aspect: number,
  options: { mask?: SurfaceMask; maxSegments?: number; depthGain?: number } = {},
): DepthSurface {
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error('Invalid surface aspect')
  if (depth.width < 2 || depth.height < 2 || depth.values.length !== depth.width * depth.height) {
    throw new Error('Invalid depth map')
  }
  for (const value of depth.values) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Invalid depth map')
  }
  if (options.mask && (options.mask.width < 1 || options.mask.height < 1
    || options.mask.values.length !== options.mask.width * options.mask.height)) {
    throw new Error('Invalid surface mask')
  }
  const maxSegments = Math.max(8, Math.min(256, Math.round(options.maxSegments ?? 128)))
  const columns = Math.max(2, Math.round(maxSegments * Math.min(1, 1 / aspect))) + 1
  const rows = Math.max(2, Math.round(maxSegments * Math.min(1, aspect))) + 1
  const count = columns * rows
  const z = new Float32Array(count)
  const allowed = new Uint8Array(count)
  const gain = options.depthGain ?? 0.35

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const index = y * columns + x
      const u = x / (columns - 1)
      const v = y / (rows - 1)
      allowed[index] = maskAt(options.mask, u, v) >= 128 ? 255 : 0
      z[index] = sampleDepth(depth, u, v) * gain
    }
  }
  if (options.mask && !allowed.some(Boolean)) throw new Error('Empty surface mask')

  const horizontal = new Float32Array(count)
  const vertical = new Float32Array(count)
  const dx = 1 / (columns - 1)
  const dy = aspect / (rows - 1)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const index = y * columns + x
      if (x > 0) {
        const previous = index - 1
        const slope = allowed[index] && allowed[previous] ? z[index] - z[previous] : 0
        horizontal[index] = horizontal[previous] + Math.hypot(dx, slope)
      }
      if (y > 0) {
        const previous = index - columns
        const slope = allowed[index] && allowed[previous] ? z[index] - z[previous] : 0
        vertical[index] = vertical[previous] + Math.hypot(dy, slope)
      }
    }
  }
  // The default whole-image path does not ask SAM to choose an object. Instead
  // it keeps the depth-connected region at the current anchor, matching the
  // private Canvas renderer while allowing anchors anywhere in the image.
  const labels = new Int32Array(count)
  const queue = new Int32Array(count)
  let region = 0
  for (let seed = 0; seed < count; seed++) {
    if (labels[seed] || !allowed[seed]) continue
    region += 1
    let head = 0
    let tail = 1
    labels[seed] = region
    queue[0] = seed
    while (head < tail) {
      const current = queue[head++]
      const x = current % columns
      const y = Math.floor(current / columns)
      const visit = (next: number) => {
        if (next < 0 || next >= count || labels[next] || !allowed[next]
          || Math.abs(z[next] - z[current]) > 0.018) return
        labels[next] = region
        queue[tail++] = next
      }
      if (x) visit(current - 1)
      if (x < columns - 1) visit(current + 1)
      if (y) visit(current - columns)
      if (y < rows - 1) visit(current + columns)
    }
  }
  return { columns, rows, aspect, z, horizontal, vertical, allowed, labels }
}

export type MaskedDepthSurface = {
  columns: number
  rows: number
  aspect: number
  z: Float32Array
  matte: Uint8Array
  printU: Float32Array
  printV: Float32Array
}

function gridSample(values: Float32Array, width: number, height: number, u: number, v: number) {
  const x = clamp(u, 0, 1) * (width - 1)
  const y = clamp(v, 0, 1) * (height - 1)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = x - x0
  const ty = y - y0
  const top = values[y0 * width + x0] * (1 - tx) + values[y0 * width + x1] * tx
  const bottom = values[y1 * width + x0] * (1 - tx) + values[y1 * width + x1] * tx
  return top * (1 - ty) + bottom * ty
}

function nearestMaskPoint(mask: SurfaceMask, point: SurfacePoint) {
  if (maskAt(mask, point.x, point.y) >= 128) return point
  let best = Number.POSITIVE_INFINITY
  let result = point
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.values[y * mask.width + x] < 128) continue
      const u = x / Math.max(1, mask.width - 1)
      const v = y / Math.max(1, mask.height - 1)
      const distance = (u - point.x) ** 2 + (v - point.y) ** 2
      if (distance < best) {
        best = distance
        result = { x: u, y: v }
      }
    }
  }
  return result
}

/**
 * Build the local visible surface selected by the model mask. Smoothing never
 * crosses the matte boundary, and relative depth is normalized to the patch
 * rather than the whole photograph. This is the model-backed path used by the
 * local demo; it remains a single-view surface approximation, not full 3D.
 */
export function buildMaskedDepthSurface(
  depth: MockupDepth,
  mask: SurfaceMask,
  anchor: SurfacePoint,
  aspect: number,
  maxSegments = 128,
): MaskedDepthSurface {
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error('Invalid surface aspect')
  if (depth.width < 2 || depth.height < 2 || depth.values.length !== depth.width * depth.height
    || !depth.values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new Error('Invalid surface depth')
  }
  if (mask.width < 1 || mask.height < 1 || mask.values.length !== mask.width * mask.height
    || !mask.values.some((value) => value >= 128)) throw new Error('Empty surface mask')

  const segments = Math.max(8, Math.min(256, Math.round(maxSegments)))
  const columns = Math.max(3, Math.round(segments * Math.min(1, 1 / aspect)) + 1)
  const rows = Math.max(3, Math.round(segments * Math.min(1, aspect)) + 1)
  const count = columns * rows
  const z = new Float32Array(count)
  const matte = new Uint8Array(count)
  const raw = new Float32Array(count)
  const samples: number[] = []
  let left = columns
  let right = 0
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const index = y * columns + x
      const u = x / (columns - 1)
      const v = y / (rows - 1)
      raw[index] = sampleDepth(depth, u, v)
      matte[index] = maskAt(mask, u, v)
      if (matte[index] >= 128) {
        samples.push(raw[index])
        left = Math.min(left, x)
        right = Math.max(right, x)
      }
    }
  }
  if (!samples.length || !samples.every(Number.isFinite)) throw new Error('Invalid surface depth')
  samples.sort((a, b) => a - b)
  const low = samples[Math.floor(samples.length * 0.05)] ?? samples[0]
  const high = samples[Math.floor(samples.length * 0.95)] ?? samples[samples.length - 1]
  const extent = Math.max(0.05, (right - left) / (columns - 1))
  const gain = Math.min(1, extent * 0.45 / Math.max(0.08, high - low))

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const index = y * columns + x
      if (matte[index] < 128) continue
      let sum = 0
      let weight = 0
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const px = x + ox
          const py = y + oy
          if (px < 0 || py < 0 || px >= columns || py >= rows) continue
          const neighbor = py * columns + px
          if (matte[neighbor] < 128 || Math.abs(raw[neighbor] - raw[index]) > 0.08) continue
          const localWeight = ox === 0 && oy === 0 ? 4 : 1
          sum += raw[neighbor] * localWeight
          weight += localWeight
        }
      }
      z[index] = (sum / Math.max(1, weight) - low) * gain
    }
  }

  const horizontal = new Float32Array(count)
  const vertical = new Float32Array(count)
  const dx = 1 / (columns - 1)
  const dy = aspect / (rows - 1)
  const step = (current: number, previous: number, spacing: number) => matte[current] < 128 || matte[previous] < 128
    ? spacing
    : Math.hypot(spacing, Math.min(spacing * 3, Math.abs(z[current] - z[previous])))
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const index = y * columns + x
      if (x) horizontal[index] = horizontal[index - 1] + step(index, index - 1, dx)
      if (y) vertical[index] = vertical[index - columns] + step(index, index - columns, dy)
    }
  }

  const point = nearestMaskPoint(mask, anchor)
  const pointV = point.y
  const sampleZ = (u: number, v: number) => gridSample(z, columns, rows, u, v)
  const dzdy = (sampleZ(point.x, pointV + dy / aspect) - sampleZ(point.x, pointV - dy / aspect)) / (2 * dy)
  const tilt = dzdy / Math.hypot(1, dzdy)
  const centerZ = sampleZ(point.x, pointV)
  const printU = new Float32Array(count)
  const printV = new Float32Array(count)
  const sampleHorizontal = (u: number, v: number) => gridSample(horizontal, columns, rows, u, v)
  const sampleVertical = (u: number, v: number) => gridSample(vertical, columns, rows, u, v)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const index = y * columns + x
      const u = x / (columns - 1)
      const v = y / (rows - 1)
      printU[index] = horizontal[index] - sampleHorizontal(point.x, v)
      printV[index] = vertical[index] - sampleVertical(u, pointV)
        + tilt * (sampleZ(u, pointV) - centerZ)
    }
  }
  return { columns, rows, aspect, z, matte, printU, printV }
}

function uvInside(uv: Float32Array, index: number) {
  const u = uv[index * 2]
  const v = uv[index * 2 + 1]
  return u >= 0 && u <= 1 && v >= 0 && v <= 1
}

/** Keep only the connected print footprint containing the anchor. */
export function buildConnectedPrintMask(
  columns: number,
  rows: number,
  uv: Float32Array,
  allowed: Uint8Array,
  seed: number,
  output: Uint8Array,
  queue: Int32Array<ArrayBufferLike> = new Int32Array(output.length) as Int32Array<ArrayBufferLike>,
) {
  output.fill(0)
  if (seed < 0 || seed >= output.length || allowed[seed] === 0 || !uvInside(uv, seed)) return false
  let head = 0
  let tail = 1
  queue[0] = seed
  output[seed] = 255
  while (head < tail) {
    const current = queue[head++]
    const x = current % columns
    const y = Math.floor(current / columns)
    const neighbors = [
      x > 0 ? current - 1 : -1,
      x < columns - 1 ? current + 1 : -1,
      y > 0 ? current - columns : -1,
      y < rows - 1 ? current + columns : -1,
    ]
    for (const next of neighbors) {
      if (next < 0 || output[next] || allowed[next] === 0 || !uvInside(uv, next)) continue
      const du = Math.abs(uv[next * 2] - uv[current * 2])
      const dv = Math.abs(uv[next * 2 + 1] - uv[current * 2 + 1])
      if (du > 0.32 || dv > 0.32) continue
      output[next] = 255
      queue[tail++] = next
    }
  }
  return true
}

function nearestAllowed(surface: DepthSurface, x: number, y: number) {
  const targetX = clamp(x, 0, 1) * (surface.columns - 1)
  const targetY = clamp(y, 0, 1) * (surface.rows - 1)
  const preferred = Math.round(targetY) * surface.columns + Math.round(targetX)
  if (surface.allowed[preferred]) return preferred
  let best = -1
  let distance = Number.POSITIVE_INFINITY
  for (let index = 0; index < surface.allowed.length; index++) {
    if (!surface.allowed[index]) continue
    const px = index % surface.columns
    const py = Math.floor(index / surface.columns)
    const next = (px - targetX) ** 2 + (py - targetY) ** 2
    if (next < distance) { distance = next; best = index }
  }
  return best
}

/** Map a placement into design texture coordinates in surface arc-length units. */
export function mapPlacement(
  surface: DepthSurface,
  placement: SurfacePlacement,
  designAspect: number,
  buffers: PlacementBuffers,
) {
  if (!Number.isFinite(designAspect) || designAspect <= 0) throw new Error('Invalid design aspect')
  if (buffers.uv.length !== surface.z.length * 2 || buffers.printMask.length !== surface.z.length) {
    throw new Error('Placement buffer size mismatch')
  }
  const anchorX = clamp(placement.x, 0, 1) * (surface.columns - 1)
  const anchorY = clamp(placement.y, 0, 1) * (surface.rows - 1)
  const anchorIndex = nearestAllowed(surface, placement.x, placement.y)
  if (anchorIndex < 0) {
    buffers.printMask.fill(0)
    return { uv: buffers.uv, printMask: buffers.printMask, maskChanged: false, printMaskChanged: true }
  }
  const x0 = Math.floor(anchorX)
  const x1 = Math.min(surface.columns - 1, x0 + 1)
  const y0 = Math.floor(anchorY)
  const y1 = Math.min(surface.rows - 1, y0 + 1)
  const xRatio = anchorX - x0
  const yRatio = anchorY - y0
  const rowAnchor = (y: number) => {
    const index = y * surface.columns
    return surface.horizontal[index + x0] * (1 - xRatio) + surface.horizontal[index + x1] * xRatio
  }
  const columnAnchor = (x: number) => {
    return surface.vertical[y0 * surface.columns + x] * (1 - yRatio)
      + surface.vertical[y1 * surface.columns + x] * yRatio
  }
  const angle = placement.rotation * Math.PI / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const width = Math.max(0.01, 0.4 * Math.max(0.01, placement.scale))
  const height = width * designAspect
  const sampleZ = (u: number, v: number) => sampleArray(
    surface.columns, surface.rows, surface.z, u, v,
  )
  const above = Math.max(0, placement.y - 3 / (surface.rows - 1))
  const below = Math.min(1, placement.y + 3 / (surface.rows - 1))
  const gradientY = (sampleZ(placement.x, below) - sampleZ(placement.x, above))
    / Math.max(0.0001, (below - above) * surface.aspect)
  const tilt = gradientY / Math.hypot(1, gradientY)
  const anchorZ = sampleZ(placement.x, placement.y)
  for (let y = 0; y < surface.rows; y++) {
    const horizontalAnchor = rowAnchor(y)
    for (let x = 0; x < surface.columns; x++) {
      const index = y * surface.columns + x
      const verticalAnchor = columnAnchor(x)
      const rowDepth = surface.z[y0 * surface.columns + x] * (1 - yRatio)
        + surface.z[y1 * surface.columns + x] * yRatio
      const u = surface.horizontal[index] - horizontalAnchor
      const v = surface.vertical[index] - verticalAnchor + tilt * (rowDepth - anchorZ)
      buffers.uv[index * 2] = 0.5 + (cos * u + sin * v) / width
      buffers.uv[index * 2 + 1] = 0.5 - (-sin * u + cos * v) / height
    }
  }
  const region = surface.labels[anchorIndex] ?? 0
  const maskChanged = buffers.region !== region
  if (maskChanged && buffers.mask) {
    for (let index = 0; index < surface.allowed.length; index++) {
      buffers.mask[index] = surface.labels[index] === region ? 255 : 0
    }
    buffers.region = region
  }
  const allowed = buffers.mask ?? surface.allowed
  const printMaskChanged = buildConnectedPrintMask(
    surface.columns, surface.rows, buffers.uv, allowed, anchorIndex,
    buffers.printMask, buffers.queue,
  )
  return { uv: buffers.uv, printMask: buffers.printMask, maskChanged, printMaskChanged }
}

/** Map a placement through the fixed local surface generated from a model mask. */
export function mapMaskedPlacement(
  surface: MaskedDepthSurface,
  placement: SurfacePlacement,
  designAspect: number,
  buffers: PlacementBuffers,
) {
  if (!Number.isFinite(designAspect) || designAspect <= 0) throw new Error('Invalid design aspect')
  if (buffers.uv.length !== surface.z.length * 2 || buffers.printMask.length !== surface.z.length) {
    throw new Error('Placement buffer size mismatch')
  }
  const u0 = gridSample(surface.printU, surface.columns, surface.rows, placement.x, placement.y)
  const v0 = gridSample(surface.printV, surface.columns, surface.rows, placement.x, placement.y)
  const angle = placement.rotation * Math.PI / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const width = Math.max(0.01, 0.4 * Math.max(0.01, placement.scale))
  const height = width * designAspect
  for (let index = 0; index < surface.z.length; index++) {
    const u = surface.printU[index] - u0
    const v = surface.printV[index] - v0
    buffers.uv[index * 2] = 0.5 + (cos * u + sin * v) / width
    buffers.uv[index * 2 + 1] = 0.5 - (-sin * u + cos * v) / height
  }
  const maskChanged = buffers.region !== 1
  if (maskChanged && buffers.mask) {
    buffers.mask.set(surface.matte)
    buffers.region = 1
  }
  const anchorX = Math.max(0, Math.min(surface.columns - 1, placement.x * (surface.columns - 1)))
  const anchorY = Math.max(0, Math.min(surface.rows - 1, placement.y * (surface.rows - 1)))
  const seed = Math.round(anchorY) * surface.columns + Math.round(anchorX)
  const allowed = buffers.mask ?? surface.matte
  const printMaskChanged = buildConnectedPrintMask(
    surface.columns,
    surface.rows,
    buffers.uv,
    allowed,
    seed,
    buffers.printMask,
    buffers.queue,
  )
  return { uv: buffers.uv, mask: allowed, printMask: buffers.printMask, maskChanged, printMaskChanged }
}

export function clampPlacement(value: SurfacePlacement): SurfacePlacement {
  assertFinite(value.x, 'placement')
  assertFinite(value.y, 'placement')
  assertFinite(value.scale, 'placement')
  assertFinite(value.rotation, 'placement')
  return {
    // Direct manipulation is allowed to carry the artwork just outside the
    // image while the pointer is held. The renderer hides the print there and
    // the React layer shows the same floating preview as the Canvas editor;
    // clamping here would make edge drags feel stuck.
    x: value.x,
    y: value.y,
    scale: clamp(value.scale, 0.05, 4),
    rotation: value.rotation,
  }
}
