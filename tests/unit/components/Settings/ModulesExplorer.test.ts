import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import ModulesExplorer from '../../../../src/components/Settings/ModulesExplorer.vue';
import { i18n } from '../../../setup';

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
  'v-spacer': {
    template: '<div class="v-spacer"></div>',
  },
  'v-btn': {
    template: '<button class="v-btn" @click="$attrs.onClick"><slot /></button>',
  },
  'v-icon': {
    template: '<i class="v-icon">{{ $attrs.icon }}</i>',
  },
  'v-card-text': {
    template: '<div class="v-card-text"><slot /></div>',
  },
  'v-list': {
    template: '<div class="v-list"><slot /></div>',
  },
  'v-list-item': {
    template: '<div class="v-list-item"><slot /></div>',
  },
  'v-list-item-title': {
    template: '<div class="v-list-item-title"><slot /></div>',
  },
  'v-list-item-subtitle': {
    template: '<div class="v-list-item-subtitle"><slot /></div>',
  },
  'v-tooltip': {
    template: '<div><slot name="activator" :props="{}"/></div>',
  },
  'v-progress-circular': {
    template: '<div class="v-progress-circular"></div>',
  },
};

describe('ModulesExplorer Component', () => {
  let wrapper: any;
  let mockFetch: any;

  const mockModules = {
    items: [
      {
        id: '1',
        name: 'test-module-1',
        description: 'Test module 1 description',
        html_url: 'https://github.com/edrys-labs/test-module-1',
      },
      {
        id: '2',
        name: 'test-module-2',
        description: 'Test module 2 description',
        html_url: 'https://github.com/edrys-labs/test-module-2',
      },
    ],
  };

  beforeEach(() => {
    // Mock fetch API
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    
    // Mock window.open
    vi.stubGlobal('open', vi.fn());
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.restoreAllMocks();
  });

  const createWrapper = () => {
    return mount(ModulesExplorer, {
      global: {
        stubs,
      },
    });
  };

  test('renders loading state initially', () => {
    // Mock fetch to never resolve so component stays in loading state
    mockFetch.mockReturnValue(new Promise(() => {}));
    wrapper = createWrapper();
    
    expect(wrapper.find('.v-progress-circular').exists()).toBe(true);
    expect(wrapper.find('.v-list').exists()).toBe(false);
  });

  test('fetches and displays modules correctly', async () => {
    // Mock successful API response
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve(mockModules),
    });
    
    wrapper = createWrapper();
    
    // Wait for async operations to complete
    await flushPromises();
    
    // Should show the list
    expect(wrapper.find('.v-list').exists()).toBe(true);
    expect(wrapper.find('.v-progress-circular').exists()).toBe(false);
    
    // Should have the correct number of modules
    const moduleItems = wrapper.findAll('.v-list-item');
    expect(moduleItems.length).toBe(2);
    
    // Should show module names
    expect(wrapper.text()).toContain('test-module-1');
    expect(wrapper.text()).toContain('test-module-2');
    
    // Should show module descriptions
    expect(wrapper.text()).toContain('Test module 1 description');
    expect(wrapper.text()).toContain('Test module 2 description');
  });

  test('shows error state when API request fails', async () => {
    // Mock failed API response
    mockFetch.mockRejectedValue(new Error('Network error'));
    
    wrapper = createWrapper();
    
    // Wait for async operations to complete
    await flushPromises();
    
    // Should show error message
    expect(wrapper.find('.text-error').exists()).toBe(true);
    expect(wrapper.find('.v-list').exists()).toBe(false);
    expect(wrapper.find('.v-progress-circular').exists()).toBe(false);
  });

  test('emits close event when close button is clicked', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve(mockModules),
    });
    
    wrapper = createWrapper();
    
    // Click the close button
    await wrapper.find('.v-toolbar .v-btn').trigger('click');
    
    // Should emit close event
    expect(wrapper.emitted('close')).toBeTruthy();
    expect(wrapper.emitted('close').length).toBe(1);
  });

  test('adds module when add button is clicked', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve(mockModules),
    });
    
    wrapper = createWrapper();
    await flushPromises();
    
    // Find all buttons and click the first add button (first module, first button)
    const buttons = wrapper.findAll('.v-btn');
    await buttons[1].trigger('click');
    
    // Should emit add-module event with correct URL
    expect(wrapper.emitted('add-module')).toBeTruthy();
    expect(wrapper.emitted('add-module')[0][0]).toBe(
      'https://edrys-labs.github.io/test-module-1/index.html'
    );
  });

  test('opens module info in new tab when info button is clicked', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve(mockModules),
    });
    
    wrapper = createWrapper();
    await flushPromises();
    
    // Find all buttons and click the second button (info) of the first module
    const buttons = wrapper.findAll('.v-btn');
    await buttons[2].trigger('click');
    
    // Should open module URL in new tab
    expect(window.open).toHaveBeenCalledWith(
      'https://github.com/edrys-labs/test-module-1',
      '_blank'
    );
  });

  describe('translations', () => {
    test.each(['en', 'de', 'uk', 'ar', 'es'])('displays with %s locale', async (locale) => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve(mockModules),
      });
      
      i18n.global.locale.value = locale as 'en' | 'de' | 'uk' | 'ar' | 'es';
      wrapper = createWrapper();
      
      await flushPromises();
      
      expect(wrapper.find('.v-toolbar-title').exists()).toBe(true);
      expect(wrapper.find('.v-card-text').exists()).toBe(true);
    });
  });

  test('calls fetchModules on mount', async () => {
    const fetchModulesSpy = vi.spyOn(ModulesExplorer.methods!, 'fetchModules');
    
    wrapper = createWrapper();
    
    expect(fetchModulesSpy).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/search/repositories?q=topic:edrys-module+fork:true+owner:edrys-labs'
    );
  });
});