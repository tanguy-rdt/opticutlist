import { describe, expect, it, vi } from 'vitest'
import { createCuttingPlanPdfService, type CuttingPlanPdfDocument, type ProjectCuttingPdfDocument } from '../cutting-plan-pdf-service'
import { pdfRequest, multiPanelPdfRequest } from './pdf-fixtures'
import { applyPlanEdit, createPlanEditingSession, currentEditingPlan } from '../../optimization/plan-editing-session'
import { rotationInput, rotationPlan } from '../../../domain/cutting-tree/__tests__/editing-fixtures'
import { freezeDeep, viewerPart } from '../../../domain/cutting-tree/__tests__/viewer-fixtures'
import { materialIdSchema } from '../../../domain/model/ids'

describe('Validated PDF application service', () => {
  it('exports a detached validated scene and recomputes metrics instead of trusting redundant data', async () => {
    const generate = vi.fn<(document: CuttingPlanPdfDocument) => Promise<Uint8Array<ArrayBuffer>>>().mockResolvedValue(new Uint8Array([1]))
    const request = structuredClone(pdfRequest)
    const original = structuredClone(request)
    freezeDeep(request)
    const result = await createCuttingPlanPdfService({ generate }).export(request)
    expect(result).toEqual({ ok: true, bytes: new Uint8Array([1]) })
    const document = generate.mock.calls[0]?.[0]
    expect(document?.scene.parts[0]).toMatchObject({ orientation: 'rotated', region: { xMm: 5, yMm: 5, lengthMm: 30, widthMm: 50 }, dimensions: { lengthMm: 30, widthMm: 50, thicknessMm: 18 } })
    expect(document?.scene.kerfs).toEqual([{ xMm: 35, yMm: 5, lengthMm: 2, widthMm: 70 }, { xMm: 5, yMm: 55, lengthMm: 30, widthMm: 2 }])
    expect(document?.metrics).toEqual(rotationPlan.metrics)
    expect(document?.panel).not.toBe(request.panel)
    expect(request).toEqual(original)
    await createCuttingPlanPdfService({ generate }).export({ ...request, plan: { ...request.plan, placements: [], metrics: { ...request.plan.metrics, usedAreaMm2: 0, utilizationPercent: 0 } } })
    expect(generate.mock.calls[1]?.[0].metrics).toEqual(rotationPlan.metrics)
  })
  it('exports accepted manual edits without changing the optimized baseline', async () => {
    const created = createPlanEditingSession(rotationPlan, rotationInput)
    if (!created.ok) throw new Error(created.error.message)
    const edit = applyPlanEdit(created.session, { kind: 'rotate', copy: { partId: viewerPart.id, copyIndex: 0 } })
    if (!edit.ok) throw new Error(edit.error.message)
    const generate = vi.fn<(document: CuttingPlanPdfDocument) => Promise<Uint8Array<ArrayBuffer>>>().mockResolvedValue(new Uint8Array())
    const original = structuredClone(rotationPlan)
    await createCuttingPlanPdfService({ generate }).export({ ...pdfRequest, plan: currentEditingPlan(edit.session), edited: true })
    expect(generate.mock.calls[0]?.[0]).toMatchObject({ edited: true, scene: { parts: [{ orientation: 'normal', region: { xMm: 5, yMm: 5, lengthMm: 50, widthMm: 30 } }] } })
    expect(rotationPlan).toEqual(original)
  })
  it.each([
    { label: 'geometry', request: { ...pdfRequest, plan: { ...rotationPlan, tree: { ...rotationPlan.tree, region: { xMm: 6, yMm: 5, lengthMm: 90, widthMm: 70 } } } } },
    { label: 'exact thickness', request: { ...pdfRequest, panel: { ...pdfRequest.panel, thicknessMm: 18.000001 } } },
    { label: 'material', request: { ...pdfRequest, panel: { ...pdfRequest.panel, materialId: materialIdSchema.parse('wrong-material') } } },
    { label: 'grain', request: { ...pdfRequest, panel: { ...pdfRequest.panel, grainDirection: 'length' as const } } },
    { label: 'margins', request: { ...pdfRequest, settings: { ...pdfRequest.settings, edgeMarginMm: 6 } } },
    { label: 'kerf', request: { ...pdfRequest, settings: { ...pdfRequest.settings, kerfMm: 3 } } },
  ])('refuses invalid $label before calling the adapter', async ({ request }) => {
    const generate = vi.fn<(document: CuttingPlanPdfDocument) => Promise<Uint8Array<ArrayBuffer>>>()
    const original = structuredClone(request)
    const result = await createCuttingPlanPdfService({ generate }).export(request)
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalidPlan' } })
    expect(generate).not.toHaveBeenCalled()
    expect(request).toEqual(original)
  })
  it('reports adapter errors explicitly without rejecting the promise', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('PDF font unavailable'))
    expect(await createCuttingPlanPdfService({ generate }).export(pdfRequest)).toEqual({ ok: false, error: { kind: 'generationFailure', message: 'PDF font unavailable' } })
  })
})

