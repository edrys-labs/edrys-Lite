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
            template: '<input type="text" :label="$attrs.label" :value="modelValue" :disabled="$attrs.disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
            props: ['modelValue'],
            inheritAttrs: false
          },
          'v-radio-group': {
            template: '<div class="v-radio-group" :data-disabled="disabled"><slot /></div>',
            props: ['modelValue', 'disabled']
          },
          'v-radio': {
            template: `<div class="v-radio" data-test-label="true">{{label}}</div>`,
            props: ['label']
          },
          'v-row': {
            template: '<div class="v-row"><slot /></div>'
          },
          'v-col': {
            template: '<div class="v-col"><slot /></div>'
          },
          'v-container': {
            template: '<div class="v-container"><slot /></div>'
          },
          'v-icon': true,
          Editor: {
            template: '<div class="editor" :title="$attrs.title"><slot /></div>',
            inheritAttrs: false
          }
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


  test('emits error updates', async () => {
    const wrapper = createWrapper();
    await wrapper.setProps({
      error: { ...mockError, config: 'Test error' }
    });
    expect(wrapper.emitted('update:error')).toBeTruthy();
  });
});
