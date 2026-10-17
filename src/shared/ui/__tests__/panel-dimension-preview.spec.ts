import { describe, expect, it } from 'vitest'
import { fitPanelDimensionPreview, previewGrainIllustration } from '@/ui/canvas/panel-dimension-preview'

describe('technical preview layout', () => {
  for (const size of ['small', 'default'] as const) {
    it.each([[400, 400], [800, 400], [100, 900], [10000, 1], [1, 10000], [0.001, 1000], [1000, 0.001]])(`fits complete annotations at ${size} size for %s × %s`, (length, width) => {
      const drawing = fitPanelDimensionPreview(length, width, size)
      const { panel, bounds, translation } = drawing
      expect(panel.width / panel.height).toBeCloseTo(length / width, 5)
      expect(bounds.left + translation.x).toBeGreaterThanOrEqual(10)
      expect(bounds.right + translation.x).toBeLessThanOrEqual(drawing.width - 10)
      expect(bounds.top + translation.y).toBeGreaterThanOrEqual(10)
      expect(bounds.bottom + translation.y).toBeLessThanOrEqual(drawing.height - 10)
      expect((bounds.left + bounds.right) / 2 + translation.x).toBeCloseTo(drawing.width / 2)
      expect((bounds.top + bounds.bottom) / 2 + translation.y).toBeCloseTo(drawing.height / 2)
      expect(drawing.horizontalLabel.y - drawing.fontSize / 2).toBeGreaterThan(drawing.horizontal.start.y)
      expect(drawing.verticalLabel.x + drawing.fontSize / 2).toBeLessThan(drawing.vertical.start.x)
    })
  }
  it('aligns extensions with physical edges and uses equal dimension offsets', () => {
    const drawing = fitPanelDimensionPreview(800, 400)
    expect(drawing.extensions.map(line => line.start)).toEqual([
      { x: drawing.panel.x, y: drawing.panel.y + drawing.panel.height + 3 },
      { x: drawing.panel.x + drawing.panel.width, y: drawing.panel.y + drawing.panel.height + 3 },
      { x: drawing.panel.x - 3, y: drawing.panel.y },
      { x: drawing.panel.x - 3, y: drawing.panel.y + drawing.panel.height },
    ])
    expect(drawing.horizontal.start.y - drawing.panel.y - drawing.panel.height).toBeCloseTo(16)
    expect(drawing.panel.x - drawing.vertical.start.x).toBe(16)
    expect(drawing.horizontalArrows).toHaveLength(2)
    expect(drawing.verticalArrows).toHaveLength(2)
  })
  it('uses outside arrows for tiny spans without enlarging the panel', () => {
    const portrait = fitPanelDimensionPreview(1, 10000)
    const landscape = fitPanelDimensionPreview(10000, 1)
    expect(portrait.horizontalOutside).toBe(true)
    expect(landscape.verticalOutside).toBe(true)
    expect(portrait.horizontal.start.x).toBe(portrait.panel.x - 10)
    expect(landscape.vertical.start.y).toBe(landscape.panel.y - 10)
  })
  it.each([0, -1, NaN, Infinity, 0.0001, Number.MAX_VALUE])('rejects unsupported dimension %s', value => {
    expect(() => fitPanelDimensionPreview(value, 100)).toThrow(RangeError)
    expect(() => fitPanelDimensionPreview(100, value)).toThrow(RangeError)
  })
  it('only shows meaningful grain and follows the physical axes', () => {
    const { panel } = fitPanelDimensionPreview(800, 400)
    expect(previewGrainIllustration(panel, 'none')).toBeNull()
    expect(previewGrainIllustration(panel, 'length')?.transform).toBe(`scale(${String(panel.width / 1000)} ${String(panel.height / 400)})`)
    expect(previewGrainIllustration(panel, 'width')?.transform).toBe(`rotate(90) scale(${String(panel.height / 1000)} ${String(panel.width / 400)})`)
    expect(previewGrainIllustration(panel, 'width')).toEqual(previewGrainIllustration(panel, 'width'))
    expect(previewGrainIllustration({ width: 1, height: 100 }, 'width')).toBeNull()
  })
})
