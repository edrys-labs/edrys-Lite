import { describe, test, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Modules from '../../../../src/components/Settings/Modules.vue';

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
          'v-list-item-title': true,
          'v-list-item-subtitle': true,
          'v-btn': {
            template: '<button><slot /></button>',
            props: ['disabled', 'writeProtection']
          },
          'v-icon': true,
          'v-chip': true,
          'v-menu': true,
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
    const moduleItems = wrapper.findAll('[data-test="module-item"]');
    expect(moduleItems).toHaveLength(mockConfig.modules.length + 1); // +1 for the add module item
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
});
