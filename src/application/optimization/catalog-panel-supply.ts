import type { Part } from '../../domain/model/part'

/** Every used panel must place at least one requested copy. This finite bound cannot limit supply. */
export function catalogPanelSupply(parts: readonly Part[]): number {
  const copies = parts.reduce((total, part) => total + part.quantity, 0)
  if (!Number.isSafeInteger(copies) || copies < 0) {
    throw new RangeError('Total requested part quantity exceeds the supported range.')
  }
  return copies
}
