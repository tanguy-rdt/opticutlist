import { describe, expect, it } from 'vitest'

import { cuttingSettingsSchema } from '../cutting-settings'
import { without } from './fixtures'

const valid = { kerfMm: 3.2, edgeMarginMm: 10 }

describe('cuttingSettingsSchema', () => {
  it('accepts valid settings', () => {
    expect(cuttingSettingsSchema.parse(valid)).toEqual(valid)
  })

  it('accepts zero kerf and zero margin', () => {
    expect(cuttingSettingsSchema.safeParse({ kerfMm: 0, edgeMarginMm: 0 }).success).toBe(true)
  })

  describe.each(['kerfMm', 'edgeMarginMm'] as const)('%s', (key) => {
    it('is mandatory', () => {
      expect(cuttingSettingsSchema.safeParse(without(valid, key)).success).toBe(false)
    })

    it.each([-0.001, -1, Number.NaN, Number.POSITIVE_INFINITY, '3', null])('rejects %o', (value) => {
      expect(cuttingSettingsSchema.safeParse({ ...valid, [key]: value }).success).toBe(false)
    })
  })

  it('rejects unknown keys', () => {
    expect(cuttingSettingsSchema.safeParse({ ...valid, bladeRpm: 4000 }).success).toBe(false)
  })
})
