import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { CuttingPlanPdfDocument, ProjectCuttingPdfDocument } from '../../application/export/cutting-plan-pdf-service'
import { DIMENSION_CLEARANCE, drawDimensions, drawGrain, drawScaleBar, drawWaste, scaleLabel, technicalTransform } from './technical-drawing'
import type { Part } from '../../domain/model/part'
import { pdfPageSize, pdfRect } from './pdf-layout'

const ink = rgb(0.12, 0.15, 0.17)
const muted = rgb(0.35, 0.38, 0.4)
const margin = 36
const lineHeight = 14

export { wrapPdfText } from './pdf-text'
import { wrapPdfText } from './pdf-text'
import { createPdfTables } from './pdf-table'
import { purchasingSchedule } from './purchasing-schedule'
import { appendPartDrawings } from './part-drawings'
function drawLines(page: PDFPage, lines: readonly string[], font: PDFFont, x: number, y: number, size = 10): number {
  for (const text of lines) { page.drawText(text, { x, y, size, font, color: ink }); y -= lineHeight }
  return y
}
function dimensions(item: { lengthMm: number; widthMm: number; thicknessMm: number }): string {
  return `${String(item.lengthMm)} x ${String(item.widthMm)} x ${String(item.thicknessMm)} mm`
}

function partCode(parts: readonly Part[], id: string): string { return `P${String(parts.findIndex(part => part.id === id) + 1)}` }
function sheetFrame(page: PDFPage, font: PDFFont, project: string, title: string, scale: string, date: string): void {
  const width = page.getWidth() - margin * 2
  const bounded = (value: string, max: number) => {
    let text = value
    while (text.length && font.widthOfTextAtSize(text, 8) > max) text = text.slice(0, -1)
    return text === value ? text : `${text.slice(0, -3)}...`
  }
  page.drawRectangle({ x: margin - 8, y: 36, width: width + 16, height: page.getHeight() - 52, borderColor: muted, borderWidth: 0.5 })
  page.drawLine({ start: { x: margin - 8, y: 104 }, end: { x: page.getWidth() - margin + 8, y: 104 }, thickness: 0.5, color: muted })
  const left = width * 0.55
  for (const x of [margin + left, margin + left + (width - left) / 2]) page.drawLine({ start: { x, y: 36 }, end: { x, y: 104 }, thickness: 0.5, color: muted })
  drawLines(page, [`Project: ${bounded(project, left - 55)}`, bounded(title, left - 8)], font, margin, 86, 8)
  drawLines(page, [`Generated: ${date}`, `Scale ${scale}`, 'Units: mm'], font, margin + left + 8, 88, 8)
  if (scale !== 'N/A') page.drawText('Print: Actual size / 100%', { x: margin, y: 46, size: 8, font, color: muted })
}
function drawingTitleBlock(page: PDFPage, font: PDFFont, project: string, title: string, material: string, thickness: number, scale: string, date: string): void {
  sheetFrame(page, font, project, title, scale, date)
  page.drawText(`${material.length > 30 ? material.slice(0, 27) + '...' : material} / ${String(thickness)} mm`, { x: margin, y: 60, size: 8, font, color: muted })
}
function drawKerfs(page: PDFPage, document: CuttingPlanPdfDocument, transform: ReturnType<typeof technicalTransform>): void {
  for (const kerf of document.scene.kerfs) {
    const box = pdfRect(kerf, transform)
    if (box.width === 0 || box.height === 0) page.drawLine({ start: { x: box.x, y: box.y }, end: { x: box.x + box.width, y: box.y + box.height }, thickness: 0.4, color: muted })
    else page.drawRectangle({ ...box, color: rgb(0.38, 0.39, 0.37) })
  }
}
/** True PDF paths and text from the shared validated scene; no canvas/image dependency. */
function appendCuttingPlanPdf(pdf: PDFDocument, font: PDFFont, bold: PDFFont, document: CuttingPlanPdfDocument, heading = 'OptiCutList / Cutting plan', date = new Date().toISOString().slice(0, 10)): void {
  const size = pdfPageSize(document.pageSize ?? 'A4', document.orientation)
  const page = pdf.addPage([size.width, size.height])
  const contentWidth = size.width - 2 * margin
  let y = size.height - margin
  page.drawText(heading, { x: margin, y, size: 19, font: bold, color: ink }); y -= 24
  y = drawLines(page, wrapPdfText(`${document.edited ? 'Manually edited' : 'Optimized'} panel plan`, font, 10, contentWidth), font, margin, y)
  // Reserve the existing drawing-header footprint so metadata cleanup cannot change its physical scale.
  const panelHeader = `Panel: ${document.panel.name} / ${dimensions(document.panel)}`
  drawLines(page, wrapPdfText(panelHeader, font, 10, contentWidth), font, margin, y)
  y -= wrapPdfText(`Panel: ${document.panel.name} / ID: ${document.panel.id} / ${dimensions(document.panel)}`, font, 10, contentWidth).length * lineHeight
  drawLines(page, wrapPdfText(`Material: ${document.materialName}`, font, 10, contentWidth), font, margin, y)
  y -= wrapPdfText(`Material: ${document.materialName} / ID: ${document.panel.materialId}`, font, 10, contentWidth).length * lineHeight
  y = drawLines(page, wrapPdfText(`Panel grain: ${document.panel.grainDirection} / Kerf: ${String(document.settings.kerfMm)} mm / Edge margin: ${String(document.settings.edgeMarginMm)} mm`, font, 10, contentWidth), font, margin, y)
  const elsewhere = document.unplaced.filter(part => part.reason.kind === 'allocatedElsewhere').reduce((total, part) => total + part.count, 0)
  const unplacedCount = document.unplaced.reduce((total, part) => total + part.count, 0) - elsewhere
  y -= 6
  y = drawLines(page, wrapPdfText(`${String(document.scene.parts.length)} copies placed / ${String(unplacedCount)} copies unplaced${elsewhere ? ` / ${String(elsewhere)} copies on other panels` : ''} / Utilization: ${document.metrics.utilizationPercent.toFixed(2)}%`, bold, 11, contentWidth), bold, margin, y, 11)
  y = drawLines(page, wrapPdfText(`Waste: ${document.metrics.wasteAreaMm2.toLocaleString('en-US')} mm² (includes margins and kerf)`, font, 10, contentWidth), font, margin, y)
  const drawingArea = { x: margin + DIMENSION_CLEARANCE, y: 210, width: contentWidth - DIMENSION_CLEARANCE * 2, height: y - 226 }
  const initialTransform = technicalTransform(document.scene.panel, drawingArea)
  const needsCallouts = document.scene.parts.some(part => {
    const box = pdfRect(part.region, initialTransform)
    const label = `${partCode(document.parts, part.part.id)}.${String(part.copyIndex + 1)} / ${dimensions(part.dimensions)}`
    return box.height < 26 || font.widthOfTextAtSize(label, 8) > box.width - 8
  })
  if (needsCallouts) drawingArea.width -= 120
  const transform = technicalTransform(document.scene.panel, drawingArea)
  const panelBox = pdfRect(document.scene.panel, transform)
  for (const [index, waste] of document.scene.waste.entries()) {
    const box = pdfRect(waste, transform)
    drawWaste(page, box)
    const label = `W${String(index + 1)}`
    const labelWidth = font.widthOfTextAtSize(label, 7)
    if (box.width > labelWidth + 6 && box.height > 16) {
      const x = box.x + box.width / 2 - labelWidth / 2
      const y = box.y + box.height / 2 - 3
      page.drawRectangle({ x: x - 2, y: y - 2, width: labelWidth + 4, height: 11, color: rgb(1, 1, 1) })
      page.drawText(label, { x, y, size: 7, font, color: muted })
    }
  }
  const outside: { label: string; box: ReturnType<typeof pdfRect> }[] = []
  for (const part of document.scene.parts) {
    const box = pdfRect(part.region, transform)
    page.drawRectangle({ ...box, borderWidth: 0.5, borderColor: ink })
    const identifier = partCode(document.parts, part.part.id) + (part.part.quantity > 1 ? `.${String(part.copyIndex + 1)}` : '')
    const label = `${identifier} / ${dimensions(part.dimensions)}`
    if (box.height >= 26 && font.widthOfTextAtSize(label, 8) <= box.width - 8) {
      page.drawText(identifier, { x: box.x + 4, y: box.y + box.height - 12, size: 8, font: bold, color: rgb(0.14, 0.3, 0.21) })
      page.drawText(dimensions(part.dimensions), { x: box.x + 4, y: box.y + box.height - 23, size: 8, font, color: ink })
    } else outside.push({ label: `${identifier} / ${String(part.dimensions.lengthMm)} x ${String(part.dimensions.widthMm)} mm`, box })
    drawGrain(page, box, part.grain)
  }
  drawKerfs(page, document, transform)
  page.drawRectangle({ ...pdfRect(document.scene.usableArea, transform), borderColor: muted, borderWidth: 0.5, borderDashArray: [3, 3] })
  page.drawRectangle({ ...panelBox, borderColor: ink, borderWidth: 0.7 })
  drawDimensions(page, font, panelBox, document.panel.lengthMm, document.panel.widthMm)
  drawGrain(page, panelBox, document.panel.grainDirection)
  const labelsPerSheet = Math.max(1, Math.floor(drawingArea.height / 42))
  outside.sort((a, b) => b.box.y - a.box.y)
  for (const [index, item] of outside.slice(0, labelsPerSheet).entries()) {
    const labelY = drawingArea.y + drawingArea.height - index * 42
    const labelX = margin + contentWidth - 108
    page.drawLine({ start: { x: item.box.x + item.box.width / 2, y: item.box.y + item.box.height / 2 }, end: { x: labelX - 6, y: labelY + 2 }, thickness: 0.3, color: muted })
    drawLines(page, wrapPdfText(item.label, font, 8, 108), font, labelX, labelY, 8)
  }
  // Additional label sheets retain the same validated geometry and physical scale.
  for (let offset = labelsPerSheet; offset < outside.length; offset += labelsPerSheet) {
    const continuation = pdf.addPage([size.width, size.height])
    continuation.drawText(`${heading} / Labels continued`, { x: margin, y: size.height - margin, size: 13, font: bold, color: ink })
    drawLines(continuation, [`${dimensions(document.panel)} / Kerf: ${String(document.settings.kerfMm)} mm / Edge margin: ${String(document.settings.edgeMarginMm)} mm`, 'Diagonal hatch: waste / Dashed outline: usable area / Arrows: grain'], font, margin, size.height - margin - 22, 9)
    continuation.drawRectangle({ ...panelBox, borderColor: ink, borderWidth: 0.7 })
    for (const part of document.scene.parts) {
      const box = pdfRect(part.region, transform)
      continuation.drawRectangle({ ...box, borderColor: ink, borderWidth: 0.5 })
      drawGrain(continuation, box, part.grain)
    }
    drawKerfs(continuation, document, transform)
    continuation.drawRectangle({ ...pdfRect(document.scene.usableArea, transform), borderColor: muted, borderWidth: 0.5, borderDashArray: [3, 3] })
    drawGrain(continuation, panelBox, document.panel.grainDirection)
    for (const waste of document.scene.waste) drawWaste(continuation, pdfRect(waste, transform))
    for (const [index, item] of outside.slice(offset, offset + labelsPerSheet).entries()) {
      const labelY = drawingArea.y + drawingArea.height - index * 42
      const labelX = margin + contentWidth - 108
      continuation.drawLine({ start: { x: item.box.x + item.box.width / 2, y: item.box.y + item.box.height / 2 }, end: { x: labelX - 6, y: labelY + 2 }, thickness: 0.3, color: muted })
      drawLines(continuation, wrapPdfText(item.label, font, 8, 108), font, labelX, labelY, 8)
    }
    drawDimensions(continuation, font, panelBox, document.panel.lengthMm, document.panel.widthMm)
    drawingTitleBlock(continuation, font, document.projectName ?? 'Cutting plan', heading, document.materialName, document.panel.thicknessMm, scaleLabel(transform), date)
  }
  drawLines(page, [
    'Diagonal hatch: waste / Dashed outline: usable area / Outer band: margins',
    'Dark narrow band: saw kerf (zero kerf shown as a line) / Arrows: grain',
  ], font, margin, 144, 8)
  drawScaleBar(page, font, size.width - margin - 80, 128, transform)
  drawingTitleBlock(page, font, document.projectName ?? 'Cutting plan', heading, document.materialName, document.panel.thicknessMm, scaleLabel(transform), date)

  const tables = createPdfTables(pdf, font, bold, size, sheet => { sheetFrame(sheet, font, document.projectName ?? 'Cutting plan', 'Panel inventory', 'N/A', date) })
  tables.table('Placed parts - oriented dimensions, thickness and grain', [
    { label: 'Reference', weight: 1 }, { label: 'Name', weight: 2.2 }, { label: 'Dimensions / orientation', weight: 2 }, { label: 'Position (mm)', weight: 1.4 }, { label: 'Grain', weight: 1 },
  ], document.scene.parts.map(part => [partCode(document.parts, part.part.id) + '.' + String(part.copyIndex + 1), part.part.name, `${dimensions(part.dimensions)} / ${part.orientation === 'rotated' ? 'Rotated 90°' : 'Normal'}`, `${String(part.region.xMm)}, ${String(part.region.yMm)}`, part.grain]))
  if (document.unplaced.length) tables.table('Unplaced parts - not produced by this panel', [
    { label: 'Reference / name', weight: 2.5 }, { label: 'Copies', weight: 1.5 }, { label: 'Reason', weight: 3 },
  ], document.unplaced.map(missing => {
    const part = document.parts.find(part => part.id === missing.partId)
    const reason = missing.reason.kind === 'allocatedElsewhere' ? 'Allocated to another panel in the project'
      : missing.reason.kind === 'noSpaceLeft' ? 'No space left on this panel'
      : missing.reason.kind === 'remainderNarrowerThanKerf' ? 'Remainder cannot be cut with this kerf'
      : missing.reason.issues.map(issue => ({ materialMismatch: 'Material mismatch', thicknessMismatch: 'Exact thickness mismatch', noUsableArea: 'No usable area', grainRequiresRotation: 'Grain requires forbidden rotation', exceedsUsableArea: 'Exceeds usable panel size' })[issue.kind]).join('; ')
    return [`${partCode(document.parts, missing.partId)} / ${part?.name ?? 'Unavailable part'}`, `${String(missing.count)} starting at copy ${String(missing.firstCopyIndex + 1)}`, reason]
  }))
  tables.table('Waste regions / potential reusable offcuts', [
    { label: 'Reference', weight: 1 }, { label: 'Dimensions', weight: 2 }, { label: 'Material', weight: 2 }, { label: 'Position (mm)', weight: 1.5 }, { label: 'Grain', weight: 1 },
  ], document.scene.waste.map((region, index) => [`W${String(index + 1)}`, dimensions({ ...region, thicknessMm: document.panel.thicknessMm }), document.materialName, `${String(region.xMm)}, ${String(region.yMm)}`, document.panel.grainDirection]))
}

