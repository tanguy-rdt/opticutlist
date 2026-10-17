import { mount, type VueWrapper } from '@vue/test-utils'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LegacyPartsPanel from '@/ui/components/projects/LegacyPartsPanel.vue'
import { projectIdKey, projectServiceKey } from '@/ui/composables/use-project-service'
import { createProjectService } from '../../../application/projects/project-service'
import { createLocalPersistence } from '../../../infrastructure/persistence/local-database'
import { cuttingProjectSchema } from '../../../domain/model/cutting-project'
import { validMaterialInput, validPartInput } from '../../../domain/model/__tests__/fixtures'
const wrappers: VueWrapper[] = []
const connections: ReturnType<typeof createLocalPersistence>[] = []
afterEach(() => { for (const wrapper of wrappers) wrapper.unmount(); for (const connection of connections) connection.close(); wrappers.length = 0; connections.length = 0; vi.restoreAllMocks() })
describe('Explicit legacy adoption', () => {
  it('keeps legacy data untouched until review and confirmation, then moves the original record', async () => {
    const persistence = createLocalPersistence('legacy-panel-test', { indexedDB: new IDBFactory(), IDBKeyRange })
    connections.push(persistence)
    await persistence.materials.create(validMaterialInput)
    await persistence.parts.create(validPartInput)
    const project = cuttingProjectSchema.parse({ id: 'cabinet', name: 'Cabinet', partIds: [], materialIds: [], supplierProductIds: [] })
    const service = createProjectService(persistence)
    await service.projects.create(project)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = mount(LegacyPartsPanel, { global: { provide: { [projectServiceKey]: service, [projectIdKey]: project.id } } })
    wrappers.push(wrapper)
    await vi.waitFor(() => { expect(wrapper.find('input').exists()).toBe(true) })
    expect(wrapper.text()).toContain('720 × 560 × 18 mm')
    expect(await service.parts(project.id).list()).toEqual({ ok: true, value: [] })
    await wrapper.get('input').setValue(true)
    await wrapper.get('button').trigger('click')
    expect(await service.parts(project.id).list()).toEqual({ ok: true, value: [] })
    confirm.mockReturnValue(true)
    await wrapper.get('button').trigger('click')
    await vi.waitFor(() => { expect(wrapper.emitted('adopted')).toHaveLength(1) })
    expect(await service.parts(project.id).list()).toEqual({ ok: true, value: [validPartInput] })
    expect(await persistence.parts.list()).toEqual({ ok: true, value: [validPartInput] })
  })
})
