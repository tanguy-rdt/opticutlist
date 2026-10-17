import { inject, type InjectionKey } from 'vue'

import type { Repository } from '@/application/persistence/repositories'
import type { Part } from '@/domain/model/part'

export const partRepositoryKey: InjectionKey<Repository<Part>> = Symbol('partRepository')

export function usePartRepository(): Repository<Part> {
  const repository = inject(partRepositoryKey)
  if (repository === undefined) {
    throw new Error('Part repository was not provided')
  }
  return repository
}
