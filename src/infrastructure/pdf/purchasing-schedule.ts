import type { CuttingPlanPdfDocument } from '../../application/export/cutting-plan-pdf-service'

/** Currency-separated known subtotals; an unknown price is never zero or an inferred stock value. */
export function purchasingSchedule(sources: readonly { panel: CuttingPlanPdfDocument; count: number }[]): string[][] {
  const totals = new Map<string, number>()
  const unknown = sources.some(({ panel }) => panel.panel.stockItemId !== undefined || panel.pricing === undefined)
  const rows = sources.map(({ panel, count }) => {
    const pricing = panel.panel.stockItemId ? undefined : panel.pricing
    const total = pricing ? pricing.price * count : undefined
    if (total !== undefined && !Number.isFinite(total)) throw new RangeError('Panel price total exceeds the supported range.')
    if (pricing && total !== undefined) totals.set(pricing.currency, (totals.get(pricing.currency) ?? 0) + total)
    return [panel.panel.name, panel.materialName, `${String(panel.panel.lengthMm)} × ${String(panel.panel.widthMm)} × ${String(panel.panel.thicknessMm)} mm`, String(count), panel.panel.stockItemId ? 'Owned stock' : panel.supplierName ?? 'N/A', pricing ? `${pricing.price.toFixed(2)} ${pricing.currency}` : 'N/A', pricing && total !== undefined ? `${total.toFixed(2)} ${pricing.currency}` : 'N/A']
  })
  for (const [currency, total] of totals) {
    if (!Number.isFinite(total)) throw new RangeError('Purchasing subtotal exceeds the supported range.')
    rows.push([unknown ? 'Known total (partial)' : 'Known total', '', '', '', '', '', `${total.toFixed(2)} ${currency}`])
  }
  if (sources.length && unknown && !totals.size) rows.push(['Known total (partial)', '', '', '', '', '', 'N/A'])
  return rows
}
