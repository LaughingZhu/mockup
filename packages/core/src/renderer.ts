import * as THREE from 'three'
import { buildDepthSurface, buildMaskedDepthSurface, mapMaskedPlacement, mapPlacement, type PlacementBuffers } from './geometry'
import { boundedImageSize } from './image'
import type { ImageSource, MockupDepth, SurfaceMask, SurfacePlacement, SurfacePoint } from './types'

export type MockupRenderer = {
  render(placement: SurfacePlacement, highlight?: boolean): void
  exportPng(): Promise<{ blob: Blob; width: number; height: number }>
  dispose(): void
}

function imageDimensions(image: HTMLImageElement, source: ImageSource) {
  const width = image.naturalWidth || source.width || 0
  const height = image.naturalHeight || source.height || 0
  if (width < 1 || height < 1) throw new Error('Base image dimensions unavailable')
  return { width, height }
}

function imageTexture(image: HTMLImageElement, width: number, height: number) {
  // A CanvasTexture gives SVG/data URLs the same upload path as raster images
  // and makes the source dimensions explicit before WebGL samples it.
  const bitmap = document.createElement('canvas')
  bitmap.width = width
  bitmap.height = height
  const context = bitmap.getContext('2d')
  if (!context) throw new Error('Canvas unavailable')
  context.drawImage(image, 0, 0, width, height)
  const texture = new THREE.CanvasTexture(bitmap)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

/**
 * Create the single renderer shared by the preview and PNG export paths.
 * Three.js is isolated here; callers only depend on the returned lifecycle.
 */
export function createMockupRenderer(
  canvas: HTMLCanvasElement,
  base: HTMLImageElement,
  design: HTMLImageElement | null,
  depth: MockupDepth,
  mask?: SurfaceMask,
  anchor?: SurfacePoint,
): MockupRenderer {
  const source = { src: '', width: base.naturalWidth, height: base.naturalHeight }
  const { width: baseWidth, height: baseHeight } = imageDimensions(base, source)
  const aspect = baseHeight / baseWidth
  const surface = mask
    ? buildMaskedDepthSurface(depth, mask, anchor ?? { x: 0.5, y: 0.5 }, aspect, 128)
    : buildDepthSurface(depth, aspect, { maxSegments: 256 })
  const geometry = new THREE.PlaneGeometry(1, aspect, surface.columns - 1, surface.rows - 1)
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute
  for (let index = 0; index < positions.count; index++) positions.setZ(index, surface.z[index])
  positions.needsUpdate = true

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: false,
    antialias: true,
    preserveDrawingBuffer: true,
  })
  renderer.setPixelRatio(1)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const photoTexture = imageTexture(base, baseWidth, baseHeight)
  const designTexture = imageTexture(design ?? base, design?.naturalWidth || baseWidth, design?.naturalHeight || baseHeight)
  const maskTexture = new THREE.DataTexture(
    mask?.values ?? new Uint8Array(surface.z.length).fill(255),
    mask?.width ?? surface.columns,
    mask?.height ?? surface.rows,
    THREE.RedFormat,
  )
  maskTexture.flipY = true
  maskTexture.magFilter = THREE.LinearFilter
  maskTexture.minFilter = THREE.LinearFilter
  maskTexture.needsUpdate = true
  const printMaskTexture = new THREE.DataTexture(
    new Uint8Array(surface.z.length), surface.columns, surface.rows, THREE.RedFormat,
  )
  printMaskTexture.flipY = true
  printMaskTexture.magFilter = THREE.LinearFilter
  printMaskTexture.minFilter = THREE.LinearFilter
  printMaskTexture.needsUpdate = true
  const buffers: PlacementBuffers = {
    uv: new Float32Array(surface.z.length * 2),
    printMask: new Uint8Array(surface.z.length),
    queue: new Int32Array(surface.z.length),
    mask: new Uint8Array(surface.z.length),
  }
  const printAttribute = new THREE.BufferAttribute(buffers.uv, 2).setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('designUv', printAttribute)

  const material = new THREE.ShaderMaterial({
    uniforms: {
      photograph: { value: photoTexture },
      design: { value: designTexture },
      surfaceMask: { value: maskTexture },
      printMask: { value: printMaskTexture },
      hasDesign: { value: Boolean(design) },
      hasSurfaceMask: { value: Boolean(mask) },
      highlight: { value: false },
    },
    vertexShader: `
      attribute vec2 designUv;
      varying vec2 photoUv;
      varying vec2 artworkUv;
      void main() {
        photoUv = uv;
        artworkUv = designUv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D photograph;
      uniform sampler2D design;
      uniform sampler2D surfaceMask;
      uniform sampler2D printMask;
      uniform bool hasDesign;
      uniform bool hasSurfaceMask;
      uniform bool highlight;
      varying vec2 photoUv;
      varying vec2 artworkUv;
      void main() {
        vec4 photo = texture2D(photograph, photoUv);
        float inside = step(0.0, artworkUv.x) * step(artworkUv.x, 1.0)
          * step(0.0, artworkUv.y) * step(artworkUv.y, 1.0);
        vec4 ink = texture2D(design, clamp(artworkUv, 0.0, 1.0));
        float surface = hasSurfaceMask ? texture2D(surfaceMask, photoUv).r : 1.0;
        float footprint = smoothstep(0.2, 0.8, texture2D(printMask, photoUv).r);
        float coverage = hasDesign ? inside * surface * footprint * ink.a : 0.0;
        float light = dot(photo.rgb, vec3(0.2126, 0.7152, 0.0722));
        float shade = clamp(pow(max(light, 0.001), 0.35), 0.25, 1.0);
        vec3 result = mix(photo.rgb, min(vec3(1.0), ink.rgb * shade), coverage);
        if (highlight && hasSurfaceMask) result = mix(result, vec3(0.05, 0.72, 0.78), surface * 0.28);
        gl_FragColor = vec4(result, 1.0);
        #include <colorspace_fragment>
      }
    `,
  })
  const scene = new THREE.Scene()
  scene.add(new THREE.Mesh(geometry, material))
  const camera = new THREE.OrthographicCamera(-0.5, 0.5, aspect / 2, -aspect / 2, 0.1, 10)
  camera.position.z = 2
  const previewSize = boundedImageSize(baseWidth, baseHeight, 1024)
  renderer.setSize(previewSize.width, previewSize.height, false)
  let disposed = false

  const render = (placement: SurfacePlacement, highlight = false) => {
    if (disposed) return
    const mapped = 'printU' in surface
      ? mapMaskedPlacement(surface, placement, design ? design.naturalHeight / design.naturalWidth : 1, buffers)
      : mapPlacement(surface, placement, design ? design.naturalHeight / design.naturalWidth : 1, buffers)
    printAttribute.needsUpdate = true
    if (mapped.printMaskChanged) {
      printMaskTexture.image.data = buffers.printMask
      printMaskTexture.needsUpdate = true
    }
    material.uniforms.highlight.value = highlight
    renderer.render(scene, camera)
  }

  return {
    render,
    async exportPng() {
      if (disposed) throw new Error('Mockup renderer is disposed')
      const size = boundedImageSize(baseWidth, baseHeight, Math.min(4096, renderer.capabilities.maxTextureSize))
      const output = document.createElement('canvas')
      output.width = size.width
      output.height = size.height
      const context = output.getContext('2d')
      if (!context) throw new Error('Canvas unavailable')
      renderer.setSize(size.width, size.height, false)
      renderer.render(scene, camera)
      context.drawImage(canvas, 0, 0, size.width, size.height)
      renderer.setSize(previewSize.width, previewSize.height, false)
      return {
        blob: await new Promise<Blob>((resolve, reject) => output.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG export failed')), 'image/png')),
        ...size,
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      geometry.dispose()
      material.dispose()
      photoTexture.dispose()
      designTexture.dispose()
      maskTexture.dispose()
      printMaskTexture.dispose()
      renderer.dispose()
    },
  }
}
