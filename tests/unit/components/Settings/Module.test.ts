import { describe, test, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import Module from '../../../../src/components/Settings/Module.vue';
import { i18n, messages } from '../../../setup';

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

  describe('translations', () => {
    test.each(['en', 'de', 'uk', 'ar', 'es'])('displays correct translations for %s locale', (locale) => {
      i18n.global.locale.value = locale as 'en' | 'de' | 'uk' | 'ar' | 'es';
      const wrapper = createWrapper();
      
      const translations = messages[locale].settings.modules.module;

      // Check URL panel
      const urlTitle = wrapper.find('.v-expansion-panel-title');
      expect(urlTitle.text()).toContain(translations.url.title);
      const urlInput = wrapper.find('input');
      expect(urlInput.attributes('label')).toBe(translations.url.urlLabel);

      // Check Design panel and its title
      const designTitle = wrapper.findAll('.v-expansion-panel-title').at(1);
      expect(designTitle.text()).toContain(translations.design.title);

      // Find all radio groups
      const radioGroups = wrapper.findAll('.v-radio-group');
      expect(radioGroups.length).toBeGreaterThan(0);

      // Check width radio labels (first group)
      const widthLabels = [
        translations.design.width.full,
        translations.design.width.half,
        translations.design.width.quarter,
        translations.design.width.custom.title
      ];
      
      widthLabels.forEach(label => {
        const radio = wrapper.findAll('.v-radio').find(r => r.text() === label);
        expect(radio).toBeTruthy();
      });

      // Check height radio labels (second group)
      const heightLabels = [
        translations.design.height.huge,
        translations.design.height.tall,
        translations.design.height.medium,
        translations.design.height.short,
        translations.design.height.custom.title
      ];
      
      heightLabels.forEach(label => {
        const radio = wrapper.findAll('.v-radio').find(r => r.text() === label);
        expect(radio).toBeTruthy();
      });

      // Check panel titles
      const panelTitles = wrapper.findAll('.v-expansion-panel-title');
      const expectedTitles = [
        translations.url.title,
        translations.design.title,
        translations.showIn.title
      ];
      expectedTitles.forEach((title, index) => {
        expect(panelTitles[index].text()).toContain(title);
      });

      // Check Editor titles
      const editorTitles = [
        translations.generalSettings,
        translations.studentSettings,
        translations.teacherSettings,
        translations.stationSettings
      ];
      editorTitles.forEach(title => {
        const editor = wrapper.findAll('.editor').find(e => e.attributes('title') === title);
        expect(editor).toBeTruthy();
      });

      // Check Show In input label
      const showInInput = wrapper.findAll('input').at(-1);
      expect(showInInput.attributes('label')).toBe(translations.showIn.label);
    });
  });
});
