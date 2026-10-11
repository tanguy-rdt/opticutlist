import { cuttingProjectSchema, type CuttingProject } from '../../domain/model/cutting-project'
import { partSchema, type Part } from '../../domain/model/part'
import type { CuttingProjectId, PartId } from '../../domain/model/ids'
import type { LocalPersistence, PersistenceResult, Repositories, Repository } from '../persistence/repositories'

const conflict = (message: string): Extract<PersistenceResult<never>, { ok: false }> => ({ ok: false, error: { kind: 'referenceConflict', message } })
const missing = (id: string): Extract<PersistenceResult<never>, { ok: false }> => ({ ok: false, error: { kind: 'notFound', id } })

export interface ProjectService {
  readonly projects: Repository<CuttingProject>
  parts(projectId: CuttingProjectId): Repository<Part>
  listLegacyParts(): Promise<PersistenceResult<readonly Part[]>>
  adoptLegacyParts(projectId: CuttingProjectId, ids: readonly PartId[]): Promise<PersistenceResult<void>>
}

/** Atomic ownership guards around the existing record repositories. No entity cache. */
export function createProjectService(persistence: LocalPersistence): ProjectService {
  async function validateSelections(repositories: Repositories, project: CuttingProject, previous?: CuttingProject): Promise<PersistenceResult<void>> {
    for (const id of project.materialIds) {
      const result = await repositories.materials.get(id)
      if (!result.ok) return result.error.kind === 'notFound' ? conflict('A selected material no longer exists in the Catalogue. Refresh and remove its selection.') : result
    }
    for (const id of project.supplierProductIds) {
      const result = await repositories.supplierProducts.get(id)
      if (!result.ok) return result.error.kind === 'notFound' ? conflict('A selected panel product no longer exists in the Catalogue. Refresh and remove its selection.') : result
      const material = await repositories.materials.get(result.value.materialId)
      if (!material.ok) return material.error.kind === 'notFound' ? conflict('A selected panel product has a missing material reference. Repair the Catalogue reference or remove the selection.') : material
      const supplier = await repositories.suppliers.get(result.value.supplierId)
      if (!supplier.ok) return supplier.error.kind === 'notFound' ? conflict('A selected panel product has a missing supplier reference. Repair the Catalogue reference or remove the selection.') : supplier
      if (result.value.availability === 'unavailable' && !previous?.supplierProductIds.includes(id)) {
        return conflict('This panel product is unavailable. Choose another catalog product.')
      }
    }
    for (const id of project.stockItemIds ?? []) {
      const stock = await repositories.stockItems.get(id)
      if (!stock.ok) {
        return stock.error.kind === 'notFound' ? conflict('A selected stock panel no longer exists. Remove its selection.') : stock
      }
      const material = await repositories.materials.get(stock.value.materialId)
      if (!material.ok) return material
    }
    return { ok: true, value: undefined }
  }

  async function saveProject(record: unknown, id?: CuttingProjectId): Promise<PersistenceResult<CuttingProject>> {
    const parsed = cuttingProjectSchema.safeParse(record)
    if (!parsed.success) return Promise.resolve({ ok: false, error: { kind: 'invalidRecord', issues: parsed.error.issues } })
    let selectionFailure: Extract<PersistenceResult<never>, { ok: false }> | undefined
    const result = await persistence.transaction(async repositories => {
      let previous: CuttingProject | undefined
      if (id !== undefined) {
        const result = await repositories.projects.get(id)
        if (!result.ok) return result
        previous = result.value
      }
      const previousIds = previous?.partIds ?? []
      if (parsed.data.partIds.length !== previousIds.length || parsed.data.partIds.some(partId => !previousIds.includes(partId))) {
        return conflict('Part ownership must be changed through the project Parts workflow. Refresh and try again.')
      }
      const selections = await validateSelections(repositories, parsed.data, previous)
      if (!selections.ok) { selectionFailure = selections; return selections }
      return id === undefined ? repositories.projects.create(parsed.data) : repositories.projects.update(id, parsed.data)
    })
    // Scoped failures abort the transaction with the first storage error. Translate
    // missing catalog references only after rollback, keeping project lookup errors intact.
    return !result.ok && result.error.kind === 'notFound' && selectionFailure ? selectionFailure : result
  }

  function parts(projectId: CuttingProjectId): Repository<Part> {
    async function withProject<T>(work: (repositories: Repositories, project: CuttingProject) => Promise<PersistenceResult<T>>): Promise<PersistenceResult<T>> {
      return persistence.transaction(async repositories => {
        const project = await repositories.projects.get(projectId)
        if (!project.ok) return project
        const projects = await repositories.projects.list()
        if (!projects.ok) return projects
        if (projects.value.some(other => other.id !== projectId && other.partIds.some(id => project.value.partIds.includes(id)))) {
          return conflict('Stored part ownership conflicts with another project. No records were changed.')
        }
        return work(repositories, project.value)
      })
    }
    async function save(record: unknown, id?: PartId): Promise<PersistenceResult<Part>> {
      const parsed = partSchema.safeParse(record)
      if (!parsed.success) return { ok: false, error: { kind: 'invalidRecord', issues: parsed.error.issues } }
      return withProject(async (repositories, project) => {
        if (id !== undefined && !project.partIds.includes(id)) return missing(id)
        const material = await repositories.materials.get(parsed.data.materialId)
        if (!material.ok) return material
        // Read saved selections inside the same transaction as the Part/ownership write.
        // Panel selections make their associated material available without requiring a
        // separate material checkbox; a direct material choice needs no supplier product.
        let selected = project.materialIds.includes(parsed.data.materialId)
        if (!selected) {
          for (const productId of project.supplierProductIds) {
            const product = await repositories.supplierProducts.get(productId)
            if (!product.ok) return product
            if (product.value.materialId === parsed.data.materialId) { selected = true; break }
          }
        }
        if (!selected) return conflict('Select this material in the project Materials tab before creating or editing a Part.')
        const result = id === undefined ? await repositories.parts.create(parsed.data) : await repositories.parts.update(id, parsed.data)
        if (!result.ok) return result
        if (id === undefined) {
          const owner = await repositories.projects.update(projectId, { ...project, partIds: [...project.partIds, result.value.id] })
          if (!owner.ok) return owner
        }
        return result
      })
    }
    return {
      create: record => save(record),
      update: (id, record) => save(record, id),
      get: id => withProject((repositories, project) => project.partIds.includes(id) ? repositories.parts.get(id) : Promise.resolve(missing(id))),
      list: () => withProject(async (repositories, project) => {
        const records: Part[] = []
        for (const id of [...project.partIds].sort()) {
          const part = await repositories.parts.get(id)
          if (!part.ok) return part
          records.push(part.value)
        }
        return { ok: true, value: records }
      }),
      delete: id => withProject(async (repositories, project) => {
        if (!project.partIds.includes(id)) return missing(id)
        const removed = await repositories.parts.delete(id)
        if (!removed.ok) return removed
        const owner = await repositories.projects.update(projectId, { ...project, partIds: project.partIds.filter(partId => partId !== id) })
        return owner.ok ? { ok: true, value: undefined } : owner
      }),
    }
  }

  return {
    projects: {
      ...persistence.projects,
      create: record => saveProject(record),
      update: (id, record) => saveProject(record, id),
      delete: id => persistence.transaction(async repositories => {
        const project = await repositories.projects.get(id)
        if (!project.ok) return project
        if (project.value.partIds.length > 0) return conflict('Remove the project’s parts before deleting it.')
        const current = await repositories.currentCuttingResults.find(id)
        if (!current.ok) return current
        if (current.value) return conflict('A project with a current cutting result cannot be deleted.')
        const plans = await repositories.savedPlanSummaries.listForProject(id)
        if (!plans.ok) return plans
        if (plans.value.length > 0) return conflict('A project with preserved cutting plans cannot be deleted.')
        return repositories.projects.delete(id)
      }),
    },
    parts,
    listLegacyParts: () => persistence.transaction(async repositories => {
      const projects = await repositories.projects.list()
      if (!projects.ok) return projects
      const partsResult = await repositories.parts.list()
      if (!partsResult.ok) return partsResult
      const owned = new Set(projects.value.flatMap(project => project.partIds))
      return { ok: true, value: partsResult.value.filter(part => !owned.has(part.id)) }
    }),
    adoptLegacyParts: (projectId, ids) => persistence.transaction(async repositories => {
      if (ids.length === 0 || new Set(ids).size !== ids.length) return conflict('Select distinct legacy parts to adopt.')
      const project = await repositories.projects.get(projectId)
      if (!project.ok) return project
      const projects = await repositories.projects.list()
      if (!projects.ok) return projects
      const owned = new Set(projects.value.flatMap(record => record.partIds))
      for (const id of ids) {
        if (owned.has(id)) return conflict('A selected part already belongs to a project. Refresh the legacy list.')
        const part = await repositories.parts.get(id)
        if (!part.ok) return part
        const material = await repositories.materials.get(part.value.materialId)
        if (!material.ok) return material
      }
      const result = await repositories.projects.update(projectId, { ...project.value, partIds: [...project.value.partIds, ...ids] })
      return result.ok ? { ok: true, value: undefined } : result
    }),
  }
}
