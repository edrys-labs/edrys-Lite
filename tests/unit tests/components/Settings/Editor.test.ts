import { describe, test, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import Editor from '../../../../src/components/Settings/Editor.vue';

describe('Editor Component', () => {
  const mockPrismHighlight = vi.fn((code) => code);
  const mockPrismLanguages = { yaml: {} };

  const createWrapper = (props = {}) => {
    return mount(Editor, {
      props: {
        config: {},
        title: 'Test Editor',
        icon: 'mdi-test',
        writeProtection: false,
        ...props
      },
      global: {
        provide: {
          prismHighlight: mockPrismHighlight,
          prismLanguages: mockPrismLanguages
        },
        stubs: {
          'v-expansion-panel': {
            template: '<div class="v-expansion-panel"><slot /></div>'
          },
          'v-expansion-panel-title': {
            template: '<div class="v-expansion-panel-title"><slot /><slot name="actions" /></div>'
          },
          'v-expansion-panel-text': {
            template: '<div class="v-expansion-panel-text"><slot /></div>'
          },
          'v-icon': true,
          'v-divider': true,
          'prism-editor': {
            template: '<div class="prism-editor" :data-readonly="readonly"><textarea v-model="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" :readonly="readonly"></textarea></div>',
            props: {
              modelValue: String,
              readonly: Boolean,
              highlight: Function
            }
          }
        }
      }
    });
  };

  test('renders editor with initial config', () => {
    const config = { test: 'value' };
    const wrapper = createWrapper({ config });
    const editor = wrapper.find('.prism-editor textarea');
    expect((editor.element as HTMLInputElement).value).toContain('test: value');
  });

  test('handles string config with line breaks', () => {
    const config = 'line1\nline2';
    const wrapper = createWrapper({ config });
    const editor = wrapper.find('.prism-editor textarea');
    expect((editor.element as HTMLInputElement).value).toContain('|-\n  line1\n  line2');
  });

  test('emits update:config on valid yaml input', async () => {
    const wrapper = createWrapper();
    const editor = wrapper.find('.prism-editor textarea');
    
    await editor.setValue('test: value');
    
    expect(wrapper.emitted('update:config')).toBeTruthy();
    expect(wrapper.emitted('update:config')[0][0]).toEqual({ test: 'value' });
  });

  test('shows error message on invalid input', async () => {
    const wrapper = createWrapper();
    const editor = wrapper.find('.prism-editor textarea');
    
    await editor.setValue('invalid: yaml: : :');
    
    const errorDiv = wrapper.find('div[style*="color: red"]');
    expect(errorDiv.exists()).toBe(true);
    expect(wrapper.vm.errorMessage).toBeTruthy();
  });

  test('respects write protection', () => {
    const wrapper = createWrapper({ writeProtection: true });
    const editor = wrapper.find('.prism-editor');
    expect(editor.attributes('data-readonly')).toBe('true');
    const textarea = editor.find('textarea');
    expect(textarea.attributes('readonly')).toBe('');
  });

  test('highlights code using prism', () => {
    const wrapper = createWrapper();
    wrapper.vm.highlighter('test: value');
    expect(mockPrismHighlight).toHaveBeenCalledWith('test: value', mockPrismLanguages.yaml, 'yaml');
  });

  test('handles fallback when prism is not available', () => {
    const wrapper = createWrapper();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // Remove prism dependencies
    wrapper.vm.prismHighlight = null;
    
    const result = wrapper.vm.highlighter('test: value');
    expect(result).toBe('test: value');
    expect(consoleSpy).toHaveBeenCalled();
    
    consoleSpy.mockRestore();
  });
});
