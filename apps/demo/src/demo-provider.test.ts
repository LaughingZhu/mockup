import { describe, expect, it } from 'vitest'
import { createBundledProvider, DEMO_DEPTH_MODEL, DEMO_SURFACE_MODEL } from './demo-provider'

describe('bundled model fixture', () => {
  it('keeps the two model roles fixed for the default sample', async () => {
    const result = await createBundledProvider().analyze({
      sourceKey: 'sample-cup',
      base: { id: 'sample-cup', src: '/cup.svg' },
      point: { x: 0.5, y: 0.5 },
    }, new AbortController().signal)

    expect(result.model).toBe(DEMO_DEPTH_MODEL + ' + ' + DEMO_SURFACE_MODEL)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.id).toBe('cup-body')
  })
})
