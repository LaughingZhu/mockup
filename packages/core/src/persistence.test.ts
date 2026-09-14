import { describe, expect, it } from 'vitest'
import { deserializeMockupState, persistenceKey, serializeMockupState } from './persistence'

const state = {
  sourceRef: 'photo-1',
  designRef: 'art-1',
  selection: {
    version: 1 as const,
    sourceKey: 'photo-1',
    model: 'fixture-model',
    candidateId: 'cup',
    point: { x: 0.5, y: 0.4 },
    maskRef: 'mask/cup',
  },
  placement: { x: 0.52, y: 0.48, scale: 1.2, rotation: 12 },
}

describe('versioned persistence', () => {
  it('serializes only stable references and parameters', () => {
    const raw = serializeMockupState(state)
    expect(raw).toContain('photo-1')
    expect(raw).toContain('mask/cup')
    expect(raw).not.toContain('Uint8Array')
    expect(raw).not.toContain('temporary')
    expect(deserializeMockupState(raw)).toEqual({ version: 1, ...state })
  })

  it('rejects old, malformed, and pixel-bearing state', () => {
    expect(deserializeMockupState(JSON.stringify({ version: 0, ...state }))).toBeNull()
    expect(deserializeMockupState(JSON.stringify({ version: 1, sourceRef: '', placement: state.placement, selection: null }))).toBeNull()
    expect(deserializeMockupState(JSON.stringify({ version: 1, sourceRef: 'x', placement: state.placement, selection: { ...state.selection, mask: [255, 0] } }))).toBeNull()
    expect(persistenceKey('my project')).toBe('visible-surface-mockup:v1:my%20project')
  })
})
