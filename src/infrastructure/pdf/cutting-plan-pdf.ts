import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { CuttingPlanPdfDocument, ProjectCuttingPdfDocument } from '../../application/export/cutting-plan-pdf-service'
import { DIMENSION_CLEARANCE, drawDimensions, drawGrain, drawScaleBar, drawWaste, scaleLabel, technicalTransform } from './technical-drawing'
import type { Part } from '../../domain/model/part'
import { pdfPageSize, pdfRect } from './pdf-layout'

const ink = rgb(0.12, 0.15, 0.17)
const muted = rgb(0.35, 0.38, 0.4)
const margin = 36
const lineHeight = 14

/** Wrap even long IDs, measure with the embedded font, and never silently drop unsupported glyphs. */
export function wrapPdfText(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/u)) {
    let line = ''
    for (const word of paragraph.split(/\s+/u).filter(Boolean)) {
      if (line && font.widthOfTextAtSize(`${line} ${word}`, size) <= width) { line += ` ${word}`; continue }
      if (line) { lines.push(line); line = '' }
      for (const character of word) {
        if (font.widthOfTextAtSize(character, size) > width) throw new Error('The PDF text area is too narrow.')
        if (line && font.widthOfTextAtSize(line + character, size) > width) { lines.push(line); line = '' }
        line += character
      }
    }
    lines.push(line)
  }
  return lines
}
function drawLines(page: PDFPage, lines: readonly string[], font: PDFFont, x: number, y: number, size = 10): number {
  for (const text of lines) { page.drawText(text, { x, y, size, font, color: ink }); y -= lineHeight }
  return y
}
function dimensions(item: { lengthMm: number; widthMm: number; thicknessMm: number }): string {
  return `${String(item.lengthMm)} x ${String(item.widthMm)} x ${String(item.thicknessMm)} mm`
}

