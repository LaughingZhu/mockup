import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SurfaceAnalysisResult } from '@visible-surface-mockup/core'
import { SurfaceMockupEditor } from './SurfaceMockupEditor'

const { loadImage, createMockupRenderer } = vi.hoisted(() => ({ loadImage: vi.fn(), createMockupRenderer: vi.fn() }))

vi.mock('@visible-surface-mockup/core', async () => {
  const actual = await vi.importActual<typeof import('@visible-surface-mockup/core')>('@visible-surface-mockup/core')
  return {
    ...actual,
    loadImage,
    createMockupRenderer,
  }
})

const mask = { width: 4, height: 4, values: new Uint8Array(16).fill(255) }
const depth = { width: 4, height: 4, values: new Float32Array(16).fill(0.5) }
const result: SurfaceAnalysisResult = {
  version: 1,
  sourceKey: 'photo-1',
  model: 'fixture-model',
  depth,
  candidates: [{ id: 'surface-a', score: 0.94, mask, maskRef: 'fixtures/surface-a' }],
}

function provider() {
  return { analyze: vi.fn(async (_input, signal: AbortSignal) => { signal.throwIfAborted(); return result }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  loadImage.mockResolvedValue({ naturalWidth: 320, naturalHeight: 240 } as HTMLImageElement)
  createMockupRenderer.mockReturnValue({ render: vi.fn(), exportPng: vi.fn(), dispose: vi.fn() })
})

describe('SurfaceMockupEditor', () => {
  it('confirms a candidate and does not analyze again while dragging', async () => {
    const analysis = provider()
    const onPlacementChange = vi.fn()
    const onInteractionEnd = vi.fn()
    render(<SurfaceMockupEditor surfaceMode="candidate" base={{ id: 'photo-1', src: '/photo.svg', width: 320, height: 240 }} design={{ id: 'art-1', src: '/art.svg', width: 2, height: 1 }} provider={analysis} onPlacementChange={onPlacementChange} onInteractionEnd={onInteractionEnd} />)
    expect(await screen.findByRole('button', { name: 'Use this surface' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use this surface' }))
    await waitFor(() => expect(screen.getByTestId('mockup-placement-canvas')).toHaveAttribute('data-surface-state', 'ready'))
    expect(analysis.analyze).toHaveBeenCalledOnce()

    const canvas = screen.getByTestId('mockup-placement-canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 75))
    canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 50, clientY: 37.5 }))
    window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 70, clientY: 45 }))
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 70, clientY: 45 }))
    expect(onPlacementChange).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0.7, y: 0.6 }))
    expect(onInteractionEnd).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'move',
      placement: expect.objectContaining({ x: 0.7, y: 0.6 }),
      point: { x: 0.7, y: 0.6 },
    }))
    expect(analysis.analyze).toHaveBeenCalledOnce()
  })

  it('supports keyboard movement and exposes a retryable error', async () => {
    const onPlacementChange = vi.fn()
    render(<SurfaceMockupEditor surfaceMode="candidate" base={{ id: 'photo-1', src: '/photo.svg' }} design={{ src: '/art.svg', width: 1, height: 1 }} provider={provider()} onPlacementChange={onPlacementChange} />)
    const canvas = await screen.findByTestId('mockup-placement-canvas')
    fireEvent.click(screen.getByRole('button', { name: 'Use this surface' }))
    await waitFor(() => expect(canvas).toHaveAttribute('data-surface-state', 'ready'))
    fireEvent.keyDown(canvas, { key: 'ArrowRight' })
    expect(onPlacementChange).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0.51 }))
  })

  it('uses the first model surface automatically in the default whole mode', async () => {
    const onSurfaceSelectionChange = vi.fn()
    render(<SurfaceMockupEditor base={{ id: 'photo-1', src: '/photo.svg', width: 320, height: 240 }} design={{ src: '/art.svg', width: 1, height: 1 }} provider={provider()} onSurfaceSelectionChange={onSurfaceSelectionChange} />)
    const canvas = await screen.findByTestId('mockup-placement-canvas')
    await waitFor(() => expect(canvas).toHaveAttribute('data-surface-state', 'ready'))
    expect(screen.queryByRole('button', { name: 'Use this surface' })).not.toBeInTheDocument()
    expect(onSurfaceSelectionChange).toHaveBeenCalledWith(expect.objectContaining({ candidateId: 'whole-image-surface' }))
    await waitFor(() => expect(createMockupRenderer).toHaveBeenCalled())
    expect(createMockupRenderer.mock.calls.at(-1)?.[4]).toBeUndefined()
  })

  it('keeps the whole-image field while placement moves anywhere', async () => {
    const analysis = provider()
    const view = render(<SurfaceMockupEditor base={{ id: 'photo-1', src: '/photo.svg', width: 320, height: 240 }}
      design={{ src: '/art.svg', width: 1, height: 1 }} provider={analysis} placement={{ x: 0.5, y: 0.5, scale: 1, rotation: 0 }} />)
    await waitFor(() => expect(view.getByTestId('mockup-placement-canvas')).toHaveAttribute('data-surface-state', 'ready'))
    view.rerender(<SurfaceMockupEditor base={{ id: 'photo-1', src: '/photo.svg', width: 320, height: 240 }}
      design={{ src: '/art.svg', width: 1, height: 1 }} provider={analysis} placement={{ x: 0.9, y: 0.1, scale: 1, rotation: 0 }} />)
    await waitFor(() => expect(view.getByTestId('mockup-placement-canvas')).toHaveAttribute('data-surface-state', 'ready'))
    expect(analysis.analyze).toHaveBeenCalledOnce()
  })
})
