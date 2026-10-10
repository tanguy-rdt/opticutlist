import { inject, type InjectionKey } from 'vue'

import type { Repository } from '../../application/persistence/repositories'
import type { Material } from '../../domain/model/material'

export const materialRepositoryKey: InjectionKey<Repository<Material>> = Symbol('materialRepository')

export function useMaterialRepository(): Repository<Material> {
  const repository = inject(materialRepositoryKey)
  if (repository === undefined) throw new Error('Material repository was not provided')
  return repository
}