describe('Whole-result PDF validation', () => {
  it('exports accepted panel edits in one detached document', async () => {
    const request = multiPanelPdfRequest()
    const allocation = request.plan.panels[0]; const source = request.sources[0]; const part = request.parts[0]
    if (!allocation || !source || !part) throw new Error('Fixture')
    const session = createPlanEditingSession(allocation.plan, { panel: source.product, parts: request.parts, settings: request.settings })
    if (!session.ok) throw new Error('Fixture')
    const edited = applyPlanEdit(session.session, { kind: 'swap', first: { partId: part.id, copyIndex: 0 }, second: { partId: part.id, copyIndex: 1 } })
    if (!edited.ok) throw new Error('Fixture')
    const input = { ...request, editedPanelIndices: [0], plan: { ...request.plan, panels: [{ ...allocation, plan: currentEditingPlan(edited.session) }, ...request.plan.panels.slice(1)] } }
    const original = structuredClone(input)
    const generateProject = vi.fn<(document: ProjectCuttingPdfDocument) => Promise<Uint8Array<ArrayBuffer>>>().mockResolvedValue(new Uint8Array([1]))
    expect((await createCuttingPlanPdfService({ generate: vi.fn(), generateProject }).exportProject(input)).ok).toBe(true)
    expect(generateProject.mock.calls[0]?.[0].panels).toHaveLength(2)
    expect(generateProject.mock.calls[0]?.[0].panels[0]).toMatchObject({ edited: true, scene: { parts: [{ copyIndex: 1 }, { copyIndex: 0 }] } })
    expect(input).toEqual(original)
  })
  it.each(['tree', 'accounting', 'reference'] as const)('rejects corrupted %s before generation', async kind => {
    const request = multiPanelPdfRequest()
    const allocation = request.plan.panels[0]; if (!allocation) throw new Error('Fixture')
    const plan = kind === 'tree' ? { ...request.plan, panels: [{ ...allocation, plan: { ...allocation.plan, tree: { ...allocation.plan.tree, region: { xMm: 6, yMm: 5, lengthMm: 200, widthMm: 100 } } } }, ...request.plan.panels.slice(1)] } : kind === 'accounting' ? { ...request.plan, metrics: { ...request.plan.metrics, placedCount: 99 } } : request.plan
    const input = { ...request, plan, sources: kind === 'reference' ? [] : request.sources }
    const generateProject = vi.fn()
    expect(await createCuttingPlanPdfService({ generate: vi.fn(), generateProject }).exportProject(input)).toMatchObject({ ok: false, error: { kind: 'invalidPlan' } })
    expect(generateProject).not.toHaveBeenCalled()
  })
  it('reports complete-document generation failures without rejecting', async () => {
    expect(await createCuttingPlanPdfService({ generate: vi.fn(), generateProject: vi.fn().mockRejectedValue(new Error('PDF failure')) }).exportProject(multiPanelPdfRequest())).toMatchObject({ ok: false, error: { kind: 'generationFailure', message: 'PDF failure' } })
  })
})
