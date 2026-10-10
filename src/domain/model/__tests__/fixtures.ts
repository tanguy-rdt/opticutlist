// Valid raw inputs (as they would arrive from a form or an import) used as test baselines.

export const validMaterialInput = {
  id: 'mat-birch-plywood',
  name: 'Birch plywood BB/BB',
  category: 'Plywood',
}

export const validPartInput = {
  id: 'part-side-panel',
  name: 'Side panel',
  materialId: 'mat-birch-plywood',
  lengthMm: 720,
  widthMm: 560,
  thicknessMm: 18,
  quantity: 2,
  grainDirection: 'length',
  rotation: 'forbidden',
}

export const validSupplierInput = {
  id: 'sup-local-timber',
  name: 'Local Timber Yard',
  websiteUrl: 'https://timber.example.com',
}

export const validSupplierProductInput = {
  id: 'prod-birch-18-2500x1250',
  supplierId: 'sup-local-timber',
  materialId: 'mat-birch-plywood',
  name: 'Birch plywood 18 mm, 2500 × 1250',
  lengthMm: 2500,
  widthMm: 1250,
  thicknessMm: 18,
  grainDirection: 'length',
  price: 89.9,
  currency: 'EUR',
  productUrl: 'https://timber.example.com/products/birch-18',
  availability: 'available',
}

export const validStockItemInput = {
  id: 'stock-birch-offcut-1',
  kind: 'offcut',
  materialId: 'mat-birch-plywood',
  lengthMm: 800,
  widthMm: 400.5,
  thicknessMm: 18,
  quantity: 1,
  grainDirection: 'length',
  provenance: { source: 'manual' },
}

/** Values that must never be accepted as a dimension in millimeters. */
export const invalidDimensionValues: readonly unknown[] = [
  0,
  -0,
  -1,
  -0.001,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  '18',
  null,
  undefined,
  true,
  {},
]

/** Values that must never be accepted as a quantity. */
export const invalidQuantityValues: readonly unknown[] = [
  0,
  -0,
  -1,
  1.5,
  0.999,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.MAX_SAFE_INTEGER + 1,
  '2',
  null,
  undefined,
]

export const dimensionKeys = ['lengthMm', 'widthMm', 'thicknessMm'] as const

/** Returns a shallow copy of `input` without `key`. */
export function without<T extends object>(input: T, key: keyof T): Partial<T> {
  const copy: Partial<T> = { ...input }
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- test helper removing a known key
  delete copy[key]
  return copy
}
