import { inject, type InjectionKey } from 'vue'
import type { CuttingConfirmationService } from '../../application/inventory/cutting-confirmation-service'
export const cuttingConfirmationServiceKey: InjectionKey<CuttingConfirmationService> = Symbol('cuttingConfirmationService')
export function useCuttingConfirmationService(): CuttingConfirmationService | undefined { return inject(cuttingConfirmationServiceKey, undefined) }
