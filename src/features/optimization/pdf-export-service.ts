import { inject, type InjectionKey } from 'vue'
import type { CuttingPlanPdfService } from '../../application/export/cutting-plan-pdf-service'

export const cuttingPlanPdfServiceKey: InjectionKey<CuttingPlanPdfService> = Symbol('cuttingPlanPdfService')
export function useCuttingPlanPdfService(): CuttingPlanPdfService | undefined { return inject(cuttingPlanPdfServiceKey, undefined) }

/** Browser download only; generation and validation belong to the application service. */
export function downloadCuttingPlanPdf(bytes: Uint8Array<ArrayBuffer>): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = 'opticutlist-cutting-plan.pdf'
    document.body.append(link)
    link.click()
  } finally {
    link.remove()
    // Allow the browser to begin reading the Blob before revoking its temporary URL.
    window.setTimeout(() => { URL.revokeObjectURL(url) }, 1000)
  }
}
