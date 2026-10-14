import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppRouter } from '../../../app/router'
import { createMemoryHistory } from 'vue-router'
import PartsJsonTransfer from '../PartsJsonTransfer.vue'
import { partsTransferServiceKey } from '../parts-transfer-service'
import { projectIdKey } from '../../projects/project-service'
import type { PartsTransferService } from '../../../application/projects/parts-transfer-service'
import { cuttingProjectIdSchema } from '../../../domain/model/ids'
import { materialSchema } from '../../../domain/model/material'
import { validMaterialInput } from '../../../domain/model/__tests__/fixtures'
import { partsTransferSchema } from '../../../application/projects/parts-transfer-format'
const material = materialSchema.parse(validMaterialInput)
const projectId = cuttingProjectIdSchema.parse('parts-project')
const file = partsTransferSchema.parse({ format: 'opticutlist-parts', version: 1, parts: [{ name: 'Shelf', material: material.name, length: 500, width: 400, thickness: 18, quantity: 2, grainDirection: 'length', rotation: 'forbidden' }] })
const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => { wrapper.unmount() }); wrappers.length = 0; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
function setup() {
  const service = {
    preview: vi.fn<PartsTransferService['preview']>().mockResolvedValue({ ok: true, value: { file, materials: [material], materialIds: [material.id] } }),
    import: vi.fn<PartsTransferService['import']>().mockResolvedValue({ ok: true, value: 1 }),
    export: vi.fn<PartsTransferService['export']>().mockResolvedValue({ ok: true, value: { text: JSON.stringify(file, null, 2), name: 'Cabinet-parts' } }),
  }
  const wrapper = mount(PartsJsonTransfer, { props: { disabled: false }, attachTo: document.body, global: { plugins: [createAppRouter(createMemoryHistory())], provide: { [partsTransferServiceKey]: service, [projectIdKey]: projectId } } }); wrappers.push(wrapper)
  return { wrapper, service }
}
function button(wrapper: VueWrapper, text: string) { const result = wrapper.findAll('button').find(item => item.text() === text); if (!result) throw new Error('Missing button'); return result }
async function select(wrapper: VueWrapper) {
  const input = wrapper.get<HTMLInputElement>('input[type="file"]')
  const upload = new File(['json'], 'parts.json', { type: 'application/json' })
  Object.defineProperty(upload, 'text', { value: () => Promise.resolve(JSON.stringify(file)) })
  Object.defineProperty(input.element, 'files', { value: [upload] })
  await input.trigger('change'); await flushPromises()
}
describe('Parts JSON actions', () => {
  it('previews local JSON and requires explicit confirmation before importing', async () => {
    const { wrapper, service } = setup()
    await button(wrapper, 'Import JSON').trigger('click')
    expect(wrapper.get('input[type="file"]').attributes('accept')).toContain('.json')
    await select(wrapper)
    expect(service.preview).toHaveBeenCalledWith(projectId, JSON.stringify(file))
    expect(wrapper.text()).toContain('500 × 400 × 18 mm · Qty 2')
    expect(service.import).not.toHaveBeenCalled()
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(service.import).toHaveBeenCalledWith(projectId, file, [material.id], true)
    expect(wrapper.emitted('imported')).toHaveLength(1)
    expect(wrapper.find('dialog').exists()).toBe(false)
  })
  it('allows cancellation without writing and reports validation/storage failures', async () => {
    const { wrapper, service } = setup()
    await button(wrapper, 'Import JSON').trigger('click'); await select(wrapper)
    await button(wrapper, 'Cancel').trigger('click')
    expect(service.import).not.toHaveBeenCalled()
    service.preview.mockResolvedValue({ ok: false, error: { kind: 'invalidRecord', issues: [{ path: ['version'], message: 'Unsupported version' }] } })
    await button(wrapper, 'Import JSON').trigger('click'); await select(wrapper)
    expect(wrapper.get('[role="alert"]').text()).toContain('version: Unsupported version')
    expect(button(wrapper, 'Import parts').attributes('disabled')).toBeDefined()
  })
  it('requires a material choice without creating materials and retains failed previews', async () => {
    const { wrapper, service } = setup()
    service.preview.mockResolvedValue({ ok: true, value: { file, materials: [material], materialIds: [null] } })
    await button(wrapper, 'Import JSON').trigger('click'); await select(wrapper)
    expect(button(wrapper, 'Import parts').attributes('disabled')).toBeDefined()
    await wrapper.get('#import-part-material-0').trigger('click')
    expect(wrapper.text()).not.toContain('Create custom material')
    await wrapper.get('[role="option"]').trigger('click')
    service.import.mockResolvedValue({ ok: false, error: { kind: 'storageFailure', message: 'Disk full' } })
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not access local storage')
    expect(wrapper.get('#import-part-material-0').text()).toContain(material.name)
  })
  it('downloads the generated JSON with the project filename and releases its URL', async () => {
    const { wrapper, service } = setup()
    const revoke = vi.fn(); const create = vi.fn().mockReturnValue('blob:parts')
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) { expect(this.download).toBe('Cabinet-parts.json') })
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    await button(wrapper, 'Export JSON').trigger('click'); await flushPromises()
    expect(service.export).toHaveBeenCalledWith(projectId)
    expect(create).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(1000)
    expect(revoke).toHaveBeenCalledWith('blob:parts')
  })
})
