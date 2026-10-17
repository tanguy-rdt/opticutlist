import { inject, type InjectionKey } from 'vue'
import type { StockTransferService } from '../../application/inventory/stock-transfer-service'
export const stockTransferServiceKey: InjectionKey<StockTransferService> = Symbol('stockTransferService')

export function useStockTransferService(): StockTransferService | undefined {
  return inject(stockTransferServiceKey, undefined)
}
