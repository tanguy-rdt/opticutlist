import type { Part } from '../../../domain/model/part'

/** Copy indices belong to the plan, and remain stable when placements are edited. */
export function copyLabel(part: Pick<Part, 'name' | 'quantity'>, copyIndex: number): string {
  return part.quantity > 1 ? `${part.name} · ${String(copyIndex + 1)}/${String(part.quantity)}` : part.name
}
