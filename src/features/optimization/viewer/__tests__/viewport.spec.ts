import { describe, expect, it } from 'vitest'
import { fitViewport, grainPoints, panelGrainPoints, labelLayout, panViewport, rectToCanvas, zoomViewport } from '../viewport'
describe('Millimeter-to-canvas transforms', () => {
  it('uses one scale and translation for every panel, part, margin and kerf region', () => {
    expect(rectToCanvas({ xMm: 5, yMm: 5, lengthMm: 30, widthMm: 50 }, { scale: 2, x: 10, y: 20 })).toEqual({ x: 20, y: 30, width: 60, height: 100 })
    expect(rectToCanvas({ xMm: 35, yMm: 5, lengthMm: 2, widthMm: 70 }, { scale: 2, x: 10, y: 20 })).toEqual({ x: 80, y: 30, width: 4, height: 140 })
    expect(rectToCanvas({ xMm: 0.1001, yMm: 0, lengthMm: 0, widthMm: 1 }, { scale: 10, x: 0, y: 0 })).toEqual({ x: 1, y: 0, width: 0, height: 10 })
  })
  it('fits the complete panel with padding and preserves aspect ratio', () => {
    expect(fitViewport({ lengthMm: 100, widthMm: 80 }, { width: 248, height: 248 })).toEqual({ scale: 2, x: 24, y: 44 })
    expect(fitViewport({ lengthMm: 80, widthMm: 100 }, { width: 248, height: 248 })).toEqual({ scale: 2, x: 44, y: 24 })
  })
  it('zooms around a stationary anchor and respects relative limits', () => {
    const view = { scale: 2, x: 24, y: 44 }
    expect(zoomViewport(view, 2, { x: 124, y: 124 }, 0.5, 8)).toEqual({ scale: 4, x: -76, y: -36 })
    expect(zoomViewport(view, 100, { x: 124, y: 124 }, 0.5, 8).scale).toBe(8)
    expect(zoomViewport(view, 0.01, { x: 124, y: 124 }, 0.5, 8).scale).toBe(0.5)
    expect(panViewport(view, { x: 40, y: -40 })).toEqual({ scale: 2, x: 64, y: 4 })
    expect(view).toEqual({ scale: 2, x: 24, y: 44 })
  })
  it('keeps labels readable only when they have sufficient screen space', () => {
    const rect = { x: 5, y: 5, width: 30, height: 50 }
    expect(labelLayout(rect, 1).visible).toBe(false)
    expect(labelLayout(rect, 4)).toEqual({ x: 6.5, y: 6.5, width: 27, height: 47, fontSize: 3.25, visible: true })
  })
  it('draws grain arrows along the resolved panel axes and omits absent grain', () => {
    const rect = { x: 0, y: 0, width: 100, height: 100 }
    expect(grainPoints(rect, 'length')).toEqual([20, 80, 80, 80])
    expect(grainPoints(rect, 'width')).toEqual([80, 20, 80, 80])
    expect(grainPoints(rect, 'none')).toEqual([])
  })
  it('keeps a panel grain marker within the fit padding on the correct axis', () => {
    const rect = { x: 0, y: 0, width: 100, height: 80 }
    expect(panelGrainPoints(rect, 'length', 2)).toEqual([42.5, -5, 57.5, -5])
    expect(panelGrainPoints(rect, 'width', 2)).toEqual([-5, 32.5, -5, 47.5])
    expect(panelGrainPoints(rect, 'none', 2)).toEqual([])
  })
  it('rejects invalid input rather than producing non-finite geometry', () => {
    expect(() => fitViewport({ lengthMm: 0, widthMm: 80 }, { width: 200, height: 200 })).toThrow(RangeError)
    expect(() => fitViewport({ lengthMm: 100, widthMm: 80 }, { width: 20, height: 20 })).toThrow(RangeError)
    expect(() => zoomViewport({ scale: 1, x: 0, y: 0 }, Infinity, { x: 0, y: 0 }, 1, 10)).toThrow(RangeError)
    expect(() => rectToCanvas({ xMm: -1, yMm: 0, lengthMm: 1, widthMm: 1 }, { scale: 1, x: 0, y: 0 })).toThrow(RangeError)
    expect(() => panViewport({ scale: 0, x: 0, y: 0 }, { x: 1, y: 1 })).toThrow(RangeError)
  })
})
