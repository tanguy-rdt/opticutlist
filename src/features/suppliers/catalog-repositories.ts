import { inject, type InjectionKey } from 'vue'
import type { Repository } from '../../application/persistence/repositories'
import type { StockItem } from '../../domain/model/stock-item'
import type { Supplier } from '../../domain/model/supplier'
import type { SupplierProduct } from '../../domain/model/supplier-product'

export const catalogStockRepositoryKey: InjectionKey<Pick<Repository<StockItem>, 'list'>> = Symbol('catalogStockRepository')
export function useCatalogStockRepository() { return inject(catalogStockRepositoryKey, undefined) }

export const supplierRepositoryKey: InjectionKey<Repository<Supplier>> = Symbol('supplierRepository')
export const supplierProductRepositoryKey: InjectionKey<Repository<SupplierProduct>> = Symbol('supplierProductRepository')

export function useCatalogRepositories() {
  const suppliers = inject(supplierRepositoryKey)
  const supplierProducts = inject(supplierProductRepositoryKey)
  if (suppliers === undefined || supplierProducts === undefined) throw new Error('Catalog repositories were not provided')
  return { suppliers, supplierProducts }
}
