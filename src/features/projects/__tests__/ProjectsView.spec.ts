import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppRouter } from '../../../app/router'
import ProjectsView from '../../../app/views/ProjectsView.vue'
import { projectTransferServiceKey } from '../project-transfer-service'
import type { ProjectTransferService } from '../../../application/projects/project-transfer-service'
import { cuttingProjectSchema } from '../../../domain/model/cutting-project'
import type { ProjectService } from '../../../application/projects/project-service'
import { projectServiceKey } from '../project-service'

const project = cuttingProjectSchema.parse({ id: 'new-project', name: 'Cabinet', partIds: [], materialIds: [], supplierProductIds: [] })
const wrappers: VueWrapper[] = []
afterEach(() => { for (const wrapper of wrappers) wrapper.unmount(); wrappers.length = 0; vi.restoreAllMocks(); vi.unstubAllGlobals() })
function setup(records = [] as readonly typeof project[]) {
  const projects = {
    create: vi.fn<ProjectService['projects']['create']>().mockResolvedValue({ ok: true, value: project }),
    get: vi.fn<ProjectService['projects']['get']>().mockResolvedValue({ ok: true, value: project }),
    list: vi.fn<ProjectService['projects']['list']>().mockResolvedValue({ ok: true, value: records }),
    update: vi.fn<ProjectService['projects']['update']>().mockResolvedValue({ ok: true, value: project }),
    delete: vi.fn<ProjectService['projects']['delete']>().mockResolvedValue({ ok: true, value: undefined }),
  }
  const service: ProjectService = {
    projects, parts: () => { throw new Error('Unused') },
    listLegacyParts: () => Promise.resolve({ ok: true, value: [] }),
    adoptLegacyParts: () => Promise.resolve({ ok: true, value: undefined }),
  }
  const transfer = { export: vi.fn<ProjectTransferService['export']>().mockResolvedValue({ ok: false, error: { kind: 'storageFailure', message: 'Disk unavailable' } }) }
  const router = createAppRouter(createMemoryHistory())
  const wrapper = mount(ProjectsView, { global: { plugins: [router], provide: { [projectServiceKey]: service, [projectTransferServiceKey]: transfer } }, attachTo: document.body })
  wrappers.push(wrapper)
  return { wrapper, projects, router, transfer }
}
describe('Project creation', () => {
  it('validates the required name and focuses the field without writing', async () => {
    const { wrapper, projects } = setup()
    await flushPromises()
    await wrapper.get('button[aria-labelledby="new-project-title"]').trigger('click')
    await wrapper.get('#project-name').setValue(' ')
    await wrapper.get('form').trigger('submit')
    expect(projects.create).not.toHaveBeenCalled()
    expect(wrapper.get('#project-name').attributes('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(wrapper.get('#project-name').element)
  })
  it('creates a schema-valid project and opens the result with a stable ID', async () => {
    const { wrapper, projects, router } = setup()
    await flushPromises()
    await wrapper.get('button[aria-labelledby="new-project-title"]').trigger('click')
    await wrapper.get('#project-name').setValue(' Cabinet ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const input: unknown = projects.create.mock.calls[0]?.[0]
    expect(cuttingProjectSchema.parse(input)).toMatchObject({ name: 'Cabinet', partIds: [], materialIds: [], supplierProductIds: [] })
    expect(router.currentRoute.value.path).toBe('/projects/new-project/parts')
  })
  it('retains a failed name draft and displays storage failures', async () => {
    const { wrapper, projects } = setup()
    projects.create.mockResolvedValue({ ok: false, error: { kind: 'storageFailure', message: 'Disk full' } })
    await flushPromises()
    await wrapper.get('button[aria-labelledby="new-project-title"]').trigger('click')
    await wrapper.get('#project-name').setValue('Cabinet')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not access local storage')
    expect(wrapper.get<HTMLInputElement>('#project-name').element.value).toBe('Cabinet')
  })
  it('blocks duplicate submissions while creation is pending', async () => {
    const { wrapper, projects } = setup()
    projects.create.mockReturnValue(new Promise(() => {}))
    await flushPromises()
    await wrapper.get('button[aria-labelledby="new-project-title"]').trigger('click')
    await wrapper.get('#project-name').setValue('Cabinet')
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    expect(projects.create).toHaveBeenCalledTimes(1)
    expect(wrapper.get('form button').attributes('disabled')).toBeDefined()
  })
})

function button(wrapper: VueWrapper, text: string) {
  const found = wrapper.findAll('button').find(item => item.text() === text)
  if (!found) throw new Error(`Missing ${text}`)
  return found
}
describe('Project manager', () => {
  it('uses full-surface New/Import tiles with no persistent form or empty table', async () => {
    const { wrapper, router } = setup(); await flushPromises()
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.findAll('.home-card')).toHaveLength(2)
    const tile = wrapper.get('button[aria-labelledby="new-project-title"]')
    expect(tile.attributes('type')).toBe('button')
    await tile.trigger('click')
    expect(document.activeElement).toBe(wrapper.get('#project-name').element)
    await wrapper.get('button[aria-label="Close form"]').trigger('click')
    expect(wrapper.find('form').exists()).toBe(false)
    await wrapper.get('a[aria-labelledby="import-project-title"]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/import')
  })
  it('selects duplicate names by stable ID, shows real counts and opens the selected project', async () => {
    const second = cuttingProjectSchema.parse({ ...project, id: 'second-project', partIds: ['part-one', 'part-two'], materialIds: ['mat-one'], supplierProductIds: ['product-one'] })
    const { wrapper, router } = setup([project, second]); await flushPromises()
    const choices = wrapper.get('ul[aria-label="Projects"]').findAll('button')
    expect(choices[0]?.attributes('aria-pressed')).toBe('true')
    await choices[1]?.trigger('click')
    expect(choices[1]?.attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[aria-label="Project metrics"]').findAll('dd').map(item => item.text())).toEqual(['2', '1', '1'])
    const open = wrapper.get('a[href="/projects/second-project/parts"]')
    await open.trigger('click'); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/projects/second-project/parts')
  })
  it('searches without discarding the selected project and retains accessible actions on small screens', async () => {
    const second = cuttingProjectSchema.parse({ ...project, id: 'desk', name: 'Desk' })
    const { wrapper } = setup([project, second]); await flushPromises()
    await wrapper.get('#project-search').setValue('DESK')
    expect(wrapper.get('ul[aria-label="Projects"]').findAll('button')).toHaveLength(1)
    await wrapper.get('ul[aria-label="Projects"] button').trigger('click')
    expect(wrapper.get('[aria-label="Selected project details"]').text()).toContain('Desk')
    await wrapper.get('#project-search').setValue('absent')
    expect(wrapper.text()).toContain('No matching projects')
    expect(wrapper.find('a[href="/projects/desk/parts"]').exists()).toBe(true)
  })
  it('renames using a fresh record without replacing parts, catalog selections or panel quantities', async () => {
    const latest = cuttingProjectSchema.parse({ ...project, partIds: ['part-new'], materialIds: ['material-new'], supplierProductIds: ['product-new'], panelQuantities: [{ supplierProductId: 'product-new', quantity: 4 }] })
    const { wrapper, projects } = setup([project]); await flushPromises()
    projects.get.mockResolvedValue({ ok: true, value: latest })
    await button(wrapper, 'Rename project').trigger('click')
    await wrapper.get('#project-name').setValue('  Updated cabinet  ')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(projects.update).toHaveBeenCalledExactlyOnceWith(project.id, { ...latest, name: 'Updated cabinet' })
    expect(projects.create).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Project renamed.')
  })
  it('keeps invalid and failed rename drafts and never re-creates a missing project', async () => {
    const { wrapper, projects } = setup([project]); await flushPromises()
    await button(wrapper, 'Rename project').trigger('click')
    await wrapper.get('#project-name').setValue(' '); await wrapper.get('form').trigger('submit')
    expect(projects.update).not.toHaveBeenCalled()
    projects.get.mockResolvedValue({ ok: false, error: { kind: 'notFound', id: project.id } })
    await wrapper.get('#project-name').setValue('New name'); await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('no longer exists')
    expect(wrapper.get<HTMLInputElement>('#project-name').element.value).toBe('New name')
    expect(projects.create).not.toHaveBeenCalled(); expect(projects.update).not.toHaveBeenCalled()
  })
  it('requires deletion consent and preserves projects when existing dependency guards reject deletion', async () => {
    const { wrapper, projects } = setup([project]); await flushPromises()
    const consent = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await button(wrapper, 'Delete project').trigger('click')
    expect(projects.delete).not.toHaveBeenCalled()
    consent.mockReturnValue(true)
    projects.delete.mockResolvedValueOnce({ ok: false, error: { kind: 'referenceConflict', message: 'Remove the project’s parts before deleting it.' } })
    await button(wrapper, 'Delete project').trigger('click'); await flushPromises()
    expect(projects.delete).toHaveBeenCalledWith(project.id)
    expect(wrapper.get('[role="alert"]').text()).toContain('Remove the project’s parts')
    expect(wrapper.get('[aria-label="Selected project details"]').text()).toContain(project.name)
    await button(wrapper, 'Retry projects').trigger('click'); await flushPromises()
    projects.list.mockResolvedValue({ ok: true, value: [] })
    await button(wrapper, 'Delete project').trigger('click'); await flushPromises()
    expect(wrapper.find('[aria-label="Selected project details"]').exists()).toBe(false)
    expect(wrapper.findAll('.home-card')).toHaveLength(2)
  })
  it('exports the selected stable ID with the existing transfer component and reports failures', async () => {
    const second = cuttingProjectSchema.parse({ ...project, id: 'second' })
    const { wrapper, transfer } = setup([project, second]); await flushPromises()
    await wrapper.get('ul[aria-label="Projects"]').findAll('button')[1]?.trigger('click')
    await button(wrapper, 'Export Project').trigger('click'); await flushPromises()
    expect(transfer.export).toHaveBeenCalledExactlyOnceWith(second.id)
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not access local storage')
  })
  it('downloads the selected project through the unchanged .pocl workflow', async () => {
    const second = cuttingProjectSchema.parse({ ...project, id: 'second', name: 'Desk' })
    const { wrapper, transfer } = setup([project, second]); await flushPromises()
    await wrapper.get('ul[aria-label="Projects"]').findAll('button')[1]?.trigger('click')
    transfer.export.mockResolvedValue({ ok: true, value: { text: '{"format":"opticutlist-project","schemaVersion":1}', name: second.name } })
    const create = vi.fn(() => 'blob:project'); const revoke = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
    let filename = ''
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download })
    await button(wrapper, 'Export Project').trigger('click'); await flushPromises()
    expect(transfer.export).toHaveBeenCalledExactlyOnceWith(second.id)
    expect(click).toHaveBeenCalledOnce(); expect(filename).toBe('Desk.pocl')
    expect(wrapper.text()).toContain('Project JSON download started')
  })
  it('shows storage read errors and retries without presenting an empty inventory', async () => {
    const { wrapper, projects } = setup([project]); await flushPromises()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    projects.list.mockResolvedValueOnce({ ok: false, error: { kind: 'storageFailure', message: 'Unavailable' } })
    await button(wrapper, 'Delete project').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not access local storage')
    expect(wrapper.findAll('.home-card')).toHaveLength(0)
    await button(wrapper, 'Retry projects').trigger('click'); await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })
})
