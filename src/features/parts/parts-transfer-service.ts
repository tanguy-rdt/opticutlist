import { inject, type InjectionKey } from 'vue'
import type { PartsTransferService } from '../../application/projects/parts-transfer-service'
export const partsTransferServiceKey: InjectionKey<PartsTransferService> = Symbol('partsTransferService')

export function usePartsTransferService() {
  return inject(partsTransferServiceKey, undefined)
}
