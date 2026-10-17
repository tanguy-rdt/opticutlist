import type { PDFFont, PDFPage } from 'pdf-lib'
import { drawTechnicalTitleBlock, technicalTitleBlockLayout } from './technical-title-block'

export const layoutPartTitleBlock = technicalTitleBlockLayout

export function drawPartTitleBlock(page: PDFPage, font: PDFFont, bold: PDFFont, block: ReturnType<typeof layoutPartTitleBlock>, projectName: string) {
  return drawTechnicalTitleBlock(page, font, bold, block, { projectName, context: { label: 'UNITS', lines: ['Millimeters (mm)'] }, scale: 'N/A' })
}
