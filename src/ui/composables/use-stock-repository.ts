import { inject, type InjectionKey } from 'vue'
import type { StockRepository } from '@/application/inventory/stock-repository'
export const stockRepositoryKey: InjectionKey<StockRepository> = Symbol('stockRepository')

export function useStockRepository() {
  return inject(stockRepositoryKey, undefined)
}
