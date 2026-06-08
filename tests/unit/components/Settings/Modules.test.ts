import { describe, test, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Modules from '../../../../src/components/Settings/Modules.vue';
import { i18n, messages } from '../../../setup';

describe('Modules Settings Component', () => {
  let mockConfig;
  let mockScrapedModules;

  beforeEach(() => {
    // Reset mock data before each test
    mockConfig = {
      modules: [
        {
          url: 'https://example.com/module1',
          config: '',
          showInCustom: '*'
        },
        {
          url: 'https://example.com/module2',
          config: '',
          showInCustom: 'lobby'
        }
      ]
    };

    mockScrapedModules = [
      { name: 'Module 1', description: 'Test description 1', icon: 'mdi-test' },
      { name: 'Module 2', description: 'Test description 2' }
    ];
  });

  const createWrapper = (props = {}) => {
    return mount(Modules, {
      props: {
        config: mockConfig,
        scrapedModules: mockScrapedModules,
        writeProtection: false,
        ...props
      },
      global: {
        stubs: {
          'v-list': {
            template: '<div class="v-list"><slot /></div>'
          },
          'v-list-item': {
            template: '<div class="v-list-item" data-test="module-item"><slot /><slot name="prepend" /><slot name="append" /></div>'
            
          },
          'v-list-item-title': {
            template: '<div class="v-list-item-title"><slot /></div>'
          },
          'v-list-item-subtitle': {
            template: '<div class="v-list-item-subtitle"><slot /></div>'
          },
          'v-btn': {
            template: '<button :class="[$attrs.color, $attrs.icon]" :disabled="$attrs.disabled"><slot /></button>',
            inheritAttrs: false
          },
          'v-icon': {
            template: '<span class="v-icon"><slot /></span>'
          },
          'v-menu': {
            template: `
              <div class="v-menu">
                <div class="v-menu__activator">
                  <slot name="activator" :props="{ isActive: true }" />
                </div>
                <div class="v-menu__content">
                  <slot />
                </div>
              </div>
            `,
            inheritAttrs: false
          },
          'v-chip': true,
          'v-text-field': {
            template: '<input type="text" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
            props: ['modelValue']
          },
          'v-divider': true,
          draggable: {
            template: '<div class="draggable-container"><slot name="item" v-for="(item, index) in list" :key="index" :element="item" :index="index" /></div>',
            props: ['list']
          },
          Module: true
        }
      }
    });
  };

  // Mock the scrapeModule function
  vi.mock('../../../../src/ts/Utils', () => ({
    scrapeModule: vi.fn().mockResolvedValue({ name: 'New Module', description: 'New Description' }),
    validateUrl: vi.fn().mockReturnValue(true)
  }));

  test('renders module list', () => {
    const wrapper = createWrapper();
    const moduleItems = wrapper.findAll('.list-group-item');
    expect(moduleItems).toHaveLength(mockConfig.modules.length);
  });

  test('handles module deletion', async () => {
    const wrapper = createWrapper();
    wrapper.vm.deleteModule(0);
    expect(wrapper.vm.config.modules).toHaveLength(1);
    expect(wrapper.vm.errors).toHaveLength(1);
    expect(wrapper.vm.scrapedModules).toHaveLength(1);
  });

  test('handles module addition', async () => {
    const wrapper = createWrapper();
    wrapper.vm.moduleImportUrl = 'https://example.com/new-module';
    await wrapper.vm.loadURL();
    expect(wrapper.vm.config.modules).toHaveLength(3);
    expect(wrapper.vm.moduleImportUrl).toBe('');
  });

  test('validates module configuration', () => {
    const wrapper = createWrapper();
    expect(wrapper.vm.validate_config(0)).toBe(true);
    wrapper.vm.errors[0].config = 'error';
    expect(wrapper.vm.validate_config(0)).toBe(false);
  });

  test('disables controls when write protected', () => {
    const wrapper = createWrapper({ writeProtection: true });
    const draggableContainer = wrapper.find('.draggable-container');
    expect(draggableContainer.attributes('disabled')).toBeTruthy();
  });

  describe('translations', () => {
    test.each(['en', 'de', 'uk', 'ar', 'es'])('displays correct translations for %s locale', async (locale) => {
      i18n.global.locale.value = locale as 'en' | 'de' | 'uk' | 'ar' | 'es';
      const wrapper = createWrapper();
      
      const translations = messages[locale].settings.modules;

      // Check module URL input label
      const urlInput = wrapper.find('input');
      expect(urlInput.attributes('label')).toBe(translations.url);

      // Check Add button text
      const addButton = wrapper.findAll('button').find(btn => btn.text().includes(translations.add));
      expect(addButton).toBeTruthy();

      // Check delete confirmation text
      const deleteConfirmation = wrapper.findAll('.v-list-item-title').find(el => el.text().includes(translations.delete));
      expect(deleteConfirmation).toBeTruthy();

      // Check delete button text
      const deleteButton = wrapper.findAll('button').find(btn => btn.text().includes(translations.deleteConfirm));
      expect(deleteButton).toBeTruthy();

      // Check explore button text
      const exploreButton = wrapper.findAll('button').find(btn => btn.text().includes(translations.explore));
      expect(exploreButton).toBeTruthy();

      // Check "No description" text
      await wrapper.setProps({
        scrapedModules: [
          { name: 'Module 1', description: '' },
          { name: 'Module 2', description: '' }
        ]
      });
            
      const noDescriptionText = wrapper.findAll('.v-list-item-subtitle').find(el => el.text().includes(translations.noDescription));
      expect(noDescriptionText).toBeTruthy();
    });
  });
});
