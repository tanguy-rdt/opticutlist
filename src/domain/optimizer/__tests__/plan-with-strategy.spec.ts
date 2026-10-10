import { describe, expect, it } from 'vitest'

import { validateCuttingTree } from '../../cutting-tree/validate-cutting-tree'
import type { Rect } from '../../geometry/rect'
import { partSchema, type Part } from '../../model/part'
import { stockItemSchema } from '../../model/stock-item'
import { supplierProductSchema } from '../../model/supplier-product'
import { validPartInput, validStockItemInput, validSupplierProductInput } from '../../model/__tests__/fixtures'
import {
  computeAreaMetrics,
  PLACEMENT_STRATEGIES,
  planWithStrategy,
  type OptimizePanelInput,
  type PanelCuttingPlan,
  type PlacementStrategy,
} from '../plan-with-strategy'

// Panel: 2500 × 1250 × 18 birch, grain along length. Usable area with 10 mm margins: (10, 10, 2480 × 1230).
const panel = supplierProductSchema.parse(validSupplierProductInput)
const settings = { kerfMm: 3.2, edgeMarginMm: 10 }
const usable: Rect = { xMm: 10, yMm: 10, lengthMm: 2480, widthMm: 1230 }

function part(overrides: Partial<Record<keyof typeof validPartInput, unknown>> = {}): Part {
  return partSchema.parse({ ...validPartInput, ...overrides })
}

// 720 × 560, grain along length, rotation forbidden, quantity 2.
const side = part()
// 400 × 300, no grain, rotation allowed, quantity 3.
const shelf = part({ id: 'part-shelf', name: 'Shelf', lengthMm: 400, widthMm: 300, quantity: 3, grainDirection: 'none', rotation: 'allowed' })

function plan(input: Partial<OptimizePanelInput> = {}, strategy: PlacementStrategy = 'largestAreaFirst'): PanelCuttingPlan {
  const result = planWithStrategy({ panel, parts: [side, shelf], settings, ...input }, strategy)
  if (!result.ok) {
    throw new Error(`Expected a plan, got ${result.error.kind}`)
  }
  return result.plan
}

function placedIds(result: PanelCuttingPlan): string[] {
  return result.placements.map((placed) => `${placed.partId}#${String(placed.copyIndex)}`)
}

