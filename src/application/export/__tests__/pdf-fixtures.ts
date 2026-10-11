import type { CuttingPlanPdfRequest } from '../cutting-plan-pdf-service'
import { rotationInput, rotationPlan } from '../../../domain/cutting-tree/__tests__/editing-fixtures'

export const pdfRequest: CuttingPlanPdfRequest = { ...rotationInput, plan: rotationPlan, materialName: 'Birch plywood', orientation: 'landscape', edited: false }
