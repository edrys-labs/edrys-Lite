import { describe, test, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import Module from '../../../../src/components/Settings/Module.vue';

describe('Module Settings Component', () => {
  const mockModule = {
    url: 'https://example.com/module',
    width: 'full',
    height: 'tall',
    config: '',
    studentConfig: '',
    teacherConfig: '',
    stationConfig: '',
    showInCustom: '*'
  };

  const mockError = {
    config: '',
    studentConfig: '',
    teacherConfig: '',
    stationConfig: '',
    showInCustom: ''
  };

  const createWrapper = (props = {}) => {
    return mount(Module, {
      props: {
        module: mockModule,
        error: mockError,
        writeProtection: false,
        ...props
      },
      global: {
        stubs: {
          'v-expansion-panels': {
            template: '<div class="v-expansion-panels"><slot /></div>'
          },
          'v-expansion-panel': {
            template: '<div class="v-expansion-panel"><slot /></div>'
          },
          'v-expansion-panel-title': {
            template: '<div class="v-expansion-panel-title"><slot /><slot name="actions" /></div>'
          },
          'v-expansion-panel-text': {
            template: '<div class="v-expansion-panel-text"><slot /></div>'
          },
          'v-text-field': {
            template: '<input type="text" :value="modelValue" :disabled="writeProtection" @input="$emit(\'update:modelValue\', $event.target.value)" />',
            props: ['modelValue', 'writeProtection']
          },
          'v-radio-group': {
            template: '<div class="v-radio-group" :data-disabled="disabled"><slot /></div>',
            props: ['modelValue', 'disabled']
          },
          'v-radio': true,
          'v-row': true,
          'v-col': true,
          'v-container': true,
          'v-icon': true,
           Editor: true
        }
      }
    });
  };

  test('renders module settings', () => {
    const wrapper = createWrapper();
    expect((wrapper.find('input[type="text"]').element as HTMLInputElement).value).toBe('https://example.com/module');
  });

  test('updates module URL', async () => {
    const wrapper = createWrapper();
    const input = wrapper.find('input[type="text"]');
    await input.setValue('https://newexample.com/module');
    expect(wrapper.vm.module.url).toBe('https://newexample.com/module');
  });

  test('disables inputs when write protected', () => {
    const wrapper = createWrapper({ writeProtection: true });
    const textFields = wrapper.findAll('.v-text-field input');
    const radioGroups = wrapper.findAll('.v-radio-group');
    
    textFields.forEach(input => {
      expect((input.element as HTMLInputElement).disabled).toBe(true);
    });
    
    radioGroups.forEach(group => {
      expect(group.attributes('data-disabled')).toBe('true');
    });
  });

  test('emits error updates', async () => {
    const wrapper = createWrapper();
    await wrapper.setProps({
      error: { ...mockError, config: 'Test error' }
    });
    expect(wrapper.emitted('update:error')).toBeTruthy();
  });
});
