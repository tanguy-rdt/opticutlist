import { describe, expect, it } from 'vitest'

import { validateCuttingTree } from '../../cutting-tree/validate-cutting-tree'
import { partSchema, type Part } from '../../model/part'
import { supplierProductSchema } from '../../model/supplier-product'
import { validPartInput, validSupplierProductInput } from '../../model/__tests__/fixtures'
import { optimizePanel, type OptimizePanelSelection, type StrategyCandidate } from '../optimize-panel'
import { planWithStrategy, type OptimizePanelInput } from '../plan-with-strategy'

// 1000 × 600 × 18 birch, grain along length; no kerf or margin unless stated, so areas are easy to verify.
const panel = supplierProductSchema.parse({ ...validSupplierProductInput, lengthMm: 1000, widthMm: 600 })
const noLoss = { kerfMm: 0, edgeMarginMm: 0 }

function parts(sizes: readonly (readonly [number, number, number])[], overrides: Partial<Record<keyof typeof validPartInput, unknown>> = {}): Part[] {
  return sizes.map(([lengthMm, widthMm, quantity], index) =>
    partSchema.parse({ ...validPartInput, id: `part-${String(index)}`, lengthMm, widthMm, quantity, grainDirection: 'none', ...overrides }),
  )
}

function select(input: Partial<OptimizePanelInput> & Pick<OptimizePanelInput, 'parts'>): Extract<OptimizePanelSelection, { ok: true }> {
  const result = optimizePanel({ panel, settings: noLoss, ...input })
  if (!result.ok) {
    throw new Error(`Expected a selection, got ${result.error.kind}`)
  }
  return result
}

/** `[strategy, unplacedCount, usedAreaMm2]` per candidate. */
function summary(comparison: readonly StrategyCandidate[]): unknown[] {
  return comparison.map((candidate) =>
    candidate.status === 'valid'
      ? [candidate.strategy, candidate.metrics.unplacedCount, candidate.metrics.usedAreaMm2]
      : [candidate.strategy, candidate.status],
  )
}

