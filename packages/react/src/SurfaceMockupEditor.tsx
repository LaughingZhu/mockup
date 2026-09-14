import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  clampPlacement,
  createMockupRenderer,
  loadImage,
  type ImageSource,
  type MockupDepth,
  type MockupRenderer,
  type SurfaceAnalysisResult,
  type SurfaceCandidate,
  type SurfaceMask,
  type SurfacePlacement,
  type SurfacePoint,
  type SurfaceProvider,
  type SurfaceSelection,
} from '@visible-surface-mockup/core'
import { SURFACE_EDITOR_COPY, type SurfaceEditorLocale } from './editor-copy'
import './styles.css'

export type SurfaceMockupEditorProps = {
  base: ImageSource
  design?: ImageSource | null
  /** Pass precomputed data for a zero-network demo or a trusted local pipeline. */
  depth?: MockupDepth
  /** Used by candidate mode; whole mode uses depth-connected regions instead. */
  surfaceMask?: SurfaceMask
  /** Optional async analysis boundary for SAM/depth or another provider. */
  provider?: SurfaceProvider
  /** Stable identity used by persisted selections. Prefer an asset ID over a URL. */
  sourceKey?: string
  initialPoint?: SurfacePoint
  /** Whole-image placement is the default interaction; candidate review is opt-in. */
  surfaceMode?: 'whole' | 'candidate'
  /** UI language. English is the default; Chinese is available for the Demo toggle. */
  locale?: SurfaceEditorLocale
  /** Optional negative prompts forwarded to a model-backed provider. */
  negativePoints?: SurfacePoint[]
  selection?: SurfaceSelection | null
  placement?: SurfacePlacement
  defaultPlacement?: SurfacePlacement
  onPlacementChange?: (placement: SurfacePlacement) => void
  /** Fired once after a direct move, resize, or rotate interaction ends. */
  onInteractionEnd?: (event: SurfaceMockupInteractionEnd) => void
  onSurfaceSelectionChange?: (selection: SurfaceSelection | null) => void
  className?: string
  style?: CSSProperties
}

export type SurfaceMockupInteractionKind = 'move' | 'resize' | 'rotate'

export type SurfaceMockupInteractionEnd = {
  kind: SurfaceMockupInteractionKind
  placement: SurfacePlacement
  point: SurfacePoint
}

export type SurfaceMockupEditorHandle = {
  exportPng(): Promise<{ blob: Blob; width: number; height: number }>
  resetPlacement(): void
  chooseAnotherSurface(): void
}

type EditorState = 'loading' | 'review' | 'ready' | 'error'
type Interaction = {
  mode: 'move' | 'resize' | 'rotate'
  pointerId: number
  startX: number
  startY: number
  startPlacement: SurfacePlacement
  centerX: number
  centerY: number
  startDistance: number
  startAngle: number
}

const DEFAULT_PLACEMENT: SurfacePlacement = { x: 0.5, y: 0.5, scale: 1, rotation: 0 }

function sourceIdentity(source: ImageSource, explicit?: string) {
  return explicit || source.id || source.src
}

function containedRect(rect: DOMRect, aspect: number) {
  const containerAspect = rect.width / Math.max(1, rect.height)
  if (containerAspect > aspect) {
    const width = rect.height * aspect
    return { left: rect.left + (rect.width - width) / 2, top: rect.top, width, height: rect.height }
  }
  const height = rect.width / Math.max(0.01, aspect)
  return { left: rect.left, top: rect.top + (rect.height - height) / 2, width: rect.width, height }
}

function normalizedPoint(event: { clientX: number; clientY: number }, rect: DOMRect, aspect: number): SurfacePoint | null {
  const content = containedRect(rect, aspect)
  if (event.clientX < content.left || event.clientX > content.left + content.width
    || event.clientY < content.top || event.clientY > content.top + content.height) return null
  return {
    x: Math.max(0, Math.min(1, (event.clientX - content.left) / Math.max(1, content.width))),
    y: Math.max(0, Math.min(1, (event.clientY - content.top) / Math.max(1, content.height))),
  }
}

