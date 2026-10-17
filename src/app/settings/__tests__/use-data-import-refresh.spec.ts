import { mount } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { dataImportRevisionKey } from '@/ui/state/data-import-revision'
import { useDataImportRefresh } from '@/ui/composables/use-data-import-refresh'

describe('catalog import UI invalidation', () => {
  it('coalesces imports, waits for active drafts/writes and detaches on unmount', async () => {
    const revision = ref(0)
    const ready = ref(false)
    const reload = vi.fn()
    const component = defineComponent({ setup() { useDataImportRefresh(reload, () => ready.value); return () => null } })
    const wrapper = mount(component, { global: { provide: { [dataImportRevisionKey]: revision } } })
    expect(reload).not.toHaveBeenCalled()
    revision.value++; revision.value++; await nextTick()
    expect(reload).not.toHaveBeenCalled()
    ready.value = true; await nextTick()
    expect(reload).toHaveBeenCalledOnce()
    ready.value = false; await nextTick(); ready.value = true; await nextTick()
    expect(reload).toHaveBeenCalledOnce()
    revision.value++; await nextTick()
    expect(reload).toHaveBeenCalledTimes(2)
    wrapper.unmount(); revision.value++; await nextTick()
    expect(reload).toHaveBeenCalledTimes(2)
  })
})
