import { readTransferRecords } from '../catalog/read-transfer-records'
import type { CuttingProject } from '../../domain/model/cutting-project'
import type { CuttingProjectId } from '../../domain/model/ids'
import type { Persistence, PersistenceResult } from '../persistence/repositories'
import { readSavedPlan } from '../plans/saved-plan-service'
import { remapProjectTransfer } from './remap-project-transfer'
import { invalidTransfer, validateProjectTransfer, type ProjectJsonPort, type ProjectTransfer } from './project-transfer-format'

export interface ImportPreview { readonly file: ProjectTransfer; readonly projectIdCollision: boolean; readonly catalogConflicts: number; readonly reusedCatalogRecords: number }

export function createProjectTransferService(persistence: Persistence, json: ProjectJsonPort) {
  function parse(text: string): PersistenceResult<ProjectTransfer> {
    try {
      return validateProjectTransfer(json.parse(text))
    } catch (cause) {
      return invalidTransfer(cause instanceof Error ? cause.message : 'The JSON file could not be read.')
    }
  }

  return {
    export(projectId: CuttingProjectId): Promise<PersistenceResult<{ text: string; name: string }>> {
      return persistence.transaction(async repositories => {
        const project = await repositories.projects.get(projectId);
        if (!project.ok) {
          return project
        }
        const owners = await repositories.projects.list();
        if (!owners.ok) {
          return owners
        }
        if (owners.value.some(other => other.id !== projectId && other.partIds.some(id => project.value.partIds.includes(id)))) {
          return invalidTransfer('Stored Part ownership conflicts with another project.')
        }
        const parts: ProjectTransfer['parts'] = []
        for (const id of project.value.partIds) {
          const record = await repositories.parts.get(id);
          if (!record.ok) {
            return record;
          }
          parts.push(record.value)
        }
        const products: ProjectTransfer['catalog']['products'] = []
        for (const id of project.value.supplierProductIds) {
          const record = await repositories.supplierProducts.get(id);
          if (!record.ok) {
            return record;
          }
          products.push(record.value)
        }
        const materials: ProjectTransfer['catalog']['materials'] = []
        for (const id of new Set([...project.value.materialIds, ...parts.map(part => part.materialId), ...products.map(product => product.materialId)])) {
          const record = await repositories.materials.get(id);
          if (!record.ok) {
            return record;
          }
          materials.push(record.value)
        }
        const suppliers: ProjectTransfer['catalog']['suppliers'] = []
        for (const id of new Set(products.map(product => product.supplierId))) {
          const record = await repositories.suppliers.get(id);
          if (!record.ok) {
            return record;
          }
          suppliers.push(record.value)
        }
        const summaries = await repositories.savedPlanSummaries.listForProject(projectId);
        if (!summaries.ok) {
          return summaries
        }
        const savedPlans: ProjectTransfer['savedPlans'] = []
        for (const summary of summaries.value) {
          const saved = await readSavedPlan(repositories, projectId, summary.id);
          if (!saved.ok) {
            return saved;
          }
          savedPlans.push({ summary: saved.value.summary, contents: saved.value.contents })
        }
        const current = await repositories.currentCuttingResults.find(projectId);
        if (!current.ok) {
          return current
        }
        const validated = validateProjectTransfer({
          format: 'opticutlist-project',
          schemaVersion: 1,
          project: project.value,
          parts,
          catalog: { materials, suppliers, products },
          savedPlans,
          ...(current.value === null ? {} : { currentResultId: current.value.planId })
        })
        if (!validated.ok) {
          return validated
        }
        try {
          return { ok: true, value: { text: json.stringify(validated.value), name: project.value.name } }
        } catch (cause) {
          return invalidTransfer(cause instanceof Error ? cause.message : 'Project serialization failed.')
        }
      })
    },
    preview(text: string): Promise<PersistenceResult<ImportPreview>> {
      const file = parse(text);
      if (!file.ok) {
        return Promise.resolve(file)
      }
      return persistence.transaction(async repositories => {
        const records = await readTransferRecords(repositories);
        if (!records.ok) {
          return records
        }
        const mapped = remapProjectTransfer(file.value, records.value)
        const imported = [...file.value.catalog.materials, ...file.value.catalog.suppliers, ...file.value.catalog.products]
        const remapped = [...mapped.catalog.materials, ...mapped.catalog.suppliers, ...mapped.catalog.products]
        const reused = mapped.catalog.materials.filter(record => records.value.materials.some(item => item.id === record.id)).length + mapped.catalog.suppliers.filter(record => records.value.suppliers.some(item => item.id === record.id)).length + mapped.catalog.products.filter(record => records.value.products.some(item => item.id === record.id)).length
        return {
          ok: true,
          value: {
            file: file.value,
            projectIdCollision: records.value.projects.includes(file.value.project.id),
            catalogConflicts: imported.filter((record, index) => remapped[index]?.id !== record.id).length,
            reusedCatalogRecords: reused
          }
        }
      })
    },
    import(input: unknown, confirmed: boolean): Promise<PersistenceResult<CuttingProject>> {
      if (!confirmed) {
        return Promise.resolve(invalidTransfer('Explicit confirmation is required before importing a project.'))
      }
      const file = validateProjectTransfer(input);
      if (!file.ok) {
        return Promise.resolve(file)
      }
      return persistence.transaction(async repositories => {
        const records = await readTransferRecords(repositories);
        if (!records.ok) {
          return records
        }
        const mapped = validateProjectTransfer(remapProjectTransfer(file.value, records.value));
        if (!mapped.ok) {
          return mapped
        }
        // All relations have already passed validation. Insert-only writes plus this shared
        // transaction establish ownership/dependencies without nesting CRUD use-case transactions.
        for (const material of mapped.value.catalog.materials) {
          if (!records.value.materials.some(record => record.id === material.id)) {
            const result = await repositories.materials.create(material);
            if (!result.ok) {
              return result
            }
          }
        }
        for (const supplier of mapped.value.catalog.suppliers) {
          if (!records.value.suppliers.some(record => record.id === supplier.id)) {
            const result = await repositories.suppliers.create(supplier);
            if (!result.ok) {
              return result
            }
          }
        }
        for (const product of mapped.value.catalog.products) {
          if (!records.value.products.some(record => record.id === product.id)) {
            const result = await repositories.supplierProducts.create(product);
            if (!result.ok) {
              return result
            }
          }
        }
        for (const part of mapped.value.parts) {
          const result = await repositories.parts.create(part);
          if (!result.ok) {
            return result
          }
        }
        const project = await repositories.projects.create(mapped.value.project);
        if (!project.ok) {
          return project
        }
        for (const plan of mapped.value.savedPlans) {
          const summary = await repositories.savedPlanSummaries.create(plan.summary);
          if (!summary.ok) {
            return summary
          }
          const contents = await repositories.savedPlanContents.create(plan.contents);
          if (!contents.ok) {
            return contents
          }
        }
        if (mapped.value.currentResultId !== undefined) {
          const current = await repositories.currentCuttingResults.create({ id: project.value.id, planId: mapped.value.currentResultId, preserveLegacy: false });
          if (!current.ok) {
            return current
          }
        }
        return project
      })
    },
  }
}

export type ProjectTransferService = ReturnType<typeof createProjectTransferService>
