import { describe, test, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import Deploy from '../../../src/views/Deploy.vue';
import { copyToClipboard } from '../../../src/ts/Utils';
import { i18n, messages } from '../../setup';

// Mock fetch API
global.fetch = vi.fn();

// Mock Database
vi.mock('../../../src/ts/Database', () => ({
  Database: vi.fn().mockImplementation(() => ({
    put: vi.fn(),
  }))
}));

// Mock Utils
vi.mock('../../../src/ts/Utils', () => ({
  infoHash: vi.fn(() => 'test-hash'),
  getPeerID: vi.fn(() => 'test-user'),
  parse: vi.fn((data) => JSON.parse(data)),
  copyToClipboard: vi.fn()
}));

describe('Deploy View', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset localStorage
    localStorage.clear();
    
    // Mock successful fetch response
    (global.fetch as any).mockResolvedValue({
      text: () => Promise.resolve(JSON.stringify({
        name: 'Test Class',
        meta: { description: 'Test Description' }
      }))
    });
  });

  const createWrapper = (props = {}) => {
    return mount(Deploy, {
      props: {
        url: 'https://edrys-labs.github.io/?/classroom/yXdnrRNWoGnClIs6',
        ...props
      },
      global: {
        stubs: {
          'v-app': {
            template: '<div class="v-app"><slot /></div>'
          },
          'v-app-bar': {
            template: '<div class="v-app-bar"><slot /></div>'
          },
          'v-main': {
            template: '<div class="v-main"><slot /></div>'
          },
          'v-container': {
            template: '<div class="v-container"><slot /></div>'
          },
          'v-menu': true,
          'v-list': true,
          'v-list-item': true,
          'v-btn': {
            template: '<button class="v-btn" @click="$emit(\'click\')"><slot /></button>'
          },
          'v-icon': {
            template: '<i :class="$attrs.icon"><slot /></i>'
          },
          'v-overlay': {
            template: '<div class="v-overlay" v-if="modelValue"><slot /></div>',
            props: ['modelValue']
          },
          'v-card': {
            template: '<div class="v-card"><slot /><slot name="text" /></div>'
          },
          'v-card-text': {
            template: '<div class="v-card-text"><slot /></div>'
          },
          'v-divider': true,
          'v-checkbox': {
            template: '<label class="v-checkbox"><input type="checkbox" v-model="modelValue" />{{ $attrs.label }}</label>',
            props: ['modelValue']
          },
          Footer: true,
          UserMenu: true
        }
      }
    });
  };

  test('fetches and creates classroom on mount', async () => {
    // Create promise for fetch response
    const fetchPromise = Promise.resolve({
      text: () => Promise.resolve(JSON.stringify({
        name: 'Test Class',
        meta: { description: 'Test Description' }
      }))
    });

    // Set up fetch mock
    global.fetch = vi.fn().mockImplementation(() => fetchPromise);
    
    const wrapper = createWrapper();
    
    // Wait for all promises to resolve
    await fetchPromise;
    // Wait for fetch to reject and component to update
    await flushPromises();
    
    expect(global.fetch).toHaveBeenCalledWith('https://edrys-labs.github.io/?/classroom/yXdnrRNWoGnClIs6');
    expect(wrapper.vm.database.put).toHaveBeenCalled();
    expect(wrapper.vm.state).toContain('Data parsed successfully');
  });

  test('handles fetch errors', async () => {
    // Create rejected promise for fetch error
    const fetchError = new Error('Fetch failed');
    global.fetch = vi.fn().mockRejectedValue(fetchError);
    
    const wrapper = createWrapper();
    await flushPromises();
    
    expect(wrapper.vm.state).toContain('Error fetching data');
  });

  test('handles parse errors', async () => {
    (global.fetch as any).mockResolvedValue({
      text: () => Promise.resolve('invalid json')
    });
    
    const wrapper = createWrapper();
    await flushPromises();
    
    expect(wrapper.vm.state).toContain('Error parsing data');
  });

  test('handles auto-redirect based on localStorage', async () => {
    // Mock window.location
    const locationMock = { search: '' };
    const originalSearch = window.location.search;
    
    Object.defineProperty(window, 'location', {
      value: locationMock,
      writable: true,
      configurable: true
    });

    // Test with auto-redirect enabled
    localStorage.setItem('deployed', 'true');
    const wrapper = createWrapper();
    await flushPromises();
    
    expect(wrapper.vm.ready).toBe(false); // Should not show overlay when redirecting
    expect(locationMock.search).toBe('?/classroom/test-hash');
    
    // Reset mock
    locationMock.search = '';
    
    // Test with auto-redirect disabled
    localStorage.setItem('deployed', 'false');
    const wrapper2 = createWrapper();
    await flushPromises();
    
    expect(wrapper2.vm.ready).toBe(true); // Should show overlay
    expect(locationMock.search).toBe(''); // Should not redirect
    
    // Cleanup
    window.location.search = originalSearch;
  });

  test('copies user ID to clipboard', async () => {
    const wrapper = createWrapper();
    wrapper.vm.copyPeerID();
    
    expect(vi.mocked(copyToClipboard)).toHaveBeenCalledWith('test-user');
  });

  test('updates localStorage on checkbox change', async () => {
    const wrapper = createWrapper();
    
    await wrapper.setData({ checkboxValue: true });
    expect(localStorage.getItem('deployed')).toBe('true');
    
    await wrapper.setData({ checkboxValue: false });
    expect(localStorage.getItem('deployed')).toBe('false');
  });

  describe('translations', () => {
    test.each(['en', 'de', 'uk', 'ar'])('displays correct translations for %s locale', async (locale) => {
      i18n.global.locale.value = locale as 'en' | 'de' | 'uk' | 'ar';
      const translations = messages[locale].deploy;
      
      const wrapper = createWrapper({ url: 'https://test.com/classroom' });

      // Wait for component to mount and fetch data
      await wrapper.vm.$nextTick();
      await flushPromises();

      // Test initial state messages
      const stateMessages = wrapper.findAll('.v-container div');
      expect(stateMessages[0].text()).toContain(translations.state.waiting);
      expect(stateMessages[1].text()).toContain(translations.state.fetching);

      // Set component as ready to test overlay content
      await wrapper.setData({ ready: true });
      await wrapper.vm.$nextTick();

      // Test overlay content
      const overlayContent = wrapper.find('.v-overlay');
      expect(overlayContent.exists()).toBe(true);

      // Check card texts
      const cardTexts = wrapper.findAll('.v-card-text');
      expect(cardTexts[0].text()).toContain(translations.overlay.isReady);
      expect(cardTexts[1].text()).toContain(translations.overlay.redirect);
      expect(cardTexts[1].text()).toContain(translations.overlay.info);

      // Check checkbox label
      const checkbox = wrapper.find('.v-checkbox');
      expect(checkbox.text()).toContain(translations.overlay.checkbox);

      // Check goto button text
      const gotoButton = wrapper.find('.v-btn');
      expect(gotoButton.text()).toContain(translations.overlay.goto);
    });
  });
});
