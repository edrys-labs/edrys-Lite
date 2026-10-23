import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Share from '../../../../src/components/Settings/Share.vue';

vi.mock('../../../../src/ts/Utils', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getPeerID: () => 'importer-key',
}));

// jsdom's Blob has no text()
const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob);
  });

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

  test('export omits createdBy and setup signature fields', async () => {
    const wrapper = createWrapper({
      config: {
        ...mockConfig,
        createdBy: 'owner-key',
        setupSigner: 'owner-key',
        setupSignature: 'sig',
        modules: [{ id: 'm1', url: 'http://example.com' }]
      }
    });

    wrapper.vm.downloadClass('json');
    const blob = (global.URL.createObjectURL as any).mock.calls[0][0] as Blob;
    const exported = JSON.parse(await readBlob(blob));

    expect(exported).not.toHaveProperty('createdBy');
    expect(exported).not.toHaveProperty('setupSigner');
    expect(exported).not.toHaveProperty('setupSignature');
    expect(exported.name).toBe('Test Class');
    expect(exported.modules[0].id).toBe('m1');
  });

  test('import backfills missing module ids and keeps existing ones', () => {
    const config: any = { ...mockConfig, modules: [] };
    const wrapper = createWrapper({ config });

    wrapper.vm.updateConfig({
      name: 'Imported',
      meta: {},
      members: { teacher: [], student: [] },
      modules: [{ url: 'http://a.com' }, { id: 'keep', url: 'http://b.com' }]
    });

    expect(typeof config.modules[0].id).toBe('string');
    expect(config.modules[0].id.length).toBeGreaterThan(0);
    expect(config.modules[1].id).toBe('keep');
    expect(config.createdBy).toBe('importer-key');
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

});
