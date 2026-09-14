import type { ImageSource } from './types'

export async function loadImage(source: ImageSource, signal?: AbortSignal): Promise<HTMLImageElement> {
  signal?.throwIfAborted()
  const image = new Image()
  image.decoding = 'async'
  image.crossOrigin = 'anonymous'
  const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
    const onAbort = () => {
      image.src = ''
      reject(signal?.reason ?? new DOMException('The operation was aborted', 'AbortError'))
    }
    image.onload = () => { signal?.removeEventListener('abort', onAbort); resolve(image) }
    image.onerror = () => { signal?.removeEventListener('abort', onAbort); reject(new Error(`Image load failed: ${source.src}`)) }
    signal?.addEventListener('abort', onAbort, { once: true })
    image.src = source.src
  })
  if (typeof image.decode === 'function') {
    try { await Promise.race([loaded, image.decode()]) } catch { await loaded }
  } else {
    await loaded
  }
  signal?.throwIfAborted()
  return image
}

export function boundedImageSize(width: number, height: number, maxSide = 4096) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Invalid image dimensions')
  }
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
