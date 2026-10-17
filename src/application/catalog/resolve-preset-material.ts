import { materialSchema, type Material } from '../../domain/model/material'
import type { PersistenceResult, Repositories } from '../persistence/repositories'
import { builtInMaterialPresets } from './material-presets'

/** Resolve only canonical preset identity, never names alone; callers own the transaction. */
export async function resolvePresetMaterial(repositories: Repositories, presetId: string): Promise<PersistenceResult<Material>> {
  const preset = builtInMaterialPresets.find(item => item.id === presetId)
  if (!preset) {
    return { ok: false, error: { kind: 'referenceConflict', message: 'Choose a supported built-in material preset.' } }
  }
  const materials = await repositories.materials.list()
  if (!materials.ok) {
    return materials
  }
  const existing = materials.value.find(item => item.libraryPresetId === preset.id && item.name === preset.name && item.category === preset.category)
  return existing ? { ok: true, value: existing } : repositories.materials.create(materialSchema.parse({ id: crypto.randomUUID(), name: preset.name, category: preset.category, libraryPresetId: preset.id }))
}