function candidateSelection(
  analysis: SurfaceAnalysisResult,
  candidate: SurfaceCandidate,
  point: SurfacePoint,
  negativePoints: SurfacePoint[],
): SurfaceSelection {
  return {
    version: 1,
    sourceKey: analysis.sourceKey,
    model: analysis.model,
    candidateId: candidate.id,
    point,
    ...(negativePoints.length ? { negativePoints: negativePoints.map((item) => ({ ...item })) } : {}),
    ...(candidate.maskRef ? { maskRef: candidate.maskRef } : {}),
  }
}

function wholeImageSelection(analysis: SurfaceAnalysisResult, point: SurfacePoint): SurfaceSelection {
  return {
    version: 1,
    sourceKey: analysis.sourceKey,
    model: analysis.model,
    candidateId: 'whole-image-surface',
    point,
  }
}

export const SurfaceMockupEditor = forwardRef<SurfaceMockupEditorHandle, SurfaceMockupEditorProps>(function SurfaceMockupEditor(
  props,
  ref,
) {
  const {
    base,
    design = null,
    depth: providedDepth,
    surfaceMask: providedMask,
    provider,
    sourceKey: requestedSourceKey,
    initialPoint = { x: 0.5, y: 0.5 },
    surfaceMode = 'whole',
    locale = 'en',
    negativePoints = [],
    selection = null,
    placement,
    defaultPlacement = DEFAULT_PLACEMENT,
    onPlacementChange,
    onInteractionEnd,
    onSurfaceSelectionChange,
    className,
    style,
  } = props
  const copy = SURFACE_EDITOR_COPY[locale]
  const stableSourceKey = sourceIdentity(base, requestedSourceKey)
  const negativePointsKey = JSON.stringify(negativePoints)
  const [internalPlacement, setInternalPlacement] = useState<SurfacePlacement>(() => clampPlacement(placement ?? defaultPlacement))
  const value = clampPlacement(placement ?? internalPlacement)
  const placementRef = useRef(value)
  placementRef.current = value
  const [state, setState] = useState<EditorState>('loading')
  const [analysis, setAnalysis] = useState<SurfaceAnalysisResult | null>(null)
  const [candidateIndex, setCandidateIndex] = useState(0)
  const [activeMask, setActiveMask] = useState<SurfaceMask | null>(providedMask ?? null)
  const [activeDepth, setActiveDepth] = useState<MockupDepth | null>(providedDepth ?? null)
  const [confirmed, setConfirmed] = useState(Boolean(selection))
  const [error, setError] = useState<string | null>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [renderRevision, setRenderRevision] = useState(0)
  const [sourceAspect, setSourceAspect] = useState(() => (base.width && base.height ? base.width / base.height : 4 / 3))
  const hostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<MockupRenderer | null>(null)
  const interactionRef = useRef<Interaction | null>(null)
  const transientAnalysisRef = useRef<AbortController | null>(null)
  const analysisAttempt = useRef(0)
  const currentPoint = useRef<SurfacePoint>(selection?.point ?? initialPoint)
  const negativePointsRef = useRef<SurfacePoint[]>(selection?.negativePoints ?? negativePoints)

  useEffect(() => () => {
    transientAnalysisRef.current?.abort()
  }, [])

  useEffect(() => {
    if (!stageRef.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) setViewport({ width: rect.width, height: rect.height })
    })
    observer.observe(stageRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setSourceAspect(base.width && base.height ? base.width / base.height : 4 / 3)
  }, [base.height, base.src, base.width])

  // Analysis is keyed by the source only. Changing placement or design never
  // calls the provider again; this is the important interaction invariant.
  useEffect(() => {
    const controller = new AbortController()
    const attempt = analysisAttempt.current
    setState('loading')
    setError(null)
    setAnalysis(null)
    setCandidateIndex(0)
      setConfirmed(surfaceMode === 'whole' || Boolean(selection))
    setActiveMask(providedMask ?? null)
    setActiveDepth(providedDepth ?? null)
    const run = async () => {
      let result: SurfaceAnalysisResult
      if (providedDepth && providedMask) {
        result = {
          version: 1,
          sourceKey: stableSourceKey,
          model: 'precomputed',
          depth: providedDepth,
          candidates: [{ id: 'precomputed-surface', score: 1, mask: providedMask, maskRef: 'precomputed' }],
        }
      } else if (provider) {
        result = await provider.analyze({
          sourceKey: stableSourceKey,
          base,
          point: currentPoint.current,
          ...(negativePointsRef.current.length ? { negativePoints: negativePointsRef.current } : {}),
        }, controller.signal)
      } else {
        throw new Error('Provide depth + surfaceMask, or a SurfaceProvider')
      }
      controller.signal.throwIfAborted()
      if (attempt !== analysisAttempt.current) return
      if (result.version !== 1 || result.sourceKey !== stableSourceKey || !result.candidates.length) {
        throw new Error('Surface analysis returned an invalid result')
      }
      const selected = selection?.sourceKey === stableSourceKey
        ? surfaceMode === 'whole'
          ? (selection.candidateId === 'whole-image-surface' ? result.candidates[0] : undefined)
          : result.candidates.find((candidate) => candidate.id === selection.candidateId)
        : undefined
      const chosen = selected ?? result.candidates[0]
      setAnalysis(result)
      setActiveDepth(result.depth)
      // The default mode is one continuous full-image field. SAM candidates
      // remain available only to the explicit candidate-review mode; they do
      // not clip the default renderer, so every image position is draggable.
      const chosenMask = surfaceMode === 'whole'
        ? null
        : providedDepth && providedMask ? providedMask : chosen.mask
      setActiveMask(chosenMask)
      if (surfaceMode === 'whole') {
        setState('ready')
        setConfirmed(true)
        if (!selected) onSurfaceSelectionChange?.(wholeImageSelection(result, currentPoint.current))
      } else if (selected) {
        setCandidateIndex(result.candidates.indexOf(selected))
        setState('ready')
        setConfirmed(true)
      } else {
        setState('review')
        setConfirmed(false)
      }
    }
    void run().catch((cause: unknown) => {
      if (controller.signal.aborted || attempt !== analysisAttempt.current) return
      setState('error')
      setError(cause instanceof Error ? cause.message : 'Surface analysis failed')
    })
    return () => controller.abort()
    // `base` and provider identity are intentionally the analysis boundary;
    // placement, design, and callbacks must not invalidate analysis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableSourceKey, provider, providedDepth, providedMask, negativePointsKey, surfaceMode])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || state !== 'ready' || !confirmed || !activeDepth) return
    const controller = new AbortController()
    let cancelled = false
    const replaceRenderer = async () => {
      const [baseImage, designImage] = await Promise.all([
        loadImage(base, controller.signal),
        design ? loadImage(design, controller.signal) : Promise.resolve(null),
      ])
      controller.signal.throwIfAborted()
      if (cancelled) return
      rendererRef.current?.dispose()
      const renderer = createMockupRenderer(canvas, baseImage, designImage, activeDepth,
        activeMask ?? undefined, activeMask ? currentPoint.current : undefined)
      rendererRef.current = renderer
      const outside = value.x < 0 || value.x > 1 || value.y < 0 || value.y > 1
      renderer.render(outside ? { ...value, scale: 0 } : value)
      setRenderRevision((revision) => revision + 1)
    }
    void replaceRenderer().catch((cause: unknown) => {
      if (!cancelled && !controller.signal.aborted) {
        setState('error')
        setError(cause instanceof Error ? cause.message : 'Unable to create WebGL renderer')
      }
    })
    return () => {
      cancelled = true
      controller.abort()
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
    // Placement is rendered by the separate effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base.src, design?.src, state, confirmed, activeDepth, activeMask])

  useEffect(() => {
    const outside = value.x < 0 || value.x > 1 || value.y < 0 || value.y > 1
    rendererRef.current?.render(outside ? { ...value, scale: 0 } : value)
  }, [value.x, value.y, value.scale, value.rotation, renderRevision])

  const changePlacement = useCallback((next: SurfacePlacement) => {
    const normalized = clampPlacement(next)
    placementRef.current = normalized
    setInternalPlacement(normalized)
    onPlacementChange?.(normalized)
  }, [onPlacementChange])

  const confirmCandidate = useCallback(() => {
    if (!analysis) return
    const candidate = analysis.candidates[candidateIndex]
    if (!candidate) return
    const nextSelection = candidateSelection(analysis, candidate, currentPoint.current, negativePointsRef.current)
    setActiveMask(candidate.mask)
    setActiveDepth(analysis.depth)
    setConfirmed(true)
    setState('ready')
    onSurfaceSelectionChange?.(nextSelection)
  }, [analysis, candidateIndex, onSurfaceSelectionChange])

  const retry = useCallback(() => {
    analysisAttempt.current += 1
    setState('loading')
    setError(null)
    setRenderRevision((revision) => revision + 1)
    // Changing the attempt by replacing the provider effect's source key would
    // make placement a dependency. Calling the same provider here is explicit.
    transientAnalysisRef.current?.abort()
    const controller = new AbortController()
    transientAnalysisRef.current = controller
    if (!provider) {
      if (analysis && activeDepth && (surfaceMode === 'whole' || activeMask)) setState(confirmed ? 'ready' : 'review')
      else setState('error')
      return
    }
    void provider.analyze({
      sourceKey: stableSourceKey,
      base,
      point: currentPoint.current,
      ...(negativePointsRef.current.length ? { negativePoints: negativePointsRef.current } : {}),
    }, controller.signal)
      .then((result) => {
        if (result.version !== 1 || !result.candidates.length) throw new Error('Surface analysis returned an invalid result')
        setAnalysis(result)
        setCandidateIndex(0)
        setActiveDepth(result.depth)
        const chosen = result.candidates[0]
        setActiveMask(chosen.mask)
        if (surfaceMode === 'whole') {
          setActiveMask(null)
          setConfirmed(true)
          setState('ready')
          onSurfaceSelectionChange?.(wholeImageSelection(result, currentPoint.current))
        } else {
          setConfirmed(false)
          setState('review')
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Surface analysis failed')
          setState('error')
        }
      })
      .finally(() => {
        if (transientAnalysisRef.current === controller) transientAnalysisRef.current = null
      })
  }, [activeDepth, activeMask, analysis, base, confirmed, onSurfaceSelectionChange, provider, stableSourceKey, surfaceMode])

  const chooseAnotherSurface = useCallback(() => {
    if (surfaceMode === 'whole') return
    setConfirmed(false)
    setState('review')
    onSurfaceSelectionChange?.(null)
  }, [onSurfaceSelectionChange, surfaceMode])

  const resetPlacement = useCallback(() => changePlacement(defaultPlacement), [changePlacement, defaultPlacement])

  useImperativeHandle(ref, () => ({
    exportPng: async () => {
      const renderer = rendererRef.current
      if (!renderer) throw new Error('The mockup renderer is not ready')
      renderer.render(value)
      return renderer.exportPng()
    },
    resetPlacement,
    chooseAnotherSurface,
  }), [chooseAnotherSurface, resetPlacement, value])

  const startInteraction = (event: ReactPointerEvent<HTMLElement>, mode: Interaction['mode']) => {
    if ((event.button !== undefined && event.button !== 0) || state !== 'ready' || !confirmed) return
    event.preventDefault()
    event.stopPropagation()
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const content = containedRect(rect, sourceAspect)
    const centerX = content.left + content.width * value.x
    const centerY = content.top + content.height * value.y
    const startDistance = Math.max(1, Math.hypot(event.clientX - centerX, event.clientY - centerY))
    interactionRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPlacement: value,
      centerX,
      centerY,
      startDistance,
      startAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX),
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const interaction = interactionRef.current
      const canvas = canvasRef.current
      if (!interaction || interaction.pointerId !== event.pointerId || !canvas) return
      const rect = canvas.getBoundingClientRect()
      const content = containedRect(rect, sourceAspect)
      const dx = (event.clientX - interaction.startX) / Math.max(1, content.width)
      const dy = (event.clientY - interaction.startY) / Math.max(1, content.height)
      const initial = interaction.startPlacement
      if (interaction.mode === 'move') {
        changePlacement({ ...initial, x: initial.x + dx, y: initial.y + dy })
      } else if (interaction.mode === 'resize') {
        const distance = Math.max(1, Math.hypot(event.clientX - interaction.centerX, event.clientY - interaction.centerY))
        changePlacement({ ...initial, scale: initial.scale * distance / interaction.startDistance })
      } else {
        let delta = Math.atan2(event.clientY - interaction.centerY, event.clientX - interaction.centerX) - interaction.startAngle
        while (delta > Math.PI) delta -= Math.PI * 2
        while (delta < -Math.PI) delta += Math.PI * 2
        changePlacement({ ...initial, rotation: initial.rotation + delta * 180 / Math.PI })
      }
    }
    const end = (event: PointerEvent) => {
      const interaction = interactionRef.current
      const canvas = canvasRef.current
      if (!interaction || interaction.pointerId !== event.pointerId) return
      interactionRef.current = null
      if (!canvas) return
      onInteractionEnd?.({
        kind: interaction.mode,
        placement: placementRef.current,
        point: normalizedPoint(event, canvas.getBoundingClientRect(), sourceAspect) ?? { x: value.x, y: value.y },
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [changePlacement, onInteractionEnd, sourceAspect, value.x, value.y])

  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (surfaceMode === 'candidate' && state === 'review' && provider) {
      const rect = event.currentTarget.getBoundingClientRect()
      const point = normalizedPoint(event, rect, sourceAspect)
      if (!point) return
      if (event.altKey || event.metaKey) {
        negativePointsRef.current = [...negativePointsRef.current, point].slice(-8)
      } else {
        currentPoint.current = point
        negativePointsRef.current = []
      }
      analysisAttempt.current += 1
      setState('loading')
      transientAnalysisRef.current?.abort()
      const controller = new AbortController()
      transientAnalysisRef.current = controller
      void provider.analyze({
        sourceKey: stableSourceKey,
        base,
        point: currentPoint.current,
        ...(negativePointsRef.current.length ? { negativePoints: negativePointsRef.current } : {}),
      }, controller.signal)
        .then((result) => {
          if (result.version !== 1 || result.sourceKey !== stableSourceKey || !result.candidates.length) throw new Error('Surface analysis returned an invalid result')
          setAnalysis(result)
          setCandidateIndex(0)
          setActiveDepth(result.depth)
          setActiveMask(result.candidates[0]?.mask ?? null)
          setState('review')
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) {
            setError(cause instanceof Error ? cause.message : 'Surface analysis failed')
            setState('error')
          }
        })
        .finally(() => {
          if (transientAnalysisRef.current === controller) transientAnalysisRef.current = null
        })
      return
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.currentTarget.focus({ preventScroll: true })
    startInteraction(event, 'move')
  }

  const onCanvasKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (state !== 'ready' || !confirmed) return
    const step = event.shiftKey ? 0.05 : 0.01
    if (event.key === 'ArrowLeft') changePlacement({ ...value, x: value.x - step })
    else if (event.key === 'ArrowRight') changePlacement({ ...value, x: value.x + step })
    else if (event.key === 'ArrowUp') changePlacement({ ...value, y: value.y - step })
    else if (event.key === 'ArrowDown') changePlacement({ ...value, y: value.y + step })
    else if (event.key === '+' || event.key === '=') changePlacement({ ...value, scale: value.scale + 0.05 })
    else if (event.key === '-' || event.key === '_') changePlacement({ ...value, scale: value.scale - 0.05 })
    else return
    event.preventDefault()
  }

  const designAspect = useMemo(() => {
    const width = design?.width ?? 1
    const height = design?.height ?? 1
    return height / Math.max(1, width)
  }, [design?.height, design?.width])
  const content = containedRect(new DOMRect(0, 0, viewport.width || 360, viewport.height || 220), sourceAspect)
  const boxWidth = content.width * 0.4 * value.scale
  const boxHeight = boxWidth * designAspect / Math.max(0.01, sourceAspect)
  const boxStyle: CSSProperties = {
    left: `${content.left + value.x * content.width}px`,
    top: `${content.top + value.y * content.height}px`,
    width: `${Math.max(24, boxWidth)}px`,
    height: `${Math.max(24, boxHeight)}px`,
    transform: `translate(-50%, -50%) rotate(${value.rotation}deg)`,
  }
  const placementOutside = value.x < 0 || value.x > 1 || value.y < 0 || value.y > 1

  return (
    <div ref={hostRef} className={`surface-mockup-editor ${className ?? ''}`} style={style}>
      <div ref={stageRef} className="surface-mockup-stage">
        <img className="surface-mockup-base" src={base.src} alt={base.alt ?? 'Mockup source'} draggable={false}
          onLoad={(event) => {
            const image = event.currentTarget
            if (image.naturalWidth && image.naturalHeight) setSourceAspect(image.naturalWidth / image.naturalHeight)
          }} />
        <canvas
          ref={canvasRef}
          className="surface-mockup-canvas"
          data-testid="mockup-placement-canvas"
          data-surface-state={state}
          role="img"
          aria-label={copy.preview}
          tabIndex={0}
          onPointerDown={onCanvasPointerDown}
          onKeyDown={onCanvasKeyDown}
          onContextMenu={(event) => event.preventDefault()}
        />
        {state === 'ready' && confirmed ? (
          <div className="surface-mockup-controls" data-testid="mockup-placement-controls" aria-label={copy.controls}>
            <div className="surface-mockup-placement-box" data-testid="mockup-placement-box" style={boxStyle}
              onPointerDown={(event) => startInteraction(event, 'move')}>
              {placementOutside && design ? <img className="surface-mockup-outside-preview" src={design.src}
                alt="" aria-hidden draggable={false} /> : null}
              <span className="surface-mockup-handle surface-mockup-handle-nw" data-mockup-placement-handle="nw"
                onPointerDown={(event) => startInteraction(event, 'resize')} />
              <span className="surface-mockup-handle surface-mockup-handle-ne" data-mockup-placement-handle="ne"
                onPointerDown={(event) => startInteraction(event, 'resize')} />
              <span className="surface-mockup-handle surface-mockup-handle-sw" data-mockup-placement-handle="sw"
                onPointerDown={(event) => startInteraction(event, 'resize')} />
              <span className="surface-mockup-handle surface-mockup-handle-se" data-mockup-placement-handle="se"
                onPointerDown={(event) => startInteraction(event, 'resize')} />
              <span className="surface-mockup-rotate-stem" />
              <span className="surface-mockup-handle surface-mockup-handle-rotate" data-mockup-placement-handle="rotate"
                onPointerDown={(event) => startInteraction(event, 'rotate')} />
            </div>
          </div>
        ) : null}
        {state === 'loading' ? <div className="surface-mockup-status" data-testid="mockup-loading-overlay" aria-busy="true"><span role="status">{copy.loading}</span></div> : null}
        {state === 'error' ? <div className="surface-mockup-status surface-mockup-error" role="alert"><span>{error ?? copy.error}</span><button type="button" onClick={retry}>{copy.retry}</button></div> : null}
        {surfaceMode === 'candidate' && state === 'review' && analysis ? (
          <div className="surface-mockup-review" aria-label={copy.reviewLabel}>
            <div className="surface-mockup-review-copy"><strong>{copy.reviewTitle}</strong><span>{copy.reviewHint}</span></div>
            <div className="surface-mockup-candidates">
              {analysis.candidates.map((candidate, index) => <button type="button" key={candidate.id}
                className={index === candidateIndex ? 'is-selected' : ''} onClick={() => { setCandidateIndex(index); setActiveMask(candidate.mask) }}>
                {candidate.id} <small>{Math.round(candidate.score * 100)}%</small>
              </button>)}
            </div>
            <button type="button" className="surface-mockup-confirm" onClick={confirmCandidate}>{copy.confirm}</button>
          </div>
        ) : null}
      </div>
      {state === 'ready' && confirmed ? <div className="surface-mockup-toolbar">
        <span>{copy.toolbar}</span>
        <button type="button" onClick={resetPlacement}>{copy.reset}</button>
        {surfaceMode === 'candidate' ? <button type="button" onClick={chooseAnotherSurface}>{copy.chooseAnother}</button> : null}
      </div> : null}
    </div>
  )
})
