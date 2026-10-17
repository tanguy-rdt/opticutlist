import { describe, expect, it } from 'vitest'
import { copyLabel } from '@/ui/canvas/copy-label'

describe('stable cutting copy labels', () => {
  it('shows ordinals only for repeated demand, independent of placement order', () => {
    expect(copyLabel({ name: 'Shelf', quantity: 1 }, 0)).toBe('Shelf')
    const part = { name: 'Side', quantity: 4 }
    expect([2, 0, 3, 1].map(index => copyLabel(part, index))).toEqual(['Side · 3/4', 'Side · 1/4', 'Side · 4/4', 'Side · 2/4'])
    expect(part).toEqual({ name: 'Side', quantity: 4 })
  })
})
