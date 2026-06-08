import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import ModuleConfigForm from '../../../../src/components/Settings/ModuleConfigForm.vue';
import { i18n } from '../../../setup';
import * as Utils from '../../../../src/ts/Utils';

// Define interface for component's data structure
interface ModuleConfigFormData {
  configSchemas: {
    config: Record<string, any> | null;
    studentConfig: Record<string, any> | null;
    teacherConfig: Record<string, any> | null;
    stationConfig: Record<string, any> | null;
  };
  formValues: {
    config: Record<string, any>;
    studentConfig: Record<string, any>;
    teacherConfig: Record<string, any>;
    stationConfig: Record<string, any>;
  };
  activeTab: string | null;
  originalValues: {
    config: Record<string, any>;
    studentConfig: Record<string, any>;
    teacherConfig: Record<string, any>;
    stationConfig: Record<string, any>;
  };
}

const stubs = {
  'v-dialog': {
    template: '<div class="v-dialog"><slot /></div>',
  },
  'v-card': {
    template: '<div class="v-card"><slot /></div>',
  },
  'v-toolbar': {
    template: '<div class="v-toolbar"><slot /></div>',
  },
  'v-toolbar-title': {
    template: '<div class="v-toolbar-title"><slot /></div>',
  },
  'v-btn': {
    template: '<button class="v-btn" @click="$attrs.onClick"><slot /></button>',
  },
  'v-icon': {
    template: '<i class="v-icon">{{ $attrs.icon }}</i>',
  },
  'v-tabs': {
    template: '<div class="v-tabs"><slot /></div>',
  },
  'v-tab': {
    template: '<div class="v-tab"><slot /></div>',
  },
  'v-window': {
    template: '<div class="v-window"><slot /></div>',
  },
  'v-window-item': {
    template: '<div class="v-window-item"><slot /></div>',
  },
  'v-checkbox': {
    template: '<div class="v-checkbox"><input type="checkbox" v-model="$attrs.modelValue" /></div>',
  },
  'v-text-field': {
    template: '<div class="v-text-field"><input :type="$attrs.type || \'text\'" v-model="$attrs.modelValue" /></div>',
  },
  'v-textarea': {
    template: '<div class="v-textarea"><textarea v-model="$attrs.modelValue"></textarea></div>',
  },
  'v-color-picker': {
    template: '<div class="v-color-picker"></div>',
  },
  'v-radio-group': {
    template: '<div class="v-radio-group"><slot /></div>',
  },
  'v-radio': {
    template: '<div class="v-radio"><input type="radio" :value="$attrs.value" v-model="$attrs.modelValue" /></div>',
  },
  'v-badge': {
    template: '<div v-if="$attrs.modelValue !== false" class="v-badge"><slot /></div>',
  },
  'v-card-actions': {
    template: '<div class="v-card-actions"><slot /></div>',
  },
  'v-card-text': {
    template: '<div class="v-card-text"><slot /></div>',
  },
  'v-alert': {
    template: '<div class="v-alert"><slot /></div>',
  },
  'v-divider': {
    template: '<hr class="v-divider" />',
  }
};

// Mock parse function from Utils
vi.mock('../../../../src/ts/Utils', () => ({
  parse: vi.fn((content) => {
    try {
      return JSON.parse(content);
    } catch (e) {
      return content; // Return content directly for test simplicity
    }
  })
}));