describe('optimizePanel', () => {
  describe('strategy selection', () => {
    it('prefers the strategy that places every part (bestShortSideFit)', () => {
      const result = select({ parts: parts([[300, 400, 2], [300, 500, 2]], { rotation: 'allowed' }) })

      expect(result.strategy).toBe('bestShortSideFit')
      expect(summary(result.comparison)).toEqual([
        ['largestAreaFirst', 1, 420_000],
        ['longestSideFirst', 1, 420_000],
        ['bestShortSideFit', 0, 540_000],
      ])
      expect(result.plan.unplaced).toEqual([])
    })

    it('prefers the strategy that places every part (longestSideFirst)', () => {
      const result = select({ parts: parts([[100, 500, 3], [450, 250, 2]], { rotation: 'forbidden' }) })

      expect(result.strategy).toBe('longestSideFirst')
      expect(summary(result.comparison)).toEqual([
        ['largestAreaFirst', 3, 225_000],
        ['longestSideFirst', 0, 375_000],
        ['bestShortSideFit', 3, 225_000],
      ])
    })

    it('ranks fewer unplaced copies above less waste', () => {
      // longestSideFirst leaves one copy unplaced but uses less area than the others, which leave two.
      const result = select({ parts: parts([[700, 150, 1], [550, 400, 2], [200, 400, 2]], { rotation: 'allowed' }) })

      expect(result.strategy).toBe('longestSideFirst')
      expect(summary(result.comparison)).toEqual([
        ['largestAreaFirst', 2, 520_000],
        ['longestSideFirst', 1, 485_000],
        ['bestShortSideFit', 2, 520_000],
      ])
    })

    it('prefers less waste when every candidate places the same number of parts', () => {
      const result = select({ parts: parts([[400, 250, 3], [550, 400, 1], [600, 450, 2], [400, 250, 1]], { rotation: 'allowed' }) })

      expect(result.strategy).toBe('bestShortSideFit')
      expect(summary(result.comparison)).toEqual([
        ['largestAreaFirst', 5, 490_000],
        ['longestSideFirst', 5, 490_000],
        ['bestShortSideFit', 5, 540_000],
      ])
      expect(result.plan.metrics.wasteAreaMm2).toBe(60_000)
    })

    it('reports comparison metrics for every strategy in a fixed order', () => {
      const result = select({ parts: parts([[400, 300, 2]]) })

      expect(result.comparison.map((candidate) => candidate.strategy)).toEqual(['largestAreaFirst', 'longestSideFirst', 'bestShortSideFit'])
      for (const candidate of result.comparison) {
        expect(candidate).toMatchObject({
          status: 'valid',
          metrics: { placedCount: 2, unplacedCount: 0, usedAreaMm2: 240_000, wasteAreaMm2: 360_000, panelAreaMm2: 600_000, utilizationPercent: 40 },
        })
      }
    })

    it('returns the selected candidate plan unchanged', () => {
      const input = { panel, settings: noLoss, parts: parts([[100, 500, 3], [450, 250, 2]], { rotation: 'forbidden' }) }
      const single = planWithStrategy(input, 'longestSideFirst')

      expect(single.ok).toBe(true)
      expect(single.ok && single.plan).toEqual(select(input).plan)
    })
  })

  describe('tie-breaking', () => {
    it('falls back to the baseline when all candidates are equal', () => {
      expect(select({ parts: [] }).strategy).toBe('largestAreaFirst')
      expect(select({ parts: parts([[1000, 600, 1]]) }).strategy).toBe('largestAreaFirst')
    })

    it('prefers the largest single waste region when count and used area tie', () => {
      const result = select({ parts: parts([[800, 50, 3], [350, 200, 2]], { rotation: 'forbidden' }) })
      const metrics = result.comparison.flatMap((candidate) => (candidate.status === 'valid' ? [candidate.metrics] : []))
      const selected = metrics.find((_metrics, index) => result.comparison[index]?.strategy === result.strategy)

      expect(new Set(metrics.map((m) => `${String(m.unplacedCount)}/${String(m.usedAreaMm2)}`)).size).toBe(1)
      expect(result.strategy).toBe('longestSideFirst')
      expect(selected?.largestWasteRegionMm2).toBe(Math.max(...metrics.map((m) => m.largestWasteRegionMm2)))
      expect(metrics[0]?.largestWasteRegionMm2).toBeLessThan(selected?.largestWasteRegionMm2 ?? 0)
    })

    it('uses strategy order when the largest waste region also ties', () => {
      // A single part produces the same tree for every strategy.
      const result = select({ parts: parts([[600, 300, 1]]) })

      expect(new Set(result.comparison.map((candidate) => JSON.stringify(candidate.status === 'valid' && candidate.metrics))).size).toBe(1)
      expect(result.strategy).toBe('largestAreaFirst')
    })
  })

  describe('bestShortSideFit placement', () => {
    it('puts a part into the free region it fits most snugly', () => {
      // After 600 × 600, free regions are 400 × 600 (right). A 400 × 250 part fits it exactly on the short side.
      const result = planWithStrategy({ panel, settings: noLoss, parts: parts([[600, 600, 1], [400, 250, 1]]) }, 'bestShortSideFit')

      expect(result.ok && result.plan.placements.map((placed) => placed.region)).toEqual([
        { xMm: 0, yMm: 0, lengthMm: 600, widthMm: 600 },
        { xMm: 600, yMm: 0, lengthMm: 400, widthMm: 250 },
      ])
    })

    it('breaks short-side ties by the smaller long-side leftover', () => {
      // 600 × 300 is cut width-first, leaving the 1000 × 300 band (older) and the 400 × 300 strip beside the part.
      // 300 × 300 leaves 0 on the short side in both; the strip leaves 100 on the long side instead of 700.
      const result = planWithStrategy(
        { panel, settings: noLoss, parts: parts([[600, 300, 1], [300, 300, 1]], { rotation: 'forbidden' }) },
        'bestShortSideFit',
      )

      expect(result.ok && result.plan.placements.map((placed) => placed.region)).toEqual([
        { xMm: 0, yMm: 0, lengthMm: 600, widthMm: 300 },
        { xMm: 600, yMm: 0, lengthMm: 300, widthMm: 300 },
      ])
    })

    it('prefers the normal orientation when both fit equally', () => {
      const result = planWithStrategy({ panel, settings: noLoss, parts: parts([[300, 300, 1]], { rotation: 'allowed' }) }, 'bestShortSideFit')

      expect(result.ok && result.plan.placements[0]?.orientation).toBe('normal')
    })

    it('rotates a part when that fits more snugly', () => {
      // 600 × 400 rotated is 400 × 600: it fills the panel width exactly.
      const result = planWithStrategy({ panel, settings: noLoss, parts: parts([[600, 400, 1]], { rotation: 'allowed' }) }, 'bestShortSideFit')

      expect(result.ok && result.plan.placements[0]).toMatchObject({ orientation: 'rotated', region: { lengthMm: 400, widthMm: 600 } })
    })
  })

  describe('constraints', () => {
    const settings = { kerfMm: 3.2, edgeMarginMm: 10 }

    it('respects grain and rotation restrictions in the selected plan', () => {
      const grained = parts([[300, 500, 2]], { grainDirection: 'width', rotation: 'allowed' })
      const locked = parts([[200, 200, 2]], { id: 'part-locked', grainDirection: 'length', rotation: 'forbidden' }).map((p, i) =>
        partSchema.parse({ ...p, id: `part-locked-${String(i)}` }),
      )
      const result = select({ parts: [...grained, ...locked], settings })

      for (const placed of result.plan.placements) {
        expect(placed.orientation).toBe(placed.partId.startsWith('part-locked') ? 'normal' : 'rotated')
      }
    })

    it('enforces exact material and thickness compatibility for every candidate', () => {
      const [ok] = parts([[300, 200, 1]])
      const [oak] = parts([[300, 200, 1]], { materialId: 'mat-oak' })
      const [thick] = parts([[300, 200, 1]], { thicknessMm: 18.001 })
      if (ok === undefined || oak === undefined || thick === undefined) {
        throw new Error('fixture')
      }
      const input = [ok, partSchema.parse({ ...oak, id: 'part-oak' }), partSchema.parse({ ...thick, id: 'part-thick' })]
      const result = select({ parts: input, settings })

      expect(result.plan.placements.map((placed) => placed.partId)).toEqual([ok.id])
      expect(result.plan.unplaced.map((unplaced) => [unplaced.partId, unplaced.reason.kind])).toEqual([
        ['part-oak', 'cannotFitPanel'],
        ['part-thick', 'cannotFitPanel'],
      ])
    })

    it('keeps parts inside margins and separated by the kerf', () => {
      const input = { panel, settings, parts: parts([[300, 200, 4], [150, 450, 2]], { rotation: 'allowed' }) }
      const result = select(input)

      expect(validateCuttingTree(result.plan.tree, input)).toEqual({ valid: true })
      expect(result.plan.tree.region).toEqual({ xMm: 10, yMm: 10, lengthMm: 980, widthMm: 580 })
    })
  })

  describe('quantities', () => {
    it('preserves part IDs and accounts for every requested copy', () => {
      const input = parts([[300, 200, 7], [450, 250, 3], [100, 100, 20]], { rotation: 'allowed' })
      const result = select({ parts: input, settings: { kerfMm: 3.2, edgeMarginMm: 5 } })

      for (const part of input) {
        const placed = result.plan.placements.filter((p) => p.partId === part.id).map((p) => p.copyIndex)
        const unplaced = result.plan.unplaced.filter((u) => u.partId === part.id)
        const unplacedCopies = unplaced.flatMap((u) => Array.from({ length: u.count }, (_unused, i) => u.firstCopyIndex + i))

        expect([...placed, ...unplacedCopies].sort((a, b) => a - b)).toEqual(Array.from({ length: part.quantity }, (_unused, i) => i))
      }
    })

    it('handles very large quantities with every strategy', () => {
      const result = select({ parts: parts([[100, 100, 1_000_000]]) })

      expect(result.plan.placements).toHaveLength(60)
      expect(result.plan.unplaced).toEqual([{ partId: 'part-0', firstCopyIndex: 60, count: 999_940, reason: { kind: 'noSpaceLeft' } }])
    })
  })

  describe('impossible cases', () => {
    it('reports a panel without usable area', () => {
      expect(optimizePanel({ panel, parts: parts([[100, 100, 1]]), settings: { kerfMm: 0, edgeMarginMm: 300 } })).toEqual({
        ok: false,
        error: { kind: 'noUsableArea' },
      })
    })

    it('returns an all-waste plan with every part reported when nothing can be placed', () => {
      const result = select({ parts: parts([[1100, 100, 2], [100, 100, 1]], { materialId: 'mat-oak' }) })

      expect(result.plan.tree).toEqual({ kind: 'waste', region: { xMm: 0, yMm: 0, lengthMm: 1000, widthMm: 600 } })
      expect(result.plan.unplaced.map((u) => [u.partId, u.count, u.reason.kind])).toEqual([
        ['part-0', 2, 'cannotFitPanel'],
        ['part-1', 1, 'cannotFitPanel'],
      ])
      expect(result.strategy).toBe('largestAreaFirst')
    })

    it('rejects duplicate part IDs', () => {
      const [a] = parts([[100, 100, 1]])
      if (a === undefined) {
        throw new Error('fixture')
      }
      expect(() => optimizePanel({ panel, parts: [a, a], settings: noLoss })).toThrow(/Duplicate part ID/)
    })
  })

  describe('determinism', () => {
    const input = parts([[300, 200, 3], [450, 250, 2], [120, 80, 5]], { rotation: 'allowed' })

    it('returns identical results for identical inputs', () => {
      const settings = { kerfMm: 3.2, edgeMarginMm: 5 }

      expect(optimizePanel({ panel, parts: input, settings })).toEqual(optimizePanel({ panel, parts: input, settings }))
    })

    it('does not depend on input order for parts of distinct sizes', () => {
      const forward = select({ parts: input })
      const reversed = select({ parts: [...input].reverse() })

      expect(reversed.strategy).toBe(forward.strategy)
      expect(reversed.plan).toEqual(forward.plan)
    })
  })
})
