import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppRouter } from '../../../app/router'
import ProjectsView from '../../../app/views/ProjectsView.vue'
import { cuttingProjectSchema } from '../../../domain/model/cutting-project'
import type { ProjectService } from '../../../application/projects/project-service'
import { projectServiceKey } from '../project-service'

const project = cuttingProjectSchema.parse({ id: 'new-project', name: 'Cabinet', partIds: [], materialIds: [], supplierProductIds: [] })
const wrappers: VueWrapper[] = []
afterEach(() => { for (const wrapper of wrappers) wrapper.unmount(); wrappers.length = 0 })
function setup() {
  const projects = {
    create: vi.fn<ProjectService['projects']['create']>().mockResolvedValue({ ok: true, value: project }),
    get: vi.fn<ProjectService['projects']['get']>().mockResolvedValue({ ok: true, value: project }),
    list: vi.fn<ProjectService['projects']['list']>().mockResolvedValue({ ok: true, value: [] }),
    update: vi.fn<ProjectService['projects']['update']>().mockResolvedValue({ ok: true, value: project }),
    delete: vi.fn<ProjectService['projects']['delete']>().mockResolvedValue({ ok: true, value: undefined }),
  }
  const service: ProjectService = {
    projects, parts: () => { throw new Error('Unused') },
    listLegacyParts: () => Promise.resolve({ ok: true, value: [] }),
    adoptLegacyParts: () => Promise.resolve({ ok: true, value: undefined }),
  }
  const router = createAppRouter(createMemoryHistory())
  const wrapper = mount(ProjectsView, { global: { plugins: [router], provide: { [projectServiceKey]: service } }, attachTo: document.body })
  wrappers.push(wrapper)
  return { wrapper, projects, router }
}
describe('Project creation', () => {
  it('validates the required name and focuses the field without writing', async () => {
    const { wrapper, projects } = setup()
    await wrapper.get('#project-name').setValue(' ')
    await wrapper.get('form').trigger('submit')
    expect(projects.create).not.toHaveBeenCalled()
    expect(wrapper.get('#project-name').attributes('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(wrapper.get('#project-name').element)
  })
  it('creates a schema-valid project and opens the result with a stable ID', async () => {
    const { wrapper, projects, router } = setup()
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
    await wrapper.get('#project-name').setValue('Cabinet')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not access local storage')
    expect(wrapper.get<HTMLInputElement>('#project-name').element.value).toBe('Cabinet')
  })
  it('blocks duplicate submissions while creation is pending', async () => {
    const { wrapper, projects } = setup()
    projects.create.mockReturnValue(new Promise(() => {}))
    await wrapper.get('#project-name').setValue('Cabinet')
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    expect(projects.create).toHaveBeenCalledTimes(1)
    expect(wrapper.get('form button').attributes('disabled')).toBeDefined()
  })
})
