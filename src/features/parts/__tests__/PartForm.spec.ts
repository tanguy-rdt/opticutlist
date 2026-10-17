import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PartForm from '@/ui/components/parts/PartForm.vue'
import { partSchema } from '../../../domain/model/part'
import { materialSchema } from '../../../domain/model/material'
import { validMaterialInput, validPartInput } from '../../../domain/model/__tests__/fixtures'

const material = materialSchema.parse(validMaterialInput)
describe('Part form grain and rotation controls', () => {
  it.each(['create', 'edit'] as const)('groups dimensions and retains the independent rotation preference during %s', async mode => {
    const part = partSchema.parse({ ...validPartInput, grainDirection: 'none', rotation: 'forbidden' })
    const wrapper = mount(PartForm, { props: { part: mode === 'edit' ? part : null, materials: [material], disabled: false, busy: false } })
    const grain = wrapper.get('#part-grain')
    const section = grain.element.closest('section')
    expect(section?.querySelector('h3')?.textContent.trim()).toBe('Dimensions')
    for (const id of ['part-length', 'part-width', 'part-thickness']) expect(section?.querySelector(`#${id}`)).not.toBeNull()
    expect(wrapper.text()).not.toContain("Direction relative to this part's length and width.")
    expect(wrapper.text()).not.toContain('Grain direction still applies when rotation is allowed.')
    expect(wrapper.get('#part-rotation').element.closest('section')?.querySelector('h3')?.textContent.trim()).toBe('Cutting constraints')
    await wrapper.get('#part-rotation').setValue('forbidden')
    for (const direction of ['length', 'width']) {
      await grain.setValue(direction)
      expect(wrapper.find('#part-rotation').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Cutting constraints')
    }
    await grain.setValue('none')
    expect(wrapper.get<HTMLSelectElement>('#part-rotation').element.value).toBe('forbidden')
    await wrapper.get('#part-rotation').setValue('allowed')
    await grain.setValue('length')
    await grain.setValue('none')
    expect(wrapper.get<HTMLSelectElement>('#part-rotation').element.value).toBe('allowed')
    wrapper.unmount()
  })

  it.each(['allowed', 'forbidden'] as const)('keeps legacy %s preferences without exposing a misleading grain-constrained control', async rotation => {
    const part = partSchema.parse({ ...validPartInput, grainDirection: 'length', rotation })
    const wrapper = mount(PartForm, { props: { part, materials: [material], disabled: false, busy: false } })
    expect(wrapper.find('#part-rotation').exists()).toBe(false)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('save')).toEqual([[part]])
    await wrapper.get('#part-grain').setValue('none')
    expect(wrapper.get<HTMLSelectElement>('#part-rotation').element.value).toBe(rotation)
    wrapper.unmount()
  })
})
