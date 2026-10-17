import { rgb, type PDFPage } from 'pdf-lib'

export type SheetNumberPosition = { x: number; y: number; width: number; fontSize: number; bold?: boolean }


export const technicalInk = rgb(0.14, 0.14, 0.14)
export const technicalRule = rgb(0.5, 0.5, 0.5)
export const technicalTextSize = 8
export const technicalLineHeight = 10

/** Shared print frame; all measurements here are PDF points, never source geometry. */
export function drawTechnicalFrame(page: PDFPage): void {
  page.drawRectangle({ x: 28, y: 36, width: page.getWidth() - 56, height: page.getHeight() - 52, borderColor: technicalRule, borderWidth: 0.5 })
}
