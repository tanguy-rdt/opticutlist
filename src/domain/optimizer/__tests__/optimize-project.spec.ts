import { describe, expect, it } from 'vitest'
import { validPartInput, validSupplierProductInput, validStockItemInput } from '../../model/__tests__/fixtures'
import { partSchema } from '../../model/part'
import { supplierProductSchema } from '../../model/supplier-product'
import { stockItemSchema } from '../../model/stock-item'
import { stockPanel, stockPanelSchema } from '../panel-source'
import { optimizeProject } from '../optimize-project'
import { validateProjectPlan } from '../validate-project-plan'
import type { OptimizeProjectInput } from '../project-plan'

const part = partSchema.parse({ ...validPartInput, lengthMm: 100, widthMm: 100, grainDirection: 'none', rotation: 'allowed' })
const product = supplierProductSchema.parse({ ...validSupplierProductInput, lengthMm: 100, widthMm: 100, grainDirection: 'none' })
const input: OptimizeProjectInput = { parts: [part], panels: [{ product, quantity: 2 }], settings: { kerfMm: 0, edgeMarginMm: 0 } }
function run(value: OptimizeProjectInput = input) {
  const result = optimizeProject(value)
  expect(result.ok, JSON.stringify(result)).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  expect(validateProjectPlan(result.plan, value)).toEqual({ valid: true })
  return result.plan
}
describe('automatic panel allocation', () => {
  it('uses stock and catalog as distinct sources with exact compatibility, quantity limits and immutable geometry', () => {
    const stock = stockItemSchema.parse({ ...validStockItemInput, id: product.id, lengthMm: 100, widthMm: 100, grainDirection: 'none' })
    const source = stockPanel(stock)
    const snapshot = structuredClone(stock)
    const plan = run({ ...input, panels: [{ product, quantity: 1 }, { product: source, quantity: stock.quantity }] })
    expect(plan.metrics).toMatchObject({ placedCount: 2, panelCount: 2, unplacedCount: 0 })
    expect(plan.panels.map(panel => panel.supplierProductId)).toEqual([product.id, source.id])
    expect(stock).toEqual(snapshot)
    const limited = run({ ...input, panels: [{ product: source, quantity: stock.quantity }] })
    expect(limited.metrics).toMatchObject({ placedCount: 1, unplacedCount: 1 })
    const incompatible = run({ ...input, panels: [{ product: stockPanel({ ...stock, thicknessMm: 18.000001 }), quantity: 2 }] })
    expect(incompatible.panels).toEqual([])
    expect(stockPanelSchema.safeParse({ ...source, stockItemId: 'different-id' }).success).toBe(false)
    expect(optimizeProject({ ...input, panels: [{ product: { ...product, id: source.id }, quantity: 1 }, { product: source, quantity: 1 }] })).toMatchObject({ ok: false, error: { kind: 'invalidInput' } })
  })

  it('uses one sufficient panel instead of allocating empty or unnecessary panels', () => {
    const panels = [{ product: { ...product, lengthMm: 200 }, quantity: 10 }]
    const plan = run({ ...input, panels })
    expect(plan.metrics).toMatchObject({ placedCount: 2, unplacedCount: 0, panelCount: 1 })
  })
  it('distributes uniquely identified copies across panels without modifying inputs', () => {
    const snapshot = structuredClone(input)
    const plan = run()
    expect(plan.panels.map(panel => panel.panelCopyIndex)).toEqual([0, 1])
    expect(plan.panels.flatMap(panel => panel.plan.placements.map(placed => placed.copyIndex))).toEqual([0, 1])
    expect(plan.panels[0]?.plan.unplaced).toMatchObject([{ firstCopyIndex: 1, count: 1, reason: { kind: 'allocatedElsewhere' } }])
    expect(plan.unplaced).toEqual([])
    expect(input).toEqual(snapshot)
  })
  it('compares available references and prioritizes panel count, then waste', () => {
    const small = { ...product, id: supplierProductSchema.shape.id.parse('small') }
    const large = { ...product, id: supplierProductSchema.shape.id.parse('large'), lengthMm: 200 }
    const huge = { ...product, id: supplierProductSchema.shape.id.parse('huge'), lengthMm: 300 }
    const plan = run({ ...input, panels: [{ product: small, quantity: 2 }, { product: huge, quantity: 1 }, { product: large, quantity: 1 }] })
    expect(plan.panels.map(panel => panel.supplierProductId)).toEqual([large.id])
    expect(plan.metrics.wasteAreaMm2).toBe(0)
  })
  it('places more copies before minimizing the number of panels', () => {
    const plan = run({ ...input, parts: [{ ...part, quantity: 3 }], panels: [{ product, quantity: 3 }] })
    expect(plan.metrics).toMatchObject({ panelCount: 3, placedCount: 3, unplacedCount: 0 })
  })
  it('uses multiple references within each separate availability limit', () => {
    const other = { ...product, id: supplierProductSchema.shape.id.parse('other-panel') }
    const plan = run({ ...input, parts: [{ ...part, quantity: 4 }], panels: [{ product, quantity: 1 }, { product: other, quantity: 2 }] })
    expect(plan.metrics).toMatchObject({ panelCount: 3, placedCount: 3, unplacedCount: 1 })
    expect(plan.unplaced).toMatchObject([{ firstCopyIndex: 3, count: 1, reason: 'panelLimitReached' }])
  })
  it('handles mixed materials and exact thickness without crossing compatibility groups', () => {
    const thick = partSchema.parse({ ...part, id: 'thick', thicknessMm: 18.000001 })
    const different = partSchema.parse({ ...part, id: 'different', materialId: 'other-material' })
    const thickPanel = supplierProductSchema.parse({ ...product, id: 'thick-panel', thicknessMm: thick.thicknessMm })
    const otherPanel = supplierProductSchema.parse({ ...product, id: 'other-material-panel', materialId: different.materialId })
    const plan = run({ ...input, parts: [part, thick, different], panels: [{ product, quantity: 2 }, { product: thickPanel, quantity: 2 }, { product: otherPanel, quantity: 1 }] })
    expect(plan.metrics).toMatchObject({ placedCount: 5, unplacedCount: 1, panelCount: 5 })
    for (const panel of plan.panels) {
      const placed = panel.plan.placements[0]
      expect(placed?.partId).toBe(panel.supplierProductId === product.id ? part.id : panel.supplierProductId === thickPanel.id ? thick.id : different.id)
    }
  })
  it('excludes zero quantities and unavailable products and preserves unplaced accounting', () => {
    const plan = run({ ...input, panels: [{ product, quantity: 0 }, { product: supplierProductSchema.parse({ ...product, id: 'unavailable', availability: 'unavailable' }), quantity: 20 }] })
    expect(plan.panels).toEqual([])
    expect(plan.metrics).toMatchObject({ placedCount: 0, unplacedCount: 2 })
  })
  it('reports missing compatible products and impossible placements separately', () => {
    const plan = run({ ...input, parts: [partSchema.parse({ ...part, id: 'wrong-thickness', thicknessMm: 19 }), { ...part, lengthMm: 900 }] })
    expect(plan.panels).toEqual([])
    expect(plan.unplaced.map(item => item.reason)).toEqual(['noCompatiblePanel', 'constraintsPreventPlacement'])
  })
  it('prioritizes grain alignment while preserving unconstrained rotation restrictions across panels', () => {
    const grained = partSchema.parse({ ...part, lengthMm: 100, widthMm: 50, grainDirection: 'length', rotation: 'allowed' })
    const grainedPanel = supplierProductSchema.parse({ ...product, lengthMm: 50, widthMm: 100, grainDirection: 'width' })
    const plan = run({ ...input, parts: [grained], panels: [{ product: grainedPanel, quantity: 2 }] })
    expect(plan.panels.flatMap(panel => panel.plan.placements.map(placed => placed.orientation))).toEqual(['rotated', 'rotated'])
    const forbidden = run({ ...input, parts: [{ ...grained, rotation: 'forbidden' }], panels: [{ product: grainedPanel, quantity: 2 }] })
    expect(forbidden.panels.flatMap(panel => panel.plan.placements.map(placed => placed.orientation))).toEqual(['rotated', 'rotated'])
    expect(forbidden.metrics.unplacedCount).toBe(0)
    const noGrain = run({ ...input, parts: [{ ...grained, grainDirection: 'none', rotation: 'forbidden' }], panels: [{ product: grainedPanel, quantity: 2 }] })
    expect(noGrain.panels).toEqual([])
    expect(noGrain.metrics.unplacedCount).toBe(2)
  })
  it('respects micrometre kerf feasibility and literal edge margins', () => {
    const plan = run({ ...input, panels: [{ product: { ...product, lengthMm: 130, widthMm: 130 }, quantity: 2 }], settings: { kerfMm: 3, edgeMarginMm: 10 } })
    expect(plan.panels[0]?.plan.tree.region).toEqual({ xMm: 10, yMm: 10, lengthMm: 110, widthMm: 110 })
    expect(plan.panels[0]?.plan.placements[0]?.region).toEqual({ xMm: 10, yMm: 10, lengthMm: 100, widthMm: 100 })
    const impossible = run({ ...input, panels: [{ product: { ...product, lengthMm: 102 }, quantity: 2 }], settings: { kerfMm: 3, edgeMarginMm: 0 } })
    expect(impossible.panels).toEqual([])
  })
  it('returns deterministic output and explicitly breaks ties by input order', () => {
    const equal = supplierProductSchema.parse({ ...product, id: 'equal' })
    const value = { ...input, parts: [{ ...part, quantity: 1 }], panels: [{ product, quantity: 1 }, { product: equal, quantity: 1 }] }
    expect(run(value).panels[0]?.supplierProductId).toBe(product.id)
    expect(run(value)).toEqual(run(value))
  })
  it('handles very large unplaced quantities as ranges without expanding copies', () => {
    const plan = run({ ...input, parts: [{ ...part, quantity: Number.MAX_SAFE_INTEGER }], panels: [] })
    expect(plan.unplaced[0]?.count).toBe(Number.MAX_SAFE_INTEGER)
  })
  it('accounts for every copy in reproducible varied schedules', () => {
    let seed = 0x13579bdf
    function integer(max: number): number {
      seed = Math.imul(seed, 1664525) + 1013904223 | 0
      return (seed >>> 0) % max
    }
    for (let trial = 0; trial < 30; trial += 1) {
      const parts = Array.from({ length: 3 }, (_, index) => partSchema.parse({ ...part, id: `part-${String(index)}`, lengthMm: 10 + integer(90), widthMm: 10 + integer(90), quantity: 1 + integer(7), rotation: integer(2) ? 'allowed' : 'forbidden' }))
      const panels = Array.from({ length: 2 }, (_, index) => ({ product: supplierProductSchema.parse({ ...product, id: `panel-${String(index)}`, lengthMm: 100 + integer(100), widthMm: 100 + integer(100) }), quantity: integer(4) }))
      const value = { parts, panels, settings: { kerfMm: integer(5), edgeMarginMm: integer(8) } }
      const plan = run(value)
      expect(plan.metrics.placedCount + plan.metrics.unplacedCount).toBe(parts.reduce((sum, part) => sum + part.quantity, 0))
      const keys = plan.panels.flatMap(panel => panel.plan.placements.map(placed => `${placed.partId}/${String(placed.copyIndex)}`))
      expect(new Set(keys).size).toBe(keys.length)
      expect(run(value)).toEqual(plan)
    }
  })
  it('returns typed failures for duplicate references, invalid quantities and dimensions', () => {
    for (const value of [
      { ...input, parts: [part, part] }, { ...input, panels: [input.panels[0], input.panels[0]].filter(panel => panel !== undefined) },
      { ...input, panels: [{ product, quantity: -1 }] }, { ...input, panels: [{ product, quantity: 1.5 }] },
      { ...input, parts: [{ ...part, lengthMm: 0 }] }, { ...input, settings: { kerfMm: -1, edgeMarginMm: 0 } },
    ]) expect(optimizeProject(value)).toMatchObject({ ok: false, error: { kind: 'invalidInput' } })
  })
})
describe('independent project accounting', () => {
  it('rejects copy duplication across independently valid trees', () => {
    const plan = run()
    const first = plan.panels[0]
    const second = plan.panels[1]
    if (!first || !second) throw new Error('Expected panels')
    expect(validateProjectPlan({ ...plan, panels: [first, { ...first, panelCopyIndex: second.panelCopyIndex }] }, input)).toMatchObject({ valid: false })
  })
  it('rejects missing unplaced copies, unknown panels, excess quantities, empty panels and forged metrics', () => {
    const value = { ...input, panels: [{ product, quantity: 1 }] }
    const plan = run(value)
    const first = plan.panels[0]
    if (!first) throw new Error('Expected panel')
    for (const invalid of [
      { ...plan, unplaced: [] }, { ...plan, metrics: { ...plan.metrics, placedCount: 900 } },
      { ...plan, panels: [{ ...first, supplierProductId: supplierProductSchema.shape.id.parse('unknown') }] },
      { ...plan, panels: [{ ...first, panelCopyIndex: 1 }] },
      { ...plan, panels: [{ ...first, plan: { ...first.plan, unplaced: [] } }] },
      { ...plan, panels: [{ ...first, plan: { ...first.plan, placements: [] } }] },
      { ...plan, panels: [{ ...first, plan: { ...first.plan, tree: { kind: 'waste' as const, region: { xMm: 0, yMm: 0, lengthMm: 100, widthMm: 100 } } } }] },
    ]) expect(validateProjectPlan(invalid, value)).toMatchObject({ valid: false })
  })
  it('rejects invalid geometry and unavailable allocations even if summaries claim success', () => {
    const plan = run()
    const first = plan.panels[0]
    if (!first) throw new Error('Expected panel')
    expect(validateProjectPlan({ ...plan, panels: [{ ...first, plan: { ...first.plan, tree: { ...first.plan.tree, region: { ...first.plan.tree.region, xMm: Number.NaN } } } }] }, input)).toMatchObject({ valid: false })
    expect(validateProjectPlan(plan, { ...input, panels: [{ product: { ...product, availability: 'unavailable' }, quantity: 2 }] })).toMatchObject({ valid: false })
  })
  it('rejects panel summaries falsely claiming copies on other panels are unproduced', () => {
    const plan = run()
    const first = plan.panels[0]
    if (!first) throw new Error('Expected panel')
    expect(validateProjectPlan({ ...plan, panels: [{ ...first, plan: { ...first.plan, unplaced: first.plan.unplaced.map(missing => ({ ...missing, reason: { kind: 'noSpaceLeft' } })) } }, ...plan.panels.slice(1)] }, input)).toMatchObject({ valid: false })
  })
})