describe('planWithStrategy (largestAreaFirst baseline)', () => {
  describe('placement', () => {
    it('builds the expected guillotine tree for a small job', () => {
      const result = plan()

      expect(result.tree).toEqual({
        kind: 'cut',
        region: usable,
        cut: { axis: 'length', offsetMm: 720 },
        first: {
          kind: 'cut',
          region: { xMm: 10, yMm: 10, lengthMm: 720, widthMm: 1230 },
          cut: { axis: 'width', offsetMm: 560 },
          first: { kind: 'part', region: { xMm: 10, yMm: 10, lengthMm: 720, widthMm: 560 }, partId: side.id, copyIndex: 0, orientation: 'normal' },
          second: {
            kind: 'cut',
            region: { xMm: 10, yMm: 573.2, lengthMm: 720, widthMm: 666.8 },
            cut: { axis: 'width', offsetMm: 560 },
            first: { kind: 'part', region: { xMm: 10, yMm: 573.2, lengthMm: 720, widthMm: 560 }, partId: side.id, copyIndex: 1, orientation: 'normal' },
            second: { kind: 'waste', region: { xMm: 10, yMm: 1136.4, lengthMm: 720, widthMm: 103.6 } },
          },
        },
        second: {
          kind: 'cut',
          region: { xMm: 733.2, yMm: 10, lengthMm: 1756.8, widthMm: 1230 },
          cut: { axis: 'length', offsetMm: 400 },
          first: {
            kind: 'cut',
            region: { xMm: 733.2, yMm: 10, lengthMm: 400, widthMm: 1230 },
            cut: { axis: 'width', offsetMm: 300 },
            first: { kind: 'part', region: { xMm: 733.2, yMm: 10, lengthMm: 400, widthMm: 300 }, partId: shelf.id, copyIndex: 0, orientation: 'normal' },
            second: {
              kind: 'cut',
              region: { xMm: 733.2, yMm: 313.2, lengthMm: 400, widthMm: 926.8 },
              cut: { axis: 'width', offsetMm: 300 },
              first: { kind: 'part', region: { xMm: 733.2, yMm: 313.2, lengthMm: 400, widthMm: 300 }, partId: shelf.id, copyIndex: 1, orientation: 'normal' },
              second: {
                kind: 'cut',
                region: { xMm: 733.2, yMm: 616.4, lengthMm: 400, widthMm: 623.6 },
                cut: { axis: 'width', offsetMm: 300 },
                first: { kind: 'part', region: { xMm: 733.2, yMm: 616.4, lengthMm: 400, widthMm: 300 }, partId: shelf.id, copyIndex: 2, orientation: 'normal' },
                second: { kind: 'waste', region: { xMm: 733.2, yMm: 919.6, lengthMm: 400, widthMm: 320.4 } },
              },
            },
          },
          second: { kind: 'waste', region: { xMm: 1136.4, yMm: 10, lengthMm: 1353.6, widthMm: 1230 } },
        },
      })
      expect(result.unplaced).toEqual([])
    })

    it('cuts across the width first when that keeps the larger leftover', () => {
      // Length first would keep 2000 × 926.8 at most; width first keeps 2480 × 926.8.
      const plank = part({ lengthMm: 2000, widthMm: 300, quantity: 1 })

      expect(plan({ parts: [plank] }).tree).toEqual({
        kind: 'cut',
        region: usable,
        cut: { axis: 'width', offsetMm: 300 },
        first: {
          kind: 'cut',
          region: { xMm: 10, yMm: 10, lengthMm: 2480, widthMm: 300 },
          cut: { axis: 'length', offsetMm: 2000 },
          first: { kind: 'part', region: { xMm: 10, yMm: 10, lengthMm: 2000, widthMm: 300 }, partId: plank.id, copyIndex: 0, orientation: 'normal' },
          second: { kind: 'waste', region: { xMm: 2013.2, yMm: 10, lengthMm: 476.8, widthMm: 300 } },
        },
        second: { kind: 'waste', region: { xMm: 10, yMm: 313.2, lengthMm: 2480, widthMm: 926.8 } },
      })
    })

    it('places larger parts first regardless of input order', () => {
      expect(placedIds(plan({ parts: [shelf, side] }))).toEqual(placedIds(plan({ parts: [side, shelf] })))
      expect(plan({ parts: [shelf, side] }).placements[0]?.partId).toBe(side.id)
    })

    it('keeps input order for parts of identical size', () => {
      const a = part({ id: 'part-a', quantity: 1 })
      const b = part({ id: 'part-b', quantity: 1 })

      expect(placedIds(plan({ parts: [b, a] }))).toEqual(['part-b#0', 'part-a#0'])
    })

    it('places parts into the leftover strip beside a larger part', () => {
      // 720 × 1000 leaves a 720 × 226.8 strip, which takes the 700 × 200 part.
      const big = part({ id: 'part-big', widthMm: 1000, quantity: 1 })
      const strip = part({ id: 'part-strip', lengthMm: 700, widthMm: 200, quantity: 1 })
      const result = plan({ parts: [big, strip] })

      expect(result.placements.map((placed) => placed.region)).toEqual([
        { xMm: 10, yMm: 10, lengthMm: 720, widthMm: 1000 },
        { xMm: 10, yMm: 1013.2, lengthMm: 700, widthMm: 200 },
      ])
    })

    it('works on owned stock', () => {
      const offcut = stockItemSchema.parse(validStockItemInput) // 800 × 400.5, no margin
      const result = plan({ panel: offcut, parts: [part({ widthMm: 400.5, quantity: 1 })], settings: { kerfMm: 3.2, edgeMarginMm: 0 } })

      expect(result.placements).toHaveLength(1)
      expect(result.unplaced).toEqual([])
    })
  })

  describe('empty inputs and exact fits', () => {
    it('returns an all-waste plan for no parts', () => {
      expect(plan({ parts: [] })).toEqual({
        tree: { kind: 'waste', region: usable },
        placements: [],
        unplaced: [],
        metrics: { panelAreaMm2: 3_125_000, usedAreaMm2: 0, wasteAreaMm2: 3_125_000, utilizationPercent: 0 },
      })
    })

    it('places a part filling the usable area exactly as the root leaf', () => {
      const full = part({ lengthMm: 2480, widthMm: 1230, quantity: 1 })
      const result = plan({ parts: [full] })

      expect(result.tree).toEqual({ kind: 'part', region: usable, partId: full.id, copyIndex: 0, orientation: 'normal' })
    })

    it('reaches 100 % utilization for an exact fit without margin', () => {
      const full = part({ lengthMm: 2500, widthMm: 1250, quantity: 1 })

      expect(plan({ parts: [full], settings: { kerfMm: 3.2, edgeMarginMm: 0 } }).metrics.utilizationPercent).toBe(100)
    })

    it('reports a panel whose margins leave no usable area', () => {
      expect(planWithStrategy({ panel, parts: [side], settings: { kerfMm: 3.2, edgeMarginMm: 625 } }, 'largestAreaFirst')).toEqual({
        ok: false,
        error: { kind: 'noUsableArea' },
      })
    })
  })

  describe('kerf', () => {
    it('fits two parts separated by exactly one kerf', () => {
      // 1238.4 + 3.2 + 1238.4 = 2480
      const half = part({ lengthMm: 1238.4, widthMm: 1230, quantity: 2 })
      const result = plan({ parts: [half] })

      expect(result.placements.map((placed) => placed.region.xMm)).toEqual([10, 1251.6])
      expect(result.unplaced).toEqual([])
    })

    it('cannot fit the second part when it is 0.001 mm too long', () => {
      const half = part({ lengthMm: 1238.401, widthMm: 1230, quantity: 2 })

      expect(plan({ parts: [half] }).unplaced).toEqual([{ partId: half.id, firstCopyIndex: 1, count: 1, reason: { kind: 'noSpaceLeft' } }])
    })

    it('fits both parts without kerf', () => {
      const half = part({ lengthMm: 1240, widthMm: 1230, quantity: 2 })

      expect(plan({ parts: [half], settings: { kerfMm: 0, edgeMarginMm: 10 } }).unplaced).toEqual([])
    })

    it('reports a part that would leave a strip narrower than the kerf', () => {
      // 2480 − 2478 = 2 mm ≤ 3.2 mm kerf: no cut can produce this part.
      const almost = part({ lengthMm: 2478, widthMm: 1230, quantity: 1 })

      expect(plan({ parts: [almost] }).unplaced).toEqual([
        { partId: almost.id, firstCopyIndex: 0, count: 1, reason: { kind: 'remainderNarrowerThanKerf' } },
      ])
    })

    it('reports a part that would leave a strip exactly as wide as the kerf', () => {
      // 2480 − 2476.8 = 3.2 mm: the kerf would consume the whole strip, leaving no second region.
      const almost = part({ lengthMm: 2476.8, widthMm: 1230, quantity: 1 })

      expect(plan({ parts: [almost] }).unplaced).toEqual([
        { partId: almost.id, firstCopyIndex: 0, count: 1, reason: { kind: 'remainderNarrowerThanKerf' } },
      ])
    })

    it('handles decimal kerf exactly', () => {
      // 1238.35 + 3.3 + 1238.35 = 2480 exactly (plain floating point would drift).
      const half = part({ lengthMm: 1238.35, widthMm: 1230, quantity: 2 })
      const result = plan({ parts: [half], settings: { kerfMm: 3.3, edgeMarginMm: 10 } })

      expect(result.placements.map((placed) => placed.region.xMm)).toEqual([10, 1251.65])
      expect(result.unplaced).toEqual([])
    })

    it('does not place a part that would leave a sliver narrower than the kerf', () => {
      // After two 824.4 mm parts and kerfs, 824.6 mm remain: a third 824.4 mm part would leave 0.2 mm < 3.3 mm.
      const third = part({ lengthMm: 824.4, widthMm: 1230, quantity: 3 })

      expect(plan({ parts: [third], settings: { kerfMm: 3.3, edgeMarginMm: 10 } }).unplaced).toEqual([
        { partId: third.id, firstCopyIndex: 2, count: 1, reason: { kind: 'noSpaceLeft' } },
      ])
    })
  })

  describe('margins', () => {
    it('fits a part on the full panel without margin', () => {
      expect(plan({ parts: [part({ lengthMm: 2490, quantity: 1 })], settings: { kerfMm: 3.2, edgeMarginMm: 0 } }).unplaced).toEqual([])
    })

    it('rejects the same part when margins shrink the usable area', () => {
      const long = part({ lengthMm: 2490, quantity: 1 })

      expect(plan({ parts: [long] }).unplaced).toEqual([
        {
          partId: long.id,
          firstCopyIndex: 0,
          count: 1,
          reason: { kind: 'cannotFitPanel', issues: [{ kind: 'exceedsUsableArea', usableArea: usable, triedOrientations: ['normal'] }] },
        },
      ])
    })

    it('never places parts inside the margins', () => {
      for (const placed of plan().placements) {
        expect(placed.region.xMm).toBeGreaterThanOrEqual(10)
        expect(placed.region.yMm).toBeGreaterThanOrEqual(10)
        expect(placed.region.xMm + placed.region.lengthMm).toBeLessThanOrEqual(2490)
        expect(placed.region.yMm + placed.region.widthMm).toBeLessThanOrEqual(1240)
      }
    })
  })

  describe('rotation', () => {
    it('rotates a part that only fits rotated when rotation is allowed', () => {
      const tall = part({ lengthMm: 1000, widthMm: 2000, quantity: 1, grainDirection: 'none', rotation: 'allowed' })

      expect(plan({ parts: [tall] }).placements).toEqual([
        {
          partId: tall.id,
          copyIndex: 0,
          orientation: 'rotated',
          region: { xMm: 10, yMm: 10, lengthMm: 2000, widthMm: 1000 },
          dimensions: { lengthMm: 2000, widthMm: 1000, thicknessMm: 18 },
        },
      ])
    })

    it('does not rotate a part whose rotation is forbidden', () => {
      const tall = part({ lengthMm: 1000, widthMm: 2000, quantity: 1, grainDirection: 'none', rotation: 'forbidden' })
      const result = plan({ parts: [tall] })

      expect(result.placements).toEqual([])
      expect(result.unplaced[0]?.reason).toMatchObject({ kind: 'cannotFitPanel', issues: [{ kind: 'exceedsUsableArea' }] })
    })

    it('prefers the normal orientation when both fit', () => {
      expect(plan({ parts: [shelf] }).placements.every((placed) => placed.orientation === 'normal')).toBe(true)
    })

    it('uses rotation to fit a part into a leftover region', () => {
      // After 2480 × 900, the 2480 × 326.8 strip only takes the 300 × 400 part rotated.
      const wide = part({ id: 'part-wide', lengthMm: 2480, widthMm: 900, quantity: 1, grainDirection: 'none' })
      const small = part({ id: 'part-small', lengthMm: 300, widthMm: 400, quantity: 1, grainDirection: 'none', rotation: 'allowed' })
      const result = plan({ parts: [wide, small] })

      expect(result.placements[1]).toMatchObject({ partId: small.id, orientation: 'rotated', region: { xMm: 10, yMm: 913.2, lengthMm: 400, widthMm: 300 } })
    })
  })

  describe('grain', () => {
    it('rotates a part whose grain runs along its width to follow the panel grain', () => {
      const crossGrain = part({ lengthMm: 300, widthMm: 2000, quantity: 1, grainDirection: 'width', rotation: 'allowed' })

      expect(plan({ parts: [crossGrain] }).placements[0]?.orientation).toBe('rotated')
    })

    it('never rotates against the panel grain', () => {
      // Fits only rotated, but rotation would put the part grain across the panel grain.
      const grained = part({ lengthMm: 1000, widthMm: 2000, quantity: 1, grainDirection: 'length', rotation: 'allowed' })
      const result = plan({ parts: [grained] })

      expect(result.placements).toEqual([])
      expect(result.unplaced[0]?.reason).toMatchObject({ kind: 'cannotFitPanel', issues: [{ kind: 'exceedsUsableArea', triedOrientations: ['normal'] }] })
    })

    it('reports a part whose grain requires a forbidden rotation', () => {
      const crossGrain = part({ grainDirection: 'width', rotation: 'forbidden' })

      expect(plan({ parts: [crossGrain] }).unplaced).toEqual([
        {
          partId: crossGrain.id,
          firstCopyIndex: 0,
          count: 2,
          reason: {
            kind: 'cannotFitPanel',
            issues: [{ kind: 'grainRequiresRotation', partGrain: 'width', panelGrain: 'length', rotation: 'forbidden' }],
          },
        },
      ])
    })

    it('ignores grain on a grainless panel', () => {
      const mdf = supplierProductSchema.parse({ ...validSupplierProductInput, grainDirection: 'none' })
      const grained = part({ lengthMm: 1000, widthMm: 2000, quantity: 1, grainDirection: 'length', rotation: 'allowed' })

      expect(plan({ panel: mdf, parts: [grained] }).placements[0]?.orientation).toBe('rotated')
    })
  })

  describe('quantities', () => {
    it('expands quantities into copies that keep the original part ID', () => {
      expect(placedIds(plan({ parts: [shelf] }))).toEqual(['part-shelf#0', 'part-shelf#1', 'part-shelf#2'])
    })

    it('reports the copies that did not fit as one range', () => {
      // 1230 × 1230 squares: two fit along 2480 (1230 + 3.2 + 1230), the third does not.
      const square = part({ lengthMm: 1230, widthMm: 1230, quantity: 5 })
      const result = plan({ parts: [square] })

      expect(placedIds(result)).toEqual([`${square.id}#0`, `${square.id}#1`])
      expect(result.unplaced).toEqual([{ partId: square.id, firstCopyIndex: 2, count: 3, reason: { kind: 'noSpaceLeft' } }])
    })

    it('handles very large quantities without expanding them all', () => {
      const tiny = part({ lengthMm: 100, widthMm: 100, quantity: 1_000_000, grainDirection: 'none' })
      const result = plan({ parts: [tiny] })
      const [unplaced] = result.unplaced

      // 24 columns (24 × 100 + 23 × 3.2 = 2473.6) × 11 rows (11 × 100 + 10 × 3.2 = 1132) = 264 copies.
      expect(result.placements).toHaveLength(264)
      expect(unplaced).toEqual({ partId: tiny.id, firstCopyIndex: 264, count: 999_736, reason: { kind: 'noSpaceLeft' } })
    })
  })

  describe('compatibility', () => {
    it('rejects parts of another material but still places the others', () => {
      const oak = part({ id: 'part-oak', materialId: 'mat-oak', quantity: 1 })
      const result = plan({ parts: [oak, shelf] })

      expect(placedIds(result)).toEqual(['part-shelf#0', 'part-shelf#1', 'part-shelf#2'])
      expect(result.unplaced).toEqual([
        {
          partId: oak.id,
          firstCopyIndex: 0,
          count: 1,
          reason: { kind: 'cannotFitPanel', issues: [{ kind: 'materialMismatch', expected: oak.materialId, actual: panel.materialId }] },
        },
      ])
    })

    it('requires exact thickness equality', () => {
      const thick = part({ thicknessMm: 18.001, quantity: 1 })

      expect(plan({ parts: [thick] }).unplaced).toEqual([
        {
          partId: thick.id,
          firstCopyIndex: 0,
          count: 1,
          reason: { kind: 'cannotFitPanel', issues: [{ kind: 'thicknessMismatch', expectedMm: 18.001, actualMm: 18 }] },
        },
      ])
    })

    it('preserves thickness in every placement', () => {
      expect(plan().placements.every((placed) => placed.dimensions.thicknessMm === 18)).toBe(true)
    })

    it('rejects duplicate part IDs', () => {
      expect(() => planWithStrategy({ panel, parts: [side, side], settings }, 'largestAreaFirst')).toThrow(/Duplicate part ID/)
    })
  })

  describe('area metrics', () => {
    it('computes used, waste and utilization from the placed parts', () => {
      // 2 × 720 × 560 + 3 × 400 × 300 = 806 400 + 360 000 = 1 166 400 mm² of 3 125 000 mm².
      expect(plan().metrics).toEqual({
        panelAreaMm2: 3_125_000,
        usedAreaMm2: 1_166_400,
        wasteAreaMm2: 1_958_600,
        utilizationPercent: (1_166_400 / 3_125_000) * 100,
      })
    })

    it('computes decimal areas exactly', () => {
      const offcut = stockItemSchema.parse(validStockItemInput) // 800 × 400.5 = 320 400 mm²
      const placed = { partId: side.id, copyIndex: 0, orientation: 'normal' as const, dimensions: { lengthMm: 0.1, widthMm: 0.3, thicknessMm: 18 } }

      expect(computeAreaMetrics(offcut, [{ ...placed, region: { xMm: 0, yMm: 0, lengthMm: 0.1, widthMm: 0.3 } }])).toEqual({
        panelAreaMm2: 320_400,
        usedAreaMm2: 0.03,
        wasteAreaMm2: 320_399.97,
        utilizationPercent: (30_000 / 320_400_000_000) * 100,
      })
    })
  })

  describe('determinism and validity', () => {
    it('returns identical results for identical inputs', () => {
      expect(planWithStrategy({ panel, parts: [side, shelf], settings }, 'largestAreaFirst')).toEqual(
        planWithStrategy({ panel, parts: [side, shelf], settings }, 'largestAreaFirst'),
      )
    })

    it('does not mutate its inputs', () => {
      const parts = [shelf, side]
      const snapshot = structuredClone(parts)
      planWithStrategy({ panel, parts, settings }, 'largestAreaFirst')

      expect(parts).toEqual(snapshot)
    })

    it('produces valid, complete and non-overlapping plans for many generated jobs with every strategy', () => {
      // Deterministic pseudo-random generator (LCG) so failures are reproducible.
      let seed = 42
      const random = (): number => {
        seed = (seed * 1_664_525 + 1_013_904_223) % 2 ** 32
        return seed / 2 ** 32
      }
      const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)] as T

      for (let job = 0; job < 150; job += 1) {
        const jobSettings = { kerfMm: pick([0, 3.2, 4]), edgeMarginMm: pick([0, 5, 10.5]) }
        const parts = Array.from({ length: 1 + Math.floor(random() * 6) }, (_unused, index) =>
          part({
            id: `part-${String(index)}`,
            lengthMm: Math.round(50 + random() * 1500) / 10 * 10,
            widthMm: Math.round(50 + random() * 900) / 10 * 10,
            quantity: 1 + Math.floor(random() * 6),
            grainDirection: pick(['none', 'length', 'width']),
            rotation: pick(['allowed', 'forbidden']),
          }),
        )

        for (const strategy of PLACEMENT_STRATEGIES) {
        const result = planWithStrategy({ panel, parts, settings: jobSettings }, strategy)
        expect(result.ok).toBe(true)
        if (!result.ok) {
          continue
        }
        const { tree, placements, unplaced } = result.plan

        expect(validateCuttingTree(tree, { panel, parts, settings: jobSettings })).toEqual({ valid: true })
        for (const p of parts) {
          const placedCount = placements.filter((placed) => placed.partId === p.id).length
          const unplacedCount = unplaced.filter((u) => u.partId === p.id).reduce((sum, u) => sum + u.count, 0)
          expect(placedCount + unplacedCount).toBe(p.quantity)
        }
        for (const [i, a] of placements.entries()) {
          for (const b of placements.slice(i + 1)) {
            const separated =
              a.region.xMm + a.region.lengthMm <= b.region.xMm ||
              b.region.xMm + b.region.lengthMm <= a.region.xMm ||
              a.region.yMm + a.region.widthMm <= b.region.yMm ||
              b.region.yMm + b.region.widthMm <= a.region.yMm
            expect(separated).toBe(true)
          }
        }
        }
      }
    })
  })
})
