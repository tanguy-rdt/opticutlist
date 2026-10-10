import { describe, expect, it } from 'vitest'

import type { GrainDirection, RotationPolicy } from '../../model/orientation'
import { getAllowedOrientations, getOrientedDimensions } from '../part-orientation'

describe('getAllowedOrientations', () => {
  it.each<[GrainDirection, RotationPolicy, GrainDirection, string[]]>([
    // No grain on either side: only the rotation policy matters.
    ['none', 'allowed', 'none', ['normal', 'rotated']],
    ['none', 'forbidden', 'none', ['normal']],
    ['none', 'allowed', 'length', ['normal', 'rotated']],
    ['none', 'forbidden', 'width', ['normal']],
    ['length', 'allowed', 'none', ['normal', 'rotated']],
    ['width', 'forbidden', 'none', ['normal']],
    // Both have grain, rotation allowed: exactly one orientation aligns the grain.
    ['length', 'allowed', 'length', ['normal']],
    ['length', 'allowed', 'width', ['rotated']],
    ['width', 'allowed', 'length', ['rotated']],
    ['width', 'allowed', 'width', ['normal']],
    // Both have grain, rotation forbidden: aligned or conflicting.
    ['length', 'forbidden', 'length', ['normal']],
    ['width', 'forbidden', 'width', ['normal']],
    ['length', 'forbidden', 'width', []],
    ['width', 'forbidden', 'length', []],
  ])('part grain %s, rotation %s, panel grain %s → %o', (grainDirection, rotation, panelGrain, expected) => {
    expect(getAllowedOrientations({ grainDirection, rotation }, panelGrain)).toEqual(expected)
  })

  it('always lists normal before rotated', () => {
    expect(getAllowedOrientations({ grainDirection: 'none', rotation: 'allowed' }, 'none')[0]).toBe('normal')
  })
})

describe('getOrientedDimensions', () => {
  const part = { lengthMm: 720, widthMm: 560, thicknessMm: 18 }

  it('keeps dimensions in normal orientation', () => {
    expect(getOrientedDimensions(part, 'normal')).toEqual(part)
  })

  it('swaps length and width but preserves thickness when rotated', () => {
    expect(getOrientedDimensions(part, 'rotated')).toEqual({ lengthMm: 560, widthMm: 720, thicknessMm: 18 })
  })

  it('does not mutate the input', () => {
    getOrientedDimensions(part, 'rotated')

    expect(part).toEqual({ lengthMm: 720, widthMm: 560, thicknessMm: 18 })
  })
})