describe('lexicographic owned-stock preference', () => {
  const owned = stockItemSchema.parse({ ...validStockItemInput, id: 'owned-panel', lengthMm: 100, widthMm: 100, quantity: 2, grainDirection: 'none' })
  const source = stockPanel(owned)
  it.each([true, false])('reproduces 800 × 400 Catalog versus two distinct 800 × 600 StockItems (preference %s)', preferStockPanels => {
    const catalog = supplierProductSchema.parse({ ...product, lengthMm: 800, widthMm: 400 })
    const first = stockPanel({ ...owned, id: stockItemSchema.shape.id.parse('first-physical-panel'), lengthMm: 800, widthMm: 600, quantity: 1 })
    const second = stockPanel({ ...owned, id: stockItemSchema.shape.id.parse('second-physical-panel'), lengthMm: 800, widthMm: 600, quantity: 1 })
    const request = {
      parts: ['first-part', 'second-part'].map(id => partSchema.parse({ ...part, id, lengthMm: 200, widthMm: 400, quantity: 1 })),
      panels: [{ product: catalog, quantity: 2 }, { product: first, quantity: 1 }, { product: second, quantity: 1 }],
      settings: { kerfMm: 3, edgeMarginMm: 0, preferStockPanels },
    }
    const snapshot = structuredClone(request)
    const plan = run(request)
    expect(plan.metrics).toMatchObject({ placedCount: 2, unplacedCount: 0, panelCount: 1 })
    expect(plan.panels.map(panel => panel.supplierProductId)).toEqual([preferStockPanels ? first.id : catalog.id])
    expect(plan.panels[0]?.panelCopyIndex).toBe(0)
    expect(run(request)).toEqual(plan)
    expect(request).toEqual(snapshot)
  })
  it.each([undefined, true, false])('prefers equivalent Stock, including offcuts, only when enabled (%j)', preferStockPanels => {
    const settings = { ...input.settings, ...(preferStockPanels === undefined ? {} : { preferStockPanels }) }
    const request = { ...input, settings, panels: [{ product, quantity: 2 }, { product: source, quantity: 2 }] }
    const snapshot = structuredClone(request)
    const plan = run(request)
    expect(plan.panels.map(panel => panel.supplierProductId)).toEqual(preferStockPanels === false ? [product.id, product.id] : [source.id, source.id])
    expect(plan.panels.map(panel => panel.panelCopyIndex)).toEqual([0, 1])
    expect(run(request)).toEqual(plan)
    expect(request).toEqual(snapshot)
    expect(owned.kind).toBe('offcut')
  })
  it.each([true, false])('keeps physical limits and mixes sources when necessary (preference %s)', preferStockPanels => {
    const plan = run({ ...input, settings: { ...input.settings, preferStockPanels }, panels: [{ product, quantity: 1 }, { product: source, quantity: 1 }] })
    expect(plan.metrics).toMatchObject({ placedCount: 2, unplacedCount: 0 })
    expect(plan.panels.filter(panel => panel.supplierProductId === source.id)).toHaveLength(1)
    expect(new Set(plan.panels.filter(panel => panel.supplierProductId === source.id).map(panel => panel.panelCopyIndex)).size).toBe(1)
    expect(plan.panels.filter(panel => panel.supplierProductId === product.id)).toHaveLength(1)
    const limited = run({ ...input, settings: { ...input.settings, preferStockPanels }, panels: [{ product: source, quantity: 1 }] })
    expect(limited.metrics).toMatchObject({ placedCount: 1, unplacedCount: 1, panelCount: 1 })
  })
  it.each([110, 110.001, 150])('prefers zero Catalog panels regardless of the extra Stock area (%s mm)', lengthMm => {
    const stockSource = stockPanel({ ...owned, lengthMm, quantity: 1 })
    const plan = run({ ...input, parts: [{ ...part, quantity: 1 }], panels: [{ product, quantity: 1 }, { product: stockSource, quantity: 1 }] })
    expect(plan.panels[0]?.supplierProductId).toBe(stockSource.id)
  })
  it('accepts extra owned panels to avoid Catalog and considers owned full panels too', () => {
    const full = stockPanel({ ...owned, kind: 'fullPanel' })
    const large = { ...product, lengthMm: 200 }
    const plan = run({ ...input, panels: [{ product: large, quantity: 1 }, { product: full, quantity: 2 }] })
    expect(plan.panels.map(panel => panel.supplierProductId)).toEqual([full.id, full.id])
    const equivalent = run({ ...input, panels: [{ product, quantity: 2 }, { product: full, quantity: 2 }] })
    expect(equivalent.panels.map(panel => panel.supplierProductId)).toEqual([full.id, full.id])
  })
  it('keeps maximum coverage ahead of Catalog count when a Stock-first schedule strands demand', () => {
    const largePart = partSchema.parse({ ...part, id: 'large', lengthMm: 200, widthMm: 100, quantity: 1, rotation: 'forbidden' })
    const smallPart = partSchema.parse({ ...part, id: 'small', lengthMm: 100, widthMm: 100, quantity: 2 })
    const catalog = { ...product, lengthMm: 100, widthMm: 100 }
    const stock = stockPanel({ ...owned, lengthMm: 200, widthMm: 100, quantity: 1 })
    const plan = run({ parts: [smallPart, largePart], panels: [{ product: catalog, quantity: 2 }, { product: stock, quantity: 1 }], settings: input.settings })
    expect(plan.metrics).toMatchObject({ placedCount: 3, unplacedCount: 0, panelCount: 3 })
    expect(plan.panels.filter(panel => panel.supplierProductId === stock.id)).toHaveLength(1)
    expect(plan.panels.filter(panel => panel.supplierProductId === catalog.id)).toHaveLength(2)
  })

  it('uses existing panel-count and waste ranking among equal Catalog counts', () => {
    const small = stockPanel({ ...owned, id: stockItemSchema.shape.id.parse('small-owned'), quantity: 2 })
    const oversized = stockPanel({ ...owned, id: stockItemSchema.shape.id.parse('oversized-owned'), lengthMm: 300, quantity: 1 })
    const sufficient = stockPanel({ ...owned, id: stockItemSchema.shape.id.parse('sufficient-owned'), lengthMm: 200, quantity: 1 })
    const plan = run({ ...input, panels: [{ product, quantity: 2 }, { product: small, quantity: 2 }, { product: oversized, quantity: 1 }, { product: sufficient, quantity: 1 }] })
    expect(plan.panels.map(panel => panel.supplierProductId)).toEqual([sufficient.id])
    expect(plan.metrics.wasteAreaMm2).toBe(0)
  })

  it('uses Catalog when stock cannot satisfy grain, thickness, kerf or margins', () => {
    const constrained = partSchema.parse({ ...part, lengthMm: 100, widthMm: 50, quantity: 1, grainDirection: 'length', rotation: 'allowed' })
    const catalog = supplierProductSchema.parse({ ...product, lengthMm: 104, widthMm: 54, grainDirection: 'length' })
    for (const stockSource of [
      stockPanel({ ...owned, lengthMm: 104, widthMm: 54, grainDirection: 'width' }),
      stockPanel({ ...owned, lengthMm: 104, widthMm: 54, thicknessMm: 19 }),
      stockPanel({ ...owned, lengthMm: 100, widthMm: 50, grainDirection: 'length' }),
    ]) {
      const plan = run({ parts: [constrained], settings: { kerfMm: 3, edgeMarginMm: 2, preferStockPanels: true }, panels: [{ product: catalog, quantity: 1 }, { product: stockSource, quantity: 1 }] })
      expect(plan.panels.map(panel => panel.supplierProductId)).toEqual([catalog.id])
      expect(plan.metrics.unplacedCount).toBe(0)
    }
  })
})
