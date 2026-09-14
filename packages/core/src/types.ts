/** A browser-loadable image plus an optional stable application reference. */
export type ImageSource = {
  src: string
  width?: number
  height?: number
  id?: string
  alt?: string
}

/** Relative inverse depth. Larger values represent points nearer the camera. */
export type MockupDepth = {
  width: number
  height: number
  values: Float32Array
}

/** A binary or grayscale surface matte in normalized image coordinates. */
export type SurfaceMask = {
  width: number
  height: number
  values: Uint8Array
}

export type SurfacePoint = { x: number; y: number }

/** Placement is expressed in normalized photograph coordinates. */
export type SurfacePlacement = {
  x: number
  y: number
  scale: number
  rotation: number
}

/** Stable candidate metadata returned by a segmentation/depth provider. */
export type SurfaceCandidate = {
  id: string
  score: number
  mask: SurfaceMask
  /** Optional provider-owned reference, safe to persist instead of mask pixels. */
  maskRef?: string
}

export type SurfaceAnalysisResult = {
  version: 1
  sourceKey: string
  model: string
  depth: MockupDepth
  candidates: SurfaceCandidate[]
}

export type SurfaceAnalysisInput = {
  sourceKey: string
  base: ImageSource
  point: SurfacePoint
  negativePoints?: SurfacePoint[]
}

/**
 * Optional analysis boundary. The editor never knows how a provider finds a
 * surface; it only consumes normalized depth, masks, and stable IDs.
 */
export type SurfaceProvider = {
  analyze(input: SurfaceAnalysisInput, signal: AbortSignal): Promise<SurfaceAnalysisResult>
}

/** JSON-safe selection metadata. It intentionally does not contain mask pixels. */
export type SurfaceSelection = {
  version: 1
  sourceKey: string
  model: string
  candidateId: string
  point: SurfacePoint
  maskRef?: string
  negativePoints?: SurfacePoint[]
}

export type MockupState = {
  sourceRef: string
  designRef?: string
  selection: SurfaceSelection | null
  placement: SurfacePlacement
}

export type PersistedMockupState = MockupState & { version: 1 }
