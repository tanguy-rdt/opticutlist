import { inject, type InjectionKey } from 'vue'
import type { CatalogTransferService } from '../../application/catalog/catalog-transfer-service'
export const catalogTransferServiceKey: InjectionKey<CatalogTransferService> = Symbol('catalogTransferService')

export function useCatalogTransferService(): CatalogTransferService | undefined {
  return inject(catalogTransferServiceKey, undefined)
}
