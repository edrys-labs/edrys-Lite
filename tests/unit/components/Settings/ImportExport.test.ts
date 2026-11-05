import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import ImportExport from '../../../../src/components/Settings/ImportExport.vue';

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

describe('Import / Export Settings Component', () => {
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
    return mount(ImportExport, {
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
            template: '<button class="v-btn" :disabled="$attrs.disabled" :aria-label="$attrs[\'aria-label\']" @click="$emit(\'click\')"><slot /></button>',
            inheritAttrs: false
          },
          'v-file-input': {
            template: '<div><input type="file" class="v-file-input" @change="$emit(\'update:modelValue\', $event.target.files[0])" /><slot name="append-inner" /></div>',
            inheritAttrs: false
          },
          'v-text-field': {
            template: '<div><input type="text" class="v-text-field" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /><slot name="append-inner" /></div>',
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
    const downloadBtns = wrapper.findAll('.v-btn').filter(btn => btn.text() === 'YAML file (.yml)');
    
    await downloadBtns[0].trigger('click'); 
    expect(global.URL.createObjectURL).toHaveBeenCalled();
    expect(document.createElement('a').click).toHaveBeenCalled();
  });

  test('handles json file download', async () => {
    const wrapper = createWrapper();
    const downloadBtns = wrapper.findAll('.v-btn').filter(btn => btn.text() === 'JSON file (.json)');
    
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
    expect(exported).not.toHaveProperty('members');
    expect(exported.name).toBe('Test Class');
    expect(exported.modules[0].id).toBe('m1');
  });

  test('import keeps the class its own members', () => {
    const members = { teacher: ['my-teacher'], student: ['*'] };
    const config: any = { ...mockConfig, members };
    const wrapper = createWrapper({ config });

    wrapper.vm.updateConfig({ name: 'Imported', meta: {}, modules: [] });

    expect(config.members).toBe(members);
    expect(config.name).toBe('Imported');
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

  test('restore buttons stay disabled until there is a file or a link', async () => {
    const wrapper = createWrapper();
    const fileBtn = wrapper.find('[aria-label="Restore from file"]');
    const urlBtn = wrapper.find('[aria-label="Restore from link"]');
    expect(fileBtn.attributes('disabled')).toBeDefined();
    expect(urlBtn.attributes('disabled')).toBeDefined();

    await wrapper.find('.v-text-field').setValue('https://example.com/lab.yml');
    expect(urlBtn.attributes('disabled')).toBeUndefined();
  });

  test('a link that cannot be loaded shows an error, a class shows a success note', async () => {
    const config: any = { ...mockConfig, modules: [] };
    const wrapper = createWrapper({ config });
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('offline')) as any;

    wrapper.vm.selectedURL = 'https://example.com/lab.yml';
    await wrapper.vm.restoreURL();
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.restore-status.failed').text()).toBe('Could not load a class from this link.');

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => 'name: Imported\nmodules: []',
    }) as any;
    await wrapper.vm.restoreURL();
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.restore-status').classes()).not.toContain('failed');
    expect(wrapper.find('.restore-status').text()).toBe('Class loaded. Save to keep it.');
    expect(config.name).toBe('Imported');
  });
});
