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
  'v-select': {
    template: '<div class="v-select"><select v-model="$attrs.modelValue"></select></div>',
  },
  'v-combobox': {
    template: '<div class="v-combobox"><input v-model="$attrs.modelValue" /></div>',
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

  describe('select, combobox and presets', () => {
    // Mirrors what module-pyxtermjs declares: a `workflow` picker whose
    // presets fill in the sibling fields of the same config type.
    const presetModuleConfig = JSON.stringify({
      stationConfig: {
        workflow: {
          type: 'select',
          options: ['arduino-avr', 'micropython'],
          presets: {
            // `board` uses the { value, options } form; the rest are plain
            'arduino-avr': {
              board: {
                value: 'arduino:avr:uno',
                options: ['arduino:avr:uno', 'arduino:avr:mega'],
              },
              port: '/dev/ttyACM0',
              baud: 9600,
              script: 'arduino-cli compile -b $BOARD $SKETCH',
            },
            micropython: {
              board: { value: '', options: [] },
              port: 'auto',
              baud: 115200,
              script: 'mpremote connect $PORT fs cp $FILE :$FILE',
            },
          },
        },
        board: {
          type: 'combobox',
          options: ['arduino:avr:uno', 'esp32:esp32:esp32', 'avr128db48'],
        },
        port: { type: 'string' },
        baud: { type: 'number' },
        script: { type: 'code-area' },
      },
    });

    const createPresetWrapper = (currentStationConfig = '') =>
      createWrapper({ moduleConfig: presetModuleConfig, currentStationConfig });

    test('renders select and combobox fields, both defaulting to empty', () => {
      wrapper = createPresetWrapper();

      expect(wrapper.find('.v-select').exists()).toBe(true);
      expect(wrapper.find('.v-combobox').exists()).toBe(true);

      // not the first option - that would write a value nobody chose
      const vm = wrapper.vm as ModuleConfigFormData;
      expect(vm.formValues.stationConfig.workflow).toBe('');
      expect(vm.formValues.stationConfig.board).toBe('');
    });

    test('choosing a preset writes all its sibling values', () => {
      wrapper = createPresetWrapper();

      const vm = wrapper.vm as any;
      vm.applyPreset(
        'stationConfig',
        'workflow',
        vm.configSchemas.stationConfig.workflow,
        'arduino-avr'
      );

      expect(vm.formValues.stationConfig.board).toBe('arduino:avr:uno');
      expect(vm.formValues.stationConfig.port).toBe('/dev/ttyACM0');
      expect(vm.formValues.stationConfig.baud).toBe(9600);
      expect(vm.formValues.stationConfig.script).toBe(
        'arduino-cli compile -b $BOARD $SKETCH'
      );
    });

    test('last action wins: a preset overwrites hand-edited fields', () => {
      wrapper = createPresetWrapper();

      const vm = wrapper.vm as any;
      const schema = vm.configSchemas.stationConfig.workflow;

      vm.applyPreset('stationConfig', 'workflow', schema, 'arduino-avr');
      vm.formValues.stationConfig.port = '/dev/ttyUSB9';
      vm.formValues.stationConfig.script = 'my own script';

      vm.applyPreset('stationConfig', 'workflow', schema, 'micropython');

      expect(vm.formValues.stationConfig.port).toBe('auto');
      expect(vm.formValues.stationConfig.baud).toBe(115200);
      expect(vm.formValues.stationConfig.script).toBe(
        'mpremote connect $PORT fs cp $FILE :$FILE'
      );
    });

    test('a preset cannot write fields the schema does not declare', () => {
      wrapper = createPresetWrapper();

      const vm = wrapper.vm as any;
      vm.applyPreset('stationConfig', 'workflow', {
        presets: { x: { undeclared: 'nope', port: '/dev/ttyACM1' } },
      }, 'x');

      expect(vm.formValues.stationConfig.undeclared).toBeUndefined();
      expect(vm.formValues.stationConfig.port).toBe('/dev/ttyACM1');
    });

    test('an option without a preset leaves the other fields alone', () => {
      wrapper = createPresetWrapper(
        JSON.stringify({ workflow: 'arduino-avr', port: '/dev/ttyACM0' })
      );

      const vm = wrapper.vm as any;
      vm.applyPreset(
        'stationConfig',
        'workflow',
        vm.configSchemas.stationConfig.workflow,
        'unknown-workflow'
      );

      expect(vm.formValues.stationConfig.port).toBe('/dev/ttyACM0');
    });

    test('a preset narrows the board suggestions to its own list', () => {
      wrapper = createPresetWrapper();

      const vm = wrapper.vm as any;
      const schema = vm.configSchemas.stationConfig;

      // before any workflow is chosen, the schema's full list is offered
      expect(vm.fieldOptions('stationConfig', 'board', schema.board)).toEqual([
        'arduino:avr:uno',
        'esp32:esp32:esp32',
        'avr128db48',
      ]);

      vm.applyPreset('stationConfig', 'workflow', schema.workflow, 'arduino-avr');

      expect(vm.fieldOptions('stationConfig', 'board', schema.board)).toEqual([
        'arduino:avr:uno',
        'arduino:avr:mega',
      ]);
      expect(vm.formValues.stationConfig.board).toBe('arduino:avr:uno');
    });

    test('switching workflow replaces the previous scoped list', () => {
      wrapper = createPresetWrapper();

      const vm = wrapper.vm as any;
      const schema = vm.configSchemas.stationConfig;

      vm.applyPreset('stationConfig', 'workflow', schema.workflow, 'arduino-avr');
      vm.applyPreset('stationConfig', 'workflow', schema.workflow, 'micropython');

      // micropython has no board concept - empty list, empty value
      expect(vm.fieldOptions('stationConfig', 'board', schema.board)).toEqual([]);
      expect(vm.formValues.stationConfig.board).toBe('');
    });

    test('scoped options are a UI affordance and never get saved', () => {
      wrapper = createPresetWrapper();

      const vm = wrapper.vm as any;
      vm.applyPreset(
        'stationConfig',
        'workflow',
        vm.configSchemas.stationConfig.workflow,
        'arduino-avr'
      );

      const saved = vm.collectConfig();
      // the value is stored, the option list is not
      expect(saved.stationConfig.board).toBe('arduino:avr:uno');
      expect(JSON.stringify(saved)).not.toContain('arduino:avr:mega');
    });

    test('a saved workflow keeps its narrowed board list on reopen', () => {
      // freshly mounted, no click - i.e. reopening the dialog
      wrapper = createPresetWrapper(
        JSON.stringify({ workflow: 'arduino-avr', board: 'arduino:avr:mega' })
      );

      const vm = wrapper.vm as any;

      expect(
        vm.fieldOptions('stationConfig', 'board', vm.configSchemas.stationConfig.board)
      ).toEqual(['arduino:avr:uno', 'arduino:avr:mega']);
      // restoring suggestions must not overwrite the saved value
      expect(vm.formValues.stationConfig.board).toBe('arduino:avr:mega');
      expect(vm.hasChanges).toBe(false);
    });

    test('a saved config with no workflow keeps the full list', () => {
      wrapper = createPresetWrapper(JSON.stringify({ board: 'something:custom' }));

      const vm = wrapper.vm as any;

      expect(
        vm.fieldOptions('stationConfig', 'board', vm.configSchemas.stationConfig.board)
      ).toEqual(['arduino:avr:uno', 'esp32:esp32:esp32', 'avr128db48']);
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