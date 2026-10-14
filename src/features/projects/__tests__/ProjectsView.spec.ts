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
    deletionPreview: vi.fn<ProjectService['deletionPreview']>().mockResolvedValue({ ok: true, value: { restorationIssues: [] } }),
    deleteProject: vi.fn<ProjectService['deleteProject']>().mockImplementation(id => projects.delete(id)),
    projects, parts: () => { throw new Error('Unused') },
    listLegacyParts: () => Promise.resolve({ ok: true, value: [] }),
    adoptLegacyParts: () => Promise.resolve({ ok: true, value: undefined }),
  }
  const transfer = { export: vi.fn<ProjectTransferService['export']>().mockResolvedValue({ ok: false, error: { kind: 'storageFailure', message: 'Disk unavailable' } }) }
  const router = createAppRouter(createMemoryHistory())
  const wrapper = mount(ProjectsView, { global: { plugins: [router], provide: { [projectServiceKey]: service, [projectTransferServiceKey]: transfer } }, attachTo: document.body })
  wrappers.push(wrapper)
  return { wrapper, projects, router, transfer, service }
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
    expect(router.currentRoute.value.path).toBe('/projects/new-project/materials')
  })
  it('ignores a late successful creation after its dialog has unmounted', async () => {
    const { wrapper, projects, router } = setup()
    let finish: ((result: Awaited<ReturnType<ProjectService['projects']['create']>>) => void) | undefined
    projects.create.mockReturnValue(new Promise(resolve => { finish = resolve }))
    await flushPromises()
    await wrapper.get('button[aria-labelledby="new-project-title"]').trigger('click')
    await wrapper.get('#project-name').setValue('Cabinet')
    await wrapper.get('form').trigger('submit')
    wrapper.unmount()
    await router.push('/catalog')
    finish?.({ ok: true, value: project }); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/catalog')
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
async function menu(wrapper: VueWrapper, index = 0): Promise<void> {
  const trigger = wrapper.get('ul[aria-label="Projects"]').findAll('button[aria-haspopup="menu"]')[index]
  if (!trigger) throw new Error('Missing project action menu')
  await trigger.trigger('click'); await flushPromises()
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
    expect(router.currentRoute.value.fullPath).toBe('/import?from=projects')
  })
  it('lists duplicate names as separate rows with real metadata and opens the correct stable project', async () => {
    const second = cuttingProjectSchema.parse({ ...project, id: 'second-project', partIds: ['part-one', 'part-two'], materialIds: ['mat-one'] })
    const { wrapper, router } = setup([project, second]); await flushPromises()
    const rows = wrapper.get('ul[aria-label="Projects"]').findAll('li')
    expect(rows).toHaveLength(2)
    expect(rows[1]?.text()).toContain('2 part references · 1 selected materials')
    await wrapper.get('a[href="/projects/second-project/materials"] h2').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/projects/second-project/materials')
  })
  it('offers a native keyboard-accessible row link without nested menu controls or an Open button', async () => {
    const { wrapper, router } = setup([project]); await flushPromises()
    const link = wrapper.get<HTMLAnchorElement>('a[aria-label="Open project Cabinet"]')
    expect(link.text()).toContain('Cabinet')
    expect(link.find('button').exists()).toBe(false)
    expect(link.find('[role="menu"]').exists()).toBe(false)
    expect(wrapper.findAll('button').some(item => item.text() === 'Open')).toBe(false)
    link.element.focus()
    expect(document.activeElement).toBe(link.element)
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    link.element.dispatchEvent(enter)
    expect(enter.defaultPrevented).toBe(false)
    // jsdom does not implement Enter's native anchor activation; dispatch its keyboard click.
    link.element.dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true, cancelable: true })); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/projects/new-project/materials')
  })
  it.each(['Rename project', 'Export project', 'Delete project'])('keeps %s independent from row navigation', async action => {
    const { wrapper, router, transfer } = setup([project]); await flushPromises()
    const original = router.currentRoute.value.fullPath
    await menu(wrapper)
    expect(router.currentRoute.value.fullPath).toBe(original)
    await button(wrapper, action).trigger('click'); await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe(original)
    if (action === 'Export project') expect(transfer.export).toHaveBeenCalledExactlyOnceWith(project.id)
    else expect(wrapper.find('dialog').exists()).toBe(true)
  })
  it('uses one main list without detail statistics or permanent action rows', async () => {
    const { wrapper } = setup([project]); await flushPromises()
    expect(wrapper.get('header').text()).toContain('New project')
    expect(wrapper.get('header').text()).toContain('Import project')
    expect(wrapper.get('ul[aria-label="Projects"]').findAll('li')).toHaveLength(1)
    expect(wrapper.find('[aria-label="Selected project details"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Project metrics"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain(project.id)
    expect(wrapper.text()).not.toContain('Rename project')
    await menu(wrapper)
    expect(wrapper.get('[role="menu"]').findAll('[role="menuitem"]').map(item => item.text())).toEqual(['Rename project', 'Export project', 'Delete project'])
  })
  it('filters the main list and provides a clear searchable empty state', async () => {
    const second = cuttingProjectSchema.parse({ ...project, id: 'desk', name: 'Desk' })
    const { wrapper } = setup([project, second]); await flushPromises()
    await wrapper.get('#project-search').setValue('DESK')
    expect(wrapper.get('ul[aria-label="Projects"]').findAll('li')).toHaveLength(1)
    expect(wrapper.find('a[href="/projects/desk/materials"]').exists()).toBe(true)
    await wrapper.get('#project-search').setValue('absent')
    expect(wrapper.text()).toContain('No matching projects')
    expect(wrapper.find('ul[aria-label="Projects"]').exists()).toBe(false)
    await button(wrapper, 'Clear search').trigger('click')
    expect(wrapper.get('ul[aria-label="Projects"]').findAll('li')).toHaveLength(2)
  })
  it('supports keyboard menu navigation, Escape focus restoration and responsive row actions', async () => {
    const { wrapper } = setup([project]); await flushPromises()
    const trigger = wrapper.get<HTMLButtonElement>('button[aria-haspopup="menu"]')
    await trigger.trigger('keydown', { key: 'ArrowDown' }); await flushPromises()
    const items = wrapper.get('[role="menu"]').findAll('[role="menuitem"]')
    expect(document.activeElement).toBe(items[0]?.element)
    await items[0]?.trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1]?.element)
    await items[1]?.trigger('keydown', { key: 'End' })
    expect(document.activeElement).toBe(items[2]?.element)
    await items[2]?.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger.element)
    expect(trigger.attributes('aria-expanded')).toBe('false')
  })
  it('renames using a fresh record without replacing parts, catalog selections or panel quantities', async () => {
    const latest = cuttingProjectSchema.parse({ ...project, partIds: ['part-new'], materialIds: ['material-new'], supplierProductIds: ['product-new'], panelQuantities: [{ supplierProductId: 'product-new', quantity: 4 }] })
    const { wrapper, projects } = setup([project]); await flushPromises()
    projects.get.mockResolvedValue({ ok: true, value: latest })
    await menu(wrapper)
    await button(wrapper, 'Rename project').trigger('click')
    await wrapper.get('#project-name').setValue('  Updated cabinet  ')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(projects.update).toHaveBeenCalledExactlyOnceWith(project.id, { ...latest, name: 'Updated cabinet' })
    expect(projects.create).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Project renamed.')
  })
  it('keeps invalid and failed rename drafts and never re-creates a missing project', async () => {
    const { wrapper, projects } = setup([project]); await flushPromises()
    await menu(wrapper)
    await button(wrapper, 'Rename project').trigger('click')
    await wrapper.get('#project-name').setValue(' '); await wrapper.get('form').trigger('submit')
    expect(projects.update).not.toHaveBeenCalled()
    projects.get.mockResolvedValue({ ok: false, error: { kind: 'notFound', id: project.id } })
    await wrapper.get('#project-name').setValue('New name'); await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('no longer exists')
    expect(wrapper.get<HTMLInputElement>('#project-name').element.value).toBe('New name')
    expect(projects.create).not.toHaveBeenCalled(); expect(projects.update).not.toHaveBeenCalled()
  })
  it('defaults deletion to keeping stock, supports Cancel and retains errors in the dialog', async () => {
    const { wrapper, projects, service } = setup([project]); await flushPromises()
    await menu(wrapper)
    await button(wrapper, 'Delete project').trigger('click'); await flushPromises()
    expect(wrapper.get<HTMLInputElement>('input[value="keep"]').element.checked).toBe(true)
    expect(projects.delete).not.toHaveBeenCalled()
    await button(wrapper, 'Cancel').trigger('click')
    expect(wrapper.find('dialog').exists()).toBe(false)
    await menu(wrapper)
    await button(wrapper, 'Delete project').trigger('click'); await flushPromises()
    projects.delete.mockResolvedValueOnce({ ok: false, error: { kind: 'storageFailure', message: 'Disk full' } })
    await wrapper.get('dialog form').trigger('submit'); await flushPromises()
    expect(service.deleteProject).toHaveBeenCalledWith(project.id, 'keep')
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not access local storage')
    projects.list.mockResolvedValue({ ok: true, value: [] })
    await wrapper.get('dialog form').trigger('submit'); await flushPromises()
    expect(wrapper.find('dialog').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Selected project details"]').exists()).toBe(false)
  })
  it('presents a compact named confirmation with accessible clickable stock rows and close behavior', async () => {
    const { wrapper, service } = setup([project]); await flushPromises()
    const trigger = wrapper.get<HTMLButtonElement>('button[aria-haspopup="menu"]')
    trigger.element.focus()
    await menu(wrapper)
    await button(wrapper, 'Delete project').trigger('click'); await flushPromises()
    const dialog = wrapper.get('dialog')
    expect(dialog.classes()).toContain('app-dialog')
    expect(dialog.classes()).toContain('max-w-lg')
    expect(dialog.get(`#${dialog.attributes('aria-labelledby') ?? 'missing-label'}`).text()).toBe(`Delete "${project.name}"?`)
    expect(dialog.get(`#${dialog.attributes('aria-describedby') ?? 'missing-description'}`).text()).toBe('This will permanently delete the project and its cutting plans.')
    expect(dialog.get('legend').text()).toBe('What should happen to physical stock?')
    expect(dialog.text()).toContain('Recommended')
    const rows = dialog.findAll('label')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.classes()).toContain('bg-subtle')
    expect(rows[0]?.classes()).toContain('focus-within:ring-2')
    await rows[1]?.trigger('click')
    expect(dialog.get<HTMLInputElement>('input[value="restore"]').element.checked).toBe(true)
    expect(rows[1]?.classes()).toContain('bg-subtle')
    expect(rows[0]?.classes()).not.toContain('bg-subtle')
    for (const radio of dialog.findAll('input[type="radio"]')) {
      expect(radio.attributes('name')).toBe('stock-handling')
      expect(dialog.find(`#${radio.attributes('aria-describedby') ?? 'missing-description'}`).exists()).toBe(true)
    }
    await dialog.trigger('cancel')
    expect(wrapper.find('dialog').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger.element)
    expect(service.deleteProject).not.toHaveBeenCalled()
    await menu(wrapper)
    await button(wrapper, 'Delete project').trigger('click'); await flushPromises()
    expect(wrapper.get<HTMLInputElement>('input[value="keep"]').element.checked).toBe(true)
    await wrapper.get('button[aria-label="Close deletion dialog"]').trigger('click')
    expect(wrapper.find('dialog').exists()).toBe(false)
  })

  it('offers restoration and disables it when dependencies prevent a full reversal', async () => {
    const { wrapper, service } = setup([project]); await flushPromises()
    await menu(wrapper)
    await button(wrapper, 'Delete project').trigger('click'); await flushPromises()
    await wrapper.get('input[value="restore"]').setValue()
    await wrapper.get('dialog form').trigger('submit'); await flushPromises()
    expect(service.deleteProject).toHaveBeenCalledWith(project.id, 'restore')
    vi.spyOn(service, 'deletionPreview').mockResolvedValue({ ok: true, value: { restorationIssues: ['Offcut used by another project'] } })
    await menu(wrapper)
    await button(wrapper, 'Delete project').trigger('click'); await flushPromises()
    expect(wrapper.get('input[value="restore"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Offcut used by another project')
    expect(wrapper.get('input[value="restore"]').attributes('aria-describedby')).toContain('stock-restoration-conflicts')
    expect(wrapper.get<HTMLInputElement>('input[value="keep"]').element.checked).toBe(true)
  })
  it('exports the selected stable ID with the existing transfer component and reports failures', async () => {
    const second = cuttingProjectSchema.parse({ ...project, id: 'second' })
    const { wrapper, transfer } = setup([project, second]); await flushPromises()
    await menu(wrapper, 1)
    await button(wrapper, 'Export project').trigger('click'); await flushPromises()
    expect(transfer.export).toHaveBeenCalledExactlyOnceWith(second.id)
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not access local storage')
  })
  it('downloads the selected project through the unchanged project format with the new extension', async () => {
    const second = cuttingProjectSchema.parse({ ...project, id: 'second', name: 'Desk' })
    const { wrapper, transfer } = setup([project, second]); await flushPromises()
    await menu(wrapper, 1)
    transfer.export.mockResolvedValue({ ok: true, value: { text: '{"format":"opticutlist-project","schemaVersion":1}', name: second.name } })
    const create = vi.fn(() => 'blob:project'); const revoke = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
    let filename = ''
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download })
    await button(wrapper, 'Export project').trigger('click'); await flushPromises()
    expect(transfer.export).toHaveBeenCalledExactlyOnceWith(second.id)
    expect(click).toHaveBeenCalledOnce(); expect(filename).toBe('desk.oclproject.json')
    expect(wrapper.text()).toContain('Project JSON download started')
  })
  it('shows storage read errors and retries without presenting an empty inventory', async () => {
    const { wrapper, projects } = setup([project]); await flushPromises()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    projects.list.mockResolvedValueOnce({ ok: false, error: { kind: 'storageFailure', message: 'Unavailable' } })
    await menu(wrapper)
    await button(wrapper, 'Delete project').trigger('click'); await flushPromises()
    await wrapper.get('dialog form').trigger('submit'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not access local storage')
    expect(wrapper.findAll('.home-card')).toHaveLength(0)
    await button(wrapper, 'Retry projects').trigger('click'); await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })
})
