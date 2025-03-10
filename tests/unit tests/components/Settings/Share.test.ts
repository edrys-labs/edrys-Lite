import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Share from '../../../../src/components/Settings/Share.vue';
import { i18n, messages } from '../../../setup';

describe('Share Settings Component', () => {
  const mockConfig = {
    id: 'test-id',
    name: 'Test Class',
    members: [],
    modules: []
  };

  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;
  let originalCreateElement: typeof document.createElement;
  let originalAppendChild: typeof document.body.appendChild;
  let originalRemoveChild: typeof document.body.removeChild;

  beforeEach(() => {
    // Save original methods
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    originalCreateElement = document.createElement;
    originalAppendChild = document.body.appendChild;
    originalRemoveChild = document.body.removeChild;

    // Mock URL methods
    global.URL.createObjectURL = vi.fn().mockReturnValue('mock-url');
    global.URL.revokeObjectURL = vi.fn();

    // Mock document methods
    const mockClick = vi.fn();
    const mockAnchor = {
      click: mockClick,
      setAttribute: vi.fn(),
      style: {},
      href: '',
      download: '',
      nodeType: Node.ELEMENT_NODE,
      nodeName: 'A',
      parentNode: null,
      ownerDocument: document,
      baseURI: ''
    } as unknown as HTMLAnchorElement;

    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'a') return mockAnchor as any;
      return originalCreateElement.call(document, tag);
    });

    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      if (node === mockAnchor) return mockAnchor as any;
      return originalAppendChild.call(document.body, node);
    });

    vi.spyOn(document.body, 'removeChild').mockImplementation((node) => {
      if (node === mockAnchor) return mockAnchor as any;
      return originalRemoveChild.call(document.body, node);
    });
  });

  afterEach(() => {
    global.URL.createObjectURL = originalCreateObjectURL;
    global.URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  const createWrapper = (props = {}) => {
    return mount(Share, {
      props: {
        config: mockConfig,
        writeProtection: false,
        ...props
      },
      global: {
        stubs: {
          'v-row': {
            template: '<div class="v-row"><slot /></div>'
          },
          'v-col': {
            template: '<div class="v-col"><slot /></div>'
          },
          'v-btn': {
            template: '<button class="v-btn" @click="$emit(\'click\')"><slot /></button>'
          },
          'v-file-input': {
            template: '<input type="file" class="v-file-input" :disabled="$attrs.disabled" :label="$attrs.label" @change="$emit(\'update:modelValue\', $event.target.files[0])" />',
            inheritAttrs: false
          },
          'v-text-field': {
            template: '<input type="text" class="v-text-field" :disabled="$attrs.disabled" :label="$attrs.label" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
            props: ['modelValue'],
            inheritAttrs: false
          },
          'v-divider': true,
          'v-icon': true
        }
      }
    });
  };

  test('handles yaml file download', async () => {
    const wrapper = createWrapper();
    const downloadBtns = wrapper.findAll('.v-btn').filter(btn => btn.text() === 'Download class file (.yml)');
    
    await downloadBtns[0].trigger('click'); 
    expect(global.URL.createObjectURL).toHaveBeenCalled();
    expect(document.createElement('a').click).toHaveBeenCalled();
  });

  test('handles json file download', async () => {
    const wrapper = createWrapper();
    const downloadBtns = wrapper.findAll('.v-btn').filter(btn => btn.text() === 'Download class file (.json)');
    
    await downloadBtns[0].trigger('click'); 
    expect(global.URL.createObjectURL).toHaveBeenCalled();
    expect(document.createElement('a').click).toHaveBeenCalled();
  });

  test('handles file restore', async () => {
    const wrapper = createWrapper();
    
    // Mock FileReader
    const mockFileReader = {
      readAsText: vi.fn(function(file) {
        // Simulate async file read
        setTimeout(() => {
          this.onload?.({ target: { result: 'test: content' } });
        }, 0);
      }),
      onload: null
    };
    
    // Mock FileReader constructor
    global.FileReader = vi.fn(() => mockFileReader) as any;

    // Create a test file
    const file = new File(['test content'], 'test.yml', { type: 'application/yaml' });
    
    // Trigger the file input change by directly calling the component method
    wrapper.vm.selectedFile = file;
    wrapper.vm.restoreFile();
    
    // Wait for the FileReader mock to complete
    await new Promise(resolve => setTimeout(resolve, 0));
    
    expect(wrapper.vm.selectedFile).toBeTruthy();
    expect(mockFileReader.readAsText).toHaveBeenCalledWith(file);
  });

  test('disables inputs when write protected', () => {
    const wrapper = createWrapper({ writeProtection: true });
    const fileInput = wrapper.find('.v-file-input');
    const urlInput = wrapper.find('.v-text-field');
    
    expect((fileInput.element as HTMLInputElement).disabled).toBe(true);
    expect((urlInput.element as HTMLInputElement).disabled).toBe(true);
  });

  describe('translations', () => {
    test.each(['en', 'de', 'uk', 'ar', 'es'])('displays correct translations for %s locale', (locale) => {
      i18n.global.locale.value = locale as 'en' | 'de' | 'uk' | 'ar' | 'es';
      const wrapper = createWrapper();
      
      const buttons = wrapper.findAll('.v-btn');
      const inputs = wrapper.findAll('input');
      
      const translations = messages[locale].settings.share;

      // Check yaml button text
      const yamlButton = buttons.find(btn => btn.text() === translations.downloadYml);
      expect(yamlButton).toBeTruthy();
      
      // Check json button text
      const jsonButton = buttons.find(btn => btn.text() === translations.downloadJson);
      expect(jsonButton).toBeTruthy();
      
      // Check file input label
      const fileInput = inputs.find(input => input.attributes('label') === translations.restoreFromFile);
      expect(fileInput).toBeTruthy();
      
      // Check URL input label
      const urlInput = inputs.find(input => input.attributes('label') === translations.restoreFromUrl);
      expect(urlInput).toBeTruthy();
      
      // Check explore button text
      const exploreButton = buttons.find(btn => btn.text() === translations.explore);
      expect(exploreButton).toBeTruthy();
    });
  });
});