function partCode(parts: readonly Part[], id: string): string { return `P${String(parts.findIndex(part => part.id === id) + 1)}` }
function drawingTitleBlock(page: PDFPage, font: PDFFont, project: string, title: string, identifier: string, material: string, thickness: number, scale: string, date: string): void {
  const width = page.getWidth() - margin * 2
  // Full metadata is readable on the paginated lists; the block uses bounded single-line fields.
  const bounded = (value: string, max: number) => {
    let text = value
    while (text.length && font.widthOfTextAtSize(text, 8) > max) text = text.slice(0, -1)
    return text === value ? text : `${text.slice(0, -3)}...`
  }
  page.drawRectangle({ x: margin, y: 36, width, height: 68, borderColor: muted, borderWidth: 0.5 })
  drawLines(page, [`Project: ${bounded(project, width / 2 - 40)} / Drawing: ${bounded(title, width / 2 - 55)}`, `Identifier: ${bounded(identifier, 100)} / Material: ${bounded(material, width - 295)} / Thickness: ${String(thickness)} mm`, `Scale ${scale} / Generated: ${date} / Dimensions: mm`, 'Print: Actual size / 100%. Viewer zoom does not change the drawing scale.'], font, margin + 8, 89, 8)
  page.drawText(`Sheet ${String(page.doc.getPages().indexOf(page) + 1)}`, { x: page.getWidth() - margin - 65, y: 47, size: 8, font, color: ink })
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
  y = drawLines(page, wrapPdfText(`${document.edited ? 'Manually edited' : 'Optimized'} panel plan - independently validated`, font, 10, contentWidth), font, margin, y)
  y = drawLines(page, wrapPdfText(`Panel: ${document.panel.name} / ID: ${document.panel.id} / ${dimensions(document.panel)}`, font, 10, contentWidth), font, margin, y)
  y = drawLines(page, wrapPdfText(`Material: ${document.materialName} / ID: ${document.panel.materialId}`, font, 10, contentWidth), font, margin, y)
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
    drawingTitleBlock(continuation, font, document.projectName ?? 'Cutting plan', heading, document.panel.id, document.materialName, document.panel.thicknessMm, scaleLabel(transform), date)
  }
  drawLines(page, [
    'Diagonal hatch: waste / Dashed outline: usable area / Outer band: margins',
    'Dark narrow band: saw kerf (zero kerf shown as a line) / Arrows: grain',
    'Coordinates: length left to right, width top to bottom. No inferred cut sequence.',
  ], font, margin, 144, 8)
  drawScaleBar(page, font, size.width - margin - 80, 128, transform)
  drawingTitleBlock(page, font, document.projectName ?? 'Cutting plan', heading, document.panel.id, document.materialName, document.panel.thicknessMm, scaleLabel(transform), date)

  // Full names, IDs and all unplaced demand remain readable even when diagram labels cannot fit.
  let details = pdf.addPage([size.width, size.height])
  let rowY = size.height - margin
  function newDetailsPage(): void {
    details = pdf.addPage([size.width, size.height]); rowY = size.height - margin
    details.drawText('Cutting plan / Details continued', { x: margin, y: rowY, size: 14, font: bold, color: ink }); rowY -= 24
  }
  function row(text: string, heading = false): void {
    const selectedFont = heading ? bold : font
    const lines = wrapPdfText(text, selectedFont, 10, contentWidth)
    if (rowY - lines.length * lineHeight < 50) newDetailsPage()
    rowY = drawLines(details, lines, selectedFont, margin, rowY) - 6
  }
  row('Placed parts - oriented dimensions, thickness and grain', true)
  if (document.scene.parts.length === 0) row('No parts were placed on this panel.')
  for (const part of document.scene.parts) row(`${partCode(document.parts, part.part.id)} / ${part.part.name} / Copy ${String(part.copyIndex + 1)} / ID: ${part.part.id}\n${dimensions(part.dimensions)} / ${part.orientation === 'rotated' ? 'Rotated 90°' : 'Normal'} / Grain in panel axes: ${part.grain}\nOriginal grain: ${part.part.grainDirection} / Rotation: ${part.part.rotation} / Position: ${String(part.region.xMm)}, ${String(part.region.yMm)} mm`)
  row('Unplaced parts - not produced by this panel', true)
  if (document.unplaced.length === 0) row('None. All requested copies are placed on this panel.')
  for (const missing of document.unplaced) {
    const part = document.parts.find(part => part.id === missing.partId)
    const reason = missing.reason.kind === 'allocatedElsewhere' ? 'Allocated to another panel in the project'
      : missing.reason.kind === 'noSpaceLeft' ? 'No space left on this panel'
      : missing.reason.kind === 'remainderNarrowerThanKerf' ? 'Remainder cannot be cut with this kerf'
        : missing.reason.issues.map(issue => ({ materialMismatch: 'Material mismatch', thicknessMismatch: 'Exact thickness mismatch', noUsableArea: 'No usable area', grainRequiresRotation: 'Grain requires forbidden rotation', exceedsUsableArea: 'Exceeds usable panel size' })[issue.kind]).join('; ')
    row(`${part?.name ?? missing.partId} / ID: ${missing.partId}\n${String(missing.count)} unplaced copies, starting at copy ${String(missing.firstCopyIndex + 1)}${part === undefined ? '' : ` / ${dimensions(part)}`}\nReason: ${reason}`)
  }
  row('Waste regions / potential reusable offcuts', true)
  if (!document.scene.waste.length) row('No waste leaves.')
  document.scene.waste.forEach((region, index) => {
    row(`W${String(index + 1)} / ${dimensions({ ...region, thicknessMm: document.panel.thicknessMm })} / ${document.materialName}\nSource panel: ${document.panel.id} / Position: ${String(region.xMm)}, ${String(region.yMm)} mm / Grain: ${document.panel.grainDirection}`)
  })
  row('Offcuts are candidates only. Nothing is retained or added to physical stock by PDF export.')
  row('Panel layout only. See the project summary for total unplaced demand. Export does not purchase or consume inventory. Print at Actual size / 100% to retain the stated drawing scale.')
}
function materialName(document: ProjectCuttingPdfDocument, part: Part): string {
  return document.panels.find(panel => panel.panel.materialId === part.materialId)?.materialName ?? `Material name unavailable / ID: ${part.materialId}`
}
function appendFabricationSections(pdf: PDFDocument, font: PDFFont, bold: PDFFont, document: ProjectCuttingPdfDocument, date: string): void {
  const size = pdfPageSize(document.pageSize ?? 'A4', document.orientation)
  const width = size.width - margin * 2
  function list(title: string, rows: readonly string[]): void {
    let page = pdf.addPage([size.width, size.height])
    let y = size.height - margin
    const heading = () => { page.drawText(title, { x: margin, y, font: bold, size: 16, color: ink }); y -= 26 }
    heading()
    for (const row of rows.length ? rows : ['None.']) {
      for (const line of wrapPdfText(row, font, 10, width)) {
        if (y < 60) { page = pdf.addPage([size.width, size.height]); y = size.height - margin; heading() }
        y = drawLines(page, [line], font, margin, y)
      }
      y -= 8
    }
  }
  const describe = (part: Part) => `${partCode(document.parts, part.id)} / ${part.name} / ID: ${part.id}\n${dimensions(part)} / Quantity: ${String(part.quantity)} / ${materialName(document, part)} / Grain: ${part.grainDirection} / Rotation: ${part.rotation}`
  list('Complete parts list', document.parts.map(describe))
  const sources = new Map<string, { panel: CuttingPlanPdfDocument; count: number }>()
  for (const panel of document.panels) {
    const previous = sources.get(panel.panel.id)
    sources.set(panel.panel.id, { panel, count: (previous?.count ?? 0) + 1 })
  }
  list('Materials and purchasing', [
    'Planning panel references only. No purchase or stock consumption is performed. Prices and ordering data are not stored in historical cutting plans.',
    ...[...sources.values()].map(({ panel, count }) => `${panel.materialName} / ${panel.panel.name} / Reference: ${panel.panel.id}\n${dimensions(panel.panel)} / ${String(count)} panels used / ${panel.panel.stockItemId ? `Owned stock: ${panel.panel.stockItemId}` : `Supplier: ${panel.supplierName ?? 'Unavailable in this historical plan'}`}`),
  ])
  const materials = [...new Set(document.parts.map(part => part.materialId))]
  for (const id of materials) list('Parts grouped by material', document.parts.filter(part => part.materialId === id).map(describe))
  if (!materials.length) list('Parts grouped by material', [])
  for (const part of document.parts) {
    const page = pdf.addPage([size.width, size.height])
    const identifier = partCode(document.parts, part.id)
    let y = size.height - margin
    page.drawText(`${identifier} / Individual part drawing`, { x: margin, y, font: bold, size: 16, color: ink }); y -= 28
    y = drawLines(page, wrapPdfText(`${part.name} / ID: ${part.id}`, font, 10, width), font, margin, y)
    y = drawLines(page, wrapPdfText(`Material: ${materialName(document, part)} / Thickness: ${String(part.thicknessMm)} mm / Quantity: ${String(part.quantity)} / Grain: ${part.grainDirection} / Rotation: ${part.rotation}`, font, 10, width), font, margin, y)
    const rect = { xMm: 0, yMm: 0, lengthMm: part.lengthMm, widthMm: part.widthMm }
    const transform = technicalTransform(rect, { x: margin + DIMENSION_CLEARANCE, y: 170, width: width - DIMENSION_CLEARANCE * 2, height: y - 190 })
    const box = pdfRect(rect, transform)
    page.drawRectangle({ ...box, borderColor: ink, borderWidth: 0.6 })
    drawDimensions(page, font, box, part.lengthMm, part.widthMm)
    drawGrain(page, box, part.grainDirection)
    drawScaleBar(page, font, margin, 127, transform)
    drawingTitleBlock(page, font, document.title, `${identifier} / ${part.name}`, identifier, materialName(document, part), part.thicknessMm, scaleLabel(transform), date)
  }
}
async function finishPdf(pdf: PDFDocument, font: PDFFont): Promise<Uint8Array<ArrayBuffer>> {
  for (const [index, current] of pdf.getPages().entries()) current.drawText(`OptiCutList / ${String(index + 1)} of ${String(pdf.getPageCount())}`, { x: margin, y: 24, size: 9, font, color: muted })
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
    let y = size.height - margin
    function row(text: string, heading = false): void {
      const selected = heading ? bold : font
      for (const line of wrapPdfText(text, selected, heading ? 14 : 10, size.width - 2 * margin)) {
        if (y < 50) { page = pdf.addPage([size.width, size.height]); y = size.height - margin }
        y = drawLines(page, [line], selected, margin, y, heading ? 14 : 10)
      }
      y -= 8
    }
    row('OptiCutList / Project cutting result', true)
    row(document.title)
    row(`${String(document.panels.length)} panels / ${String(document.metrics.placedCount)} copies placed / ${String(document.metrics.unplacedCount)} copies unplaced`)
    row(document.metrics.unplacedCount ? 'INCOMPLETE - unplaced parts are not produced by these layouts.' : 'All requested copies are placed.')
    row(`Utilization: ${document.metrics.utilizationPercent.toFixed(2)}% / Waste: ${document.metrics.wasteAreaMm2.toLocaleString('en-US')} mm² (including kerf and margins)`)
    row('Panel layouts', true)
    document.panels.forEach((panel, index) => { row(`Panel ${String(index + 1)}: ${panel.panel.name} / ${dimensions(panel.panel)} / ${panel.materialName} / Grain: ${panel.panel.grainDirection} / Kerf: ${String(panel.settings.kerfMm)} mm / Margin: ${String(panel.settings.edgeMarginMm)} mm${panel.edited ? ' / Accepted manual edits' : ''}`) })
    row('Unplaced project parts', true)
    if (!document.unplaced.length) row('None.')
    const reasons = { noCompatiblePanel: 'No compatible selected panel', constraintsPreventPlacement: 'Dimensions, grain, rotation, kerf or margins prevent placement', panelLimitReached: 'Insufficient panel quantity or remaining usable space' }
    for (const missing of document.unplaced) {
      const part = document.parts.find(part => part.id === missing.partId)
      row(`${part?.name ?? missing.partId} / ID: ${missing.partId} / ${String(missing.count)} copies starting at ${String(missing.firstCopyIndex + 1)}${part ? ` / ${dimensions(part)}` : ''} / ${reasons[missing.reason]}`)
    }
    row('PDF generation does not change inventory. Physical cutting requires separate explicit stock confirmation.')
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
