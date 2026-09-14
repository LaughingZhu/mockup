import type { MockupState, PersistedMockupState, SurfacePlacement, SurfaceSelection } from './types'

export const PERSISTENCE_VERSION = 1 as const
export const PERSISTENCE_PREFIX = 'visible-surface-mockup:v1:'

function point(value: unknown): value is { x: number; y: number } {
  return Boolean(value && typeof value === 'object'
    && Number.isFinite((value as { x?: unknown }).x)
    && Number.isFinite((value as { y?: unknown }).y)
    && (value as { x: number }).x >= 0 && (value as { x: number }).x <= 1
    && (value as { y: number }).y >= 0 && (value as { y: number }).y <= 1)
}

function placement(value: unknown): value is SurfacePlacement {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SurfacePlacement>
  return Object.values(candidate).every((entry) => typeof entry === 'number' && Number.isFinite(entry))
    && candidate.x! >= 0 && candidate.x! <= 1 && candidate.y! >= 0 && candidate.y! <= 1
    && candidate.scale! >= 0.05 && candidate.scale! <= 4
}

function selection(value: unknown): value is SurfaceSelection {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SurfaceSelection>
  return candidate.version === 1 && typeof candidate.sourceKey === 'string' && candidate.sourceKey.length > 0
    && typeof candidate.model === 'string' && candidate.model.length > 0
    && typeof candidate.candidateId === 'string' && candidate.candidateId.length > 0
    && point(candidate.point)
    && !('mask' in candidate)
    && (candidate.maskRef === undefined || typeof candidate.maskRef === 'string')
    && (candidate.negativePoints === undefined
      || (Array.isArray(candidate.negativePoints) && candidate.negativePoints.length <= 8
        && candidate.negativePoints.every(point)))
}

function safeState(state: MockupState): PersistedMockupState {
  if (typeof state.sourceRef !== 'string' || !state.sourceRef.trim()) throw new Error('Invalid source reference')
  if (state.designRef !== undefined && typeof state.designRef !== 'string') throw new Error('Invalid design reference')
  if (!placement(state.placement)) throw new Error('Invalid placement')
  if (state.selection !== null && !selection(state.selection)) throw new Error('Invalid selection')
  return {
    version: PERSISTENCE_VERSION,
    sourceRef: state.sourceRef,
    ...(state.designRef ? { designRef: state.designRef } : {}),
    selection: state.selection
      ? {
          version: 1,
          sourceKey: state.selection.sourceKey,
          model: state.selection.model,
          candidateId: state.selection.candidateId,
          point: { ...state.selection.point },
          ...(state.selection.maskRef ? { maskRef: state.selection.maskRef } : {}),
          ...(state.selection.negativePoints?.length
            ? { negativePoints: state.selection.negativePoints.map((item) => ({ ...item })) }
            : {}),
        }
      : null,
    placement: { ...state.placement },
  }
}

/** Serialize references and parameters only; image pixels and temporary URLs are excluded. */
export function serializeMockupState(state: MockupState) {
  return JSON.stringify(safeState(state))
}

export function deserializeMockupState(raw: string | null | undefined): PersistedMockupState | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) return null
    const candidate = value as Partial<PersistedMockupState>
    if (typeof candidate.sourceRef !== 'string' || !placement(candidate.placement)
      || (candidate.selection !== null && !selection(candidate.selection))) return null
    return safeState({
      sourceRef: candidate.sourceRef,
      designRef: candidate.designRef,
      selection: candidate.selection ?? null,
      placement: candidate.placement,
    })
  } catch {
    return null
  }
}

export function persistenceKey(projectRef: string) {
  if (!projectRef.trim()) throw new Error('Project reference is required')
  return `${PERSISTENCE_PREFIX}${encodeURIComponent(projectRef)}`
}

export function saveMockupState(storage: Storage, projectRef: string, state: MockupState) {
  storage.setItem(persistenceKey(projectRef), serializeMockupState(state))
}

export function loadMockupState(storage: Storage, projectRef: string) {
  return deserializeMockupState(storage.getItem(persistenceKey(projectRef)))
}
