import { describe, test, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import FieldLabel from '../../../src/components/FieldLabel.vue';

const Form = {
  components: { FieldLabel },
  template: `
    <FieldLabel label="Class Name"><input /><p class="hint">Shown under the field</p></FieldLabel>
    <FieldLabel label="Logo URL"><input /></FieldLabel>
  `,
};

describe('FieldLabel', () => {
  test('names its field', () => {
    const wrapper = mount(Form);
    const [label] = wrapper.findAll('label');
    const [input] = wrapper.findAll('input');
    expect(label.text()).toBe('Class Name');
    expect(label.attributes('for')).toBe(input.attributes('id'));
  });

  test('keeps what follows the field', () => {
    const field = mount(Form).find('.field');
    expect(field.find('.hint').text()).toBe('Shown under the field');
    expect(field.find('.hint').attributes('id')).toBeUndefined();
  });

  test('gives each field its own id', () => {
    const ids = mount(Form).findAll('input').map((i) => i.attributes('id'));
    expect(new Set(ids).size).toBe(2);
  });
});