describe('ModuleConfigForm Component', () => {
  let wrapper: any;
  
  // Module config with different field types
  const complexModuleConfig = JSON.stringify({
    config: {
      textField: { type: 'string', hint: 'Enter some text' },
      numberField: { type: 'number', hint: '0-100' },
      checkboxField: { type: 'boolean', hint: 'Check this box' },
      dateField: { type: 'date', hint: 'Select a date' },
      textareaField: { type: 'text-area', hint: 'Enter multi-line text' },
      colorField: { type: 'color', hint: 'Choose a color' },
      radioField: { 
        type: 'radio-button', 
        options: ['Option 1', 'Option 2', 'Option 3'],
        hint: 'Choose one option' 
      }
    },
    studentConfig: {
      allowSubmit: { type: 'boolean', hint: 'Allow students to submit' }
    }
  });

  const currentConfig = JSON.stringify({
    textField: 'Sample text',
    numberField: 42,
    checkboxField: true,
    dateField: '2023-01-01',
    textareaField: 'Multiple\nLines\nText',
    colorField: '#FF5733',
    radioField: 'Option 2'
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const createWrapper = (props = {}) => {
    return mount(ModuleConfigForm, {
      props: {
        moduleName: 'Test Module',
        moduleConfig: '',
        currentConfig: '',
        currentStudentConfig: '',
        currentTeacherConfig: '',
        currentStationConfig: '',
        writeProtection: false,
        ...props
      },
      global: {
        stubs,
      }
    });
  };

  test('renders without errors', () => {
    wrapper = createWrapper();
    expect(wrapper.find('.v-card').exists()).toBe(true);
    expect(wrapper.find('.v-toolbar-title').text()).toContain('Module Configuration');
    expect(wrapper.find('.v-toolbar-title').text()).toContain('Test Module');
  });

  test('displays "no schema" message when no module config is provided', () => {
    wrapper = createWrapper();
    expect(wrapper.find('.v-alert').exists()).toBe(true);
    expect(wrapper.find('.v-alert').text()).toContain("This module doesn't provide a valid configuration schema");
  });

  test('parses module config and renders form fields', async () => {
    wrapper = createWrapper({
      moduleConfig: complexModuleConfig,
      currentConfig
    });
    
    expect(wrapper.find('.v-tab').exists()).toBe(true);    
    expect(wrapper.find('.v-text-field').exists()).toBe(true);
    expect(wrapper.find('.v-checkbox').exists()).toBe(true);
  });

  test('initializes form values with current config values', async () => {
    wrapper = createWrapper({
      moduleConfig: complexModuleConfig,
      currentConfig
    });
        
    const vm = wrapper.vm as ModuleConfigFormData;
    expect(vm.formValues.config.textField).toBe('Sample text');
    expect(vm.formValues.config.numberField).toBe(42);
    expect(vm.formValues.config.checkboxField).toBe(true);
    expect(vm.formValues.config.radioField).toBe('Option 2');
  });

  test('emits save event with form values when save button is clicked', async () => {
    wrapper = createWrapper({
      moduleConfig: complexModuleConfig,
      currentConfig
    });

    await flushPromises();

    // Modify a form value
    const vm = wrapper.vm as ModuleConfigFormData;
    vm.formValues.config.textField = 'Modified text';
    
    // Find all buttons and click the save button (should be the last one)
    const buttons = wrapper.findAll('.v-btn');
    await buttons[buttons.length - 1].trigger('click');

    // Check emitted events
    expect(wrapper.emitted().save).toBeTruthy();
    expect(wrapper.emitted().close).toBeTruthy();
    
    // Verify the saved data structure
    const savedData = wrapper.emitted().save[0][0];
    expect(savedData.config.textField).toBe('Modified text');
  });

  test('hasChanges correctly identifies differences between objects', async () => {
    wrapper = createWrapper({
      moduleConfig: complexModuleConfig,
      currentConfig
    });
        
    const vm = wrapper.vm;
    
    // Directly modify originalValues to ensure they're different
    vm.originalValues = JSON.parse(JSON.stringify(vm.formValues));
    vm.formValues.config.textField = 'Changed value';
    
    expect(vm.hasChanges).toBe(true);
    
    vm.formValues.config.numberField = 100;
    expect(vm.hasChanges).toBe(true);
  });

  test('handles empty or malformed module config gracefully', async () => {
    // Test with invalid JSON
    wrapper = createWrapper({
      moduleConfig: '{invalid-json}',
    });
        
    expect(wrapper.find('.v-alert').exists()).toBe(true);
    
    expect(Utils.parse).toHaveBeenCalled();
  });

  test('responds correctly to writeProtection prop', async () => {
    wrapper = createWrapper({
      moduleConfig: complexModuleConfig,
      writeProtection: true
    });
    
    
    const buttons = wrapper.findAll('.v-btn');
    const saveButton = buttons[buttons.length - 1];
    expect(saveButton.attributes('disabled')).toBeDefined();
  });
  
  describe('calls parseModuleConfig on mount', () => {
    test('correctly processes different field types', async () => {
      const parseModuleConfigSpy = vi.spyOn(ModuleConfigForm.methods!, 'parseModuleConfig');
      
      wrapper = createWrapper({
        moduleConfig: complexModuleConfig
      });
      
      expect(parseModuleConfigSpy).toHaveBeenCalled();
      expect(Utils.parse).toHaveBeenCalledWith(complexModuleConfig);
            
      // Verify it parsed all the field types
      const vm = wrapper.vm as ModuleConfigFormData;
      expect(vm.configSchemas.config?.textField).toBeDefined();
      expect(vm.configSchemas.config?.numberField).toBeDefined();
      expect(vm.configSchemas.config?.checkboxField).toBeDefined();
      expect(vm.configSchemas.config?.dateField).toBeDefined();
      expect(vm.configSchemas.config?.colorField).toBeDefined();
      expect(vm.configSchemas.config?.radioField).toBeDefined();
    });
  });

  describe('translations', () => {
    test.each(['en', 'de', 'uk', 'ar', 'es'])('displays with %s locale', async (locale) => {
      i18n.global.locale.value = locale as 'en' | 'de' | 'uk' | 'ar' | 'es';
      wrapper = createWrapper({
        moduleConfig: complexModuleConfig,
        currentConfig
      });
      
      await flushPromises();
      
      // Verify key UI elements are present regardless of locale
      expect(wrapper.find('.v-toolbar-title').exists()).toBe(true);
      expect(wrapper.find('.v-card-text').exists()).toBe(true);
      
      // Check that the save button exists
      const buttons = wrapper.findAll('.v-btn');
      const saveButton = buttons[buttons.length - 1];
      expect(saveButton.exists()).toBe(true);
    });
  });
});