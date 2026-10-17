import { inject, type InjectionKey } from 'vue'
import type { CuttingPlanPdfService } from '@/application/export/cutting-plan-pdf-service'

export const cuttingPlanPdfServiceKey: InjectionKey<CuttingPlanPdfService> = Symbol('cuttingPlanPdfService')

export function useCuttingPlanPdfService(): CuttingPlanPdfService | undefined {
  return inject(cuttingPlanPdfServiceKey, undefined)
}

/** Browser download only; generation and validation belong to the application service. */
export function downloadCuttingPlanPdf(bytes: Uint8Array<ArrayBuffer>): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const link = document.createElement('a')
  let timer: ReturnType<typeof setTimeout> | undefined
  const release = () => {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
    window.removeEventListener('pagehide', release)
    URL.revokeObjectURL(url)
  }
  try {
    link.href = url
    link.download = 'opticutlist-cutting-plan.pdf'
    document.body.append(link)
    link.click()
    // Native downloads have no completion event. Retain the URL for a generous reading
    // window, with document-exit cleanup as well; the browser controls final saving.
    window.addEventListener('pagehide', release, { once: true })
    timer = setTimeout(release, 60_000)
  } catch (cause) {
    release();
    throw cause
  }
  finally {
    link.remove()
  }
}

/** Decode through the configured application service, keeping the concrete adapter out of UI. */
export async function readCoverImage(file: Blob, service?: CuttingPlanPdfService) {
  if (!service?.readCoverImage) {
    throw new Error('Cover image validation is unavailable.')
  }
  return service.readCoverImage(file)
}
