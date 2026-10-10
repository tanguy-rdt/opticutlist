import type { Material } from '../../domain/model/material'
import type { Part } from '../../domain/model/part'
import type { StockItem } from '../../domain/model/stock-item'
import type { Supplier } from '../../domain/model/supplier'
import type { SupplierProduct } from '../../domain/model/supplier-product'

export type PersistenceError =
  | { readonly kind: 'invalidRecord'; readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[] }
  | { readonly kind: 'duplicateId'; readonly id: string }
  | { readonly kind: 'notFound'; readonly id: string }
  | { readonly kind: 'storageFailure'; readonly message: string }

export type PersistenceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PersistenceError }

export interface Repository<Entity extends { id: string }> {
  create(record: unknown): Promise<PersistenceResult<Entity>>
  get(id: Entity['id']): Promise<PersistenceResult<Entity>>
  /** Replace an existing record in full; its ID cannot change. */
  update(id: Entity['id'], record: unknown): Promise<PersistenceResult<Entity>>
  delete(id: Entity['id']): Promise<PersistenceResult<void>>
  list(): Promise<PersistenceResult<readonly Entity[]>>
}

export interface Repositories {
  readonly materials: Repository<Material>
  readonly parts: Repository<Part>
  readonly suppliers: Repository<Supplier>
  readonly supplierProducts: Repository<SupplierProduct>
  readonly stockItems: Repository<StockItem>
}

export interface LocalPersistence extends Repositories {
  open(): Promise<PersistenceResult<void>>
  close(): void
  /**
   * Use only the supplied repositories and await every operation. Any failed operation rolls back
   * the entire transaction, even if the callback ignores its result. Do not await network or timers.
   * Scoped repositories must not escape the callback. Values are committed only when this resolves.
   */
  transaction<T>(work: (repositories: Repositories) => Promise<PersistenceResult<T>>): Promise<PersistenceResult<T>>
}