function materialName(document: ProjectCuttingPdfDocument, part: Part): string {
  return document.panels.find(panel => panel.panel.materialId === part.materialId)?.materialName ?? 'Material name unavailable'
}
function appendFabricationSections(pdf: PDFDocument, font: PDFFont, bold: PDFFont, document: ProjectCuttingPdfDocument, date: string): void {
  const size = pdfPageSize(document.pageSize ?? 'A4', document.orientation)
  const tables = createPdfTables(pdf, font, bold, size, page => { sheetFrame(page, font, document.title, 'Fabrication schedules', 'N/A', date) })
  const columns = [{ label: 'Reference', weight: 1 }, { label: 'Name', weight: 2.4 }, { label: 'Material', weight: 2 }, { label: 'Length', weight: 1, numeric: true }, { label: 'Width', weight: 1, numeric: true }, { label: 'Thickness', weight: 1.2, numeric: true }, { label: 'Quantity', weight: 1, numeric: true }]
  const describe = (part: Part) => [partCode(document.parts, part.id), part.name, materialName(document, part), String(part.lengthMm), String(part.widthMm), String(part.thicknessMm), String(part.quantity)]
  tables.table('Complete parts list', columns, document.parts.map(describe))
  const sources = new Map<string, { panel: CuttingPlanPdfDocument; count: number }>()
  for (const panel of document.panels) {
    const previous = sources.get(panel.panel.id)
    sources.set(panel.panel.id, { panel, count: (previous?.count ?? 0) + 1 })
  }
  const purchasing = purchasingSchedule([...sources.values()])
  tables.table('Materials and purchasing', [
    { label: 'Material', weight: 1.6 }, { label: 'Panel reference', weight: 2 }, { label: 'Dimensions (mm)', weight: 1.8 }, { label: 'Quantity', weight: 0.8, numeric: true }, { label: 'Supplier / provenance', weight: 1.6 }, { label: 'Unit price', weight: 1, numeric: true }, { label: 'Total price', weight: 1, numeric: true },
  ], purchasing)
  const materials = [...new Set(document.parts.map(part => part.materialId))]
  for (const id of materials) tables.table('Parts grouped by material / ' + (document.panels.find(panel => panel.panel.materialId === id)?.materialName ?? 'Material name unavailable'), columns, document.parts.filter(part => part.materialId === id).map(describe))
  if (!materials.length) tables.table('Parts grouped by material', columns, [])
  const orderedSources = [...sources.values()].sort((a, b) => a.panel.panel.materialId < b.panel.panel.materialId ? -1 : a.panel.panel.materialId > b.panel.panel.materialId ? 1 : 0)
  const inventory = createPdfTables(pdf, font, bold, size, page => { sheetFrame(page, font, document.title, 'Panel inventory', 'N/A', date) })
  for (const { panel } of orderedSources) {
    for (const [index, allocated] of document.panels.entries()) {
      if (allocated.panel.id !== panel.panel.id) continue
      const grouped = new Map<string, { name: string; dimensions: string; count: number }>()
      for (const placed of allocated.scene.parts) {
        const key = partCode(document.parts, placed.part.id) + '/' + placed.orientation
        const previous = grouped.get(key)
        grouped.set(key, { name: `${partCode(document.parts, placed.part.id)} / ${placed.part.name}`, dimensions: dimensions(placed.dimensions), count: (previous?.count ?? 0) + 1 })
      }
      inventory.table(`${panel.materialName} / ${panel.panel.name} / Panel ${String(index + 1)}`, [{ label: 'Allocated part', weight: 3 }, { label: 'Dimensions (mm)', weight: 2 }, { label: 'Quantity', weight: 1, numeric: true }], [...grouped.values()].map(part => [part.name, part.dimensions, String(part.count)]))
    }
  }
  appendPartDrawings(pdf, font, bold, document.parts, document.pageSize ?? 'A4', document.orientation, part => materialName(document, part), page => { sheetFrame(page, font, document.title, 'Individual part drawings', 'Per drawing', date) })
}
async function finishPdf(pdf: PDFDocument, font: PDFFont): Promise<Uint8Array<ArrayBuffer>> {
  for (const [index, current] of pdf.getPages().entries()) current.drawText(`Sheet ${String(index + 1)} / ${String(pdf.getPageCount())}`, { x: current.getWidth() - margin - (current.getWidth() - margin * 2) * 0.2, y: 67, size: 9, font, color: ink })
  pdf.setTitle('OptiCutList cutting plan')
  pdf.setProducer('OptiCutList / pdf-lib')
  return new Uint8Array(await pdf.save())
}
async function renderCuttingPlanPdf(document: CuttingPlanPdfDocument): Promise<Uint8Array<ArrayBuffer>> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  appendCuttingPlanPdf(pdf, font, bold, document)
  return finishPdf(pdf, font)
}
export async function generateProjectCuttingPdf(document: ProjectCuttingPdfDocument): Promise<Uint8Array<ArrayBuffer>> {
  return withFontErrors(async () => {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
    const date = new Date().toISOString().slice(0, 10)
    const size = pdfPageSize(document.pageSize ?? 'A4', document.orientation)
    let page = pdf.addPage([size.width, size.height])
    sheetFrame(page, font, document.title, 'Project summary', 'N/A', date)
    let y = size.height - margin
    function row(text: string, heading = false): void {
      const selected = heading ? bold : font
      for (const line of wrapPdfText(text, selected, heading ? 14 : 10, size.width - 2 * margin)) {
        if (y < 120) { page = pdf.addPage([size.width, size.height]); sheetFrame(page, font, document.title, 'Project summary', 'N/A', date); y = size.height - margin }
        y = drawLines(page, [line], selected, margin, y, heading ? 14 : 10)
      }
      y -= 8
    }
    row('OptiCutList / Project cutting result', true)
    row(document.title)
    row(`${String(document.panels.length)} panels / ${String(document.metrics.placedCount)} copies placed / ${String(document.metrics.unplacedCount)} copies unplaced`)
    row(document.metrics.unplacedCount ? 'INCOMPLETE - unplaced parts are not produced by these layouts.' : 'All requested copies are placed.')
    row(`Utilization: ${document.metrics.utilizationPercent.toFixed(2)}% / Waste: ${document.metrics.wasteAreaMm2.toLocaleString('en-US')} mm² (including kerf and margins)`)
    row('Unplaced project parts', true)
    if (!document.unplaced.length) row('None.')
    const reasons = { noCompatiblePanel: 'No compatible selected panel', constraintsPreventPlacement: 'Dimensions, grain, rotation, kerf or margins prevent placement', panelLimitReached: 'Insufficient panel quantity or remaining usable space' }
    for (const missing of document.unplaced) {
      const part = document.parts.find(part => part.id === missing.partId)
      row(`${part?.name ?? 'Unavailable part'} / ${String(missing.count)} copies starting at ${String(missing.firstCopyIndex + 1)}${part ? ` / ${dimensions(part)}` : ''} / ${reasons[missing.reason]}`)
    }
    appendFabricationSections(pdf, font, bold, document, date)
    document.panels.forEach((panel, index) => { appendCuttingPlanPdf(pdf, font, bold, panel, `OptiCutList / Panel ${String(index + 1)} of ${String(document.panels.length)}`, date) })
    return finishPdf(pdf, font)
  })
}
async function withFontErrors(work: () => Promise<Uint8Array<ArrayBuffer>>): Promise<Uint8Array<ArrayBuffer>> {
  try { return await work() }
  catch (cause) {
    if (cause instanceof Error && cause.message.includes('WinAnsi cannot encode')) throw new Error('A name contains characters unsupported by the built-in PDF font. Use Latin-script names for this export; no characters have been replaced.', { cause })
    throw cause
  }
}

export async function generateCuttingPlanPdf(document: CuttingPlanPdfDocument): Promise<Uint8Array<ArrayBuffer>> {
  return withFontErrors(() => renderCuttingPlanPdf(document))
}
