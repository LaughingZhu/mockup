import type {
  ImageSource,
  SurfaceAnalysisInput,
  SurfaceAnalysisResult,
  SurfaceProvider,
} from '@visible-surface-mockup/core'

export const LOCAL_MODEL_ENDPOINT = 'http://127.0.0.1:8080/analyze'

function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

function loadImage(url: string, signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    const cleanup = () => {
      image.onload = null
      image.onerror = null
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      image.src = ''
      reject(abortReason(signal))
    }
    image.onload = () => {
      cleanup()
      resolve(image)
    }
    image.onerror = () => {
      cleanup()
      reject(new Error('Local model input image could not be decoded'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    image.src = url
  })
}

async function imageSourceToDataUrl(source: ImageSource, signal: AbortSignal) {
  const response = await fetch(source.src, { signal })
  if (!response.ok) throw new Error('Unable to load local model input (' + response.status + ')')
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = await loadImage(objectUrl, signal)
    const sourceWidth = image.naturalWidth || source.width || 1
    const sourceHeight = image.naturalHeight || source.height || 1
    const scale = Math.min(1, 768 / Math.max(sourceWidth, sourceHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(sourceWidth * scale))
    canvas.height = Math.max(1, Math.round(sourceHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas unavailable while preparing local model input')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

type WireDepth = { width: number; height: number; values: number[] }
type WireCandidate = {
  id: string
  score: number
  mask: { width: number; height: number; values: number[]; ref?: string }
}
type WireResult = {
  version: 1
  sourceKey?: string
  model: string
  depth: WireDepth
  candidates: WireCandidate[]
}

function decodeResult(input: SurfaceAnalysisInput, payload: WireResult): SurfaceAnalysisResult {
  if (payload.version !== 1 || typeof payload.model !== 'string'
    || payload.depth.values.length !== payload.depth.width * payload.depth.height
    || !payload.candidates.length) {
    throw new Error('Local model returned an invalid analysis result')
  }
  return {
    version: 1,
    sourceKey: input.sourceKey,
    model: payload.model,
    depth: {
      width: payload.depth.width,
      height: payload.depth.height,
      values: Float32Array.from(payload.depth.values),
    },
    candidates: payload.candidates.map((candidate) => {
      if (candidate.mask.values.length !== candidate.mask.width * candidate.mask.height) {
        throw new Error('Local model returned an invalid surface mask')
      }
      return {
        id: candidate.id,
        score: candidate.score,
        mask: {
          width: candidate.mask.width,
          height: candidate.mask.height,
          values: Uint8Array.from(candidate.mask.values),
        },
        ...(candidate.mask.ref ? { maskRef: candidate.mask.ref } : {}),
      }
    }),
  }
}

export function createLocalModelProvider(endpoint = LOCAL_MODEL_ENDPOINT): SurfaceProvider {
  return {
    async analyze(input, signal) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          image: await imageSourceToDataUrl(input.base, signal),
          point: input.point,
          negativePoints: input.negativePoints ?? [],
        }),
        signal,
      })
      const payload = await response.json().catch(() => null) as WireResult | { error?: string } | null
      if (!response.ok) {
        throw new Error(payload && 'error' in payload ? payload.error || 'Local model failed' : 'Local model failed (' + response.status + ')')
      }
      return decodeResult(input, payload as WireResult)
    },
  }
}
