import type { CuttingProjectId, MaterialId } from '../../domain/model/ids'
import { partIdSchema } from '../../domain/model/ids'
import type { Material } from '../../domain/model/material'
import type { LocalPersistence, PersistenceResult } from '../persistence/repositories'
import { createProjectService } from './project-service'
import { projectPartMaterialIds } from './part-materials'
import { invalidTransfer, type ProjectJsonPort } from './project-transfer-format'
import { validatePartsTransfer, type PartsTransfer } from './parts-transfer-format'

export interface PartsImportPreview {
  readonly file: PartsTransfer
  readonly materials: readonly Material[]
  readonly materialIds: readonly (MaterialId | null)[]
}
export function createPartsTransferService(persistence: LocalPersistence, json: ProjectJsonPort) {
  const projects = createProjectService(persistence)
  function parse(text: string): PersistenceResult<PartsTransfer> {
    try { return validatePartsTransfer(json.parse(text)) }
    catch { return invalidTransfer('The file is not valid JSON.') }
  }
  return {
    export(projectId: CuttingProjectId): Promise<PersistenceResult<{ text: string; name: string }>> {
      return persistence.transaction(async repositories => {
        const project = await repositories.projects.get(projectId); if (!project.ok) return project
        const owners = await repositories.projects.list(); if (!owners.ok) return owners
        if (owners.value.some(other => other.id !== projectId && other.partIds.some(id => project.value.partIds.includes(id)))) return invalidTransfer('Part ownership is inconsistent.')
        const parts: PartsTransfer['parts'] = []
        for (const id of project.value.partIds) {
          const record = await repositories.parts.get(id); if (!record.ok) return record
          const part = record.value
          const material = await repositories.materials.get(part.materialId); if (!material.ok) return material
          parts.push({ name: part.name, material: material.value.name, length: part.lengthMm, width: part.widthMm, thickness: part.thicknessMm, quantity: part.quantity, grainDirection: part.grainDirection, rotation: part.rotation })
        }
        const validated = validatePartsTransfer({ format: 'opticutlist-parts', version: 1, parts }); if (!validated.ok) return validated
        try { return { ok: true, value: { text: json.stringify(validated.value), name: `${project.value.name}-parts` } } }
        catch { return invalidTransfer('Parts could not be serialized.') }
      })
    },
    preview(projectId: CuttingProjectId, text: string): Promise<PersistenceResult<PartsImportPreview>> {
      const parsed = parse(text); if (!parsed.ok) return Promise.resolve(parsed)
      return persistence.transaction(async repositories => {
        const project = await repositories.projects.get(projectId); if (!project.ok) return project
        const materials = await repositories.materials.list(); if (!materials.ok) return materials
        const products = await repositories.supplierProducts.list(); if (!products.ok) return products
        const stock = await repositories.stockItems.list(); if (!stock.ok) return stock
        const ids = projectPartMaterialIds(project.value, products.value, stock.value)
        const available = materials.value.filter(material => ids.includes(material.id))
        return { ok: true, value: { file: parsed.value, materials: available, materialIds: parsed.value.parts.map(part => { const matches = available.filter(material => material.name === part.material); return matches.length === 1 ? matches[0]?.id ?? null : null }) } }
      })
    },
    import(projectId: CuttingProjectId, file: unknown, materialIds: readonly (MaterialId | null)[], confirmed: boolean): Promise<PersistenceResult<number>> {
      if (!confirmed) return Promise.resolve(invalidTransfer('Confirm the import before adding Parts.'))
      const validated = validatePartsTransfer(file); if (!validated.ok) return Promise.resolve(validated)
      if (materialIds.length !== validated.value.parts.length || materialIds.some(id => id === null)) return Promise.resolve(invalidTransfer('Choose an eligible project material for every imported Part.'))
      const records = validated.value.parts.map((part, index) => ({ id: partIdSchema.parse(crypto.randomUUID()), name: part.name, materialId: materialIds[index], lengthMm: part.length, widthMm: part.width, thicknessMm: part.thickness, quantity: part.quantity, grainDirection: part.grainDirection, rotation: part.rotation }))
      return projects.parts(projectId).createMany(records).then(result => result.ok ? { ok: true, value: result.value.length } : result)
    },
  }
}
export type PartsTransferService = ReturnType<typeof createPartsTransferService>
