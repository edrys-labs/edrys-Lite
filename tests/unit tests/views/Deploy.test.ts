import { describe, test, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import Deploy from '../../../src/views/Deploy.vue';
import { copyToClipboard } from '../../../src/ts/Utils';

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
          'v-app': true,
          'v-app-bar': true,
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
            template: '<button @click="$emit(\'click\')"><slot /></button>'
          },
          'v-icon': true,
          'v-overlay': {
            template: '<div class="v-overlay" v-if="modelValue"><slot /></div>',
            props: ['modelValue']
          },
          'v-card': {
            template: '<div class="v-card"><slot /><slot name="text" /></div>'
          },
          'v-card-text': true,
          'v-divider': true,
          'v-checkbox': {
            template: '<input type="checkbox" v-model="modelValue" />',
            props: ['modelValue']
          },
          Footer: true
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
    Object.defineProperty(window, 'location', {
      value: locationMock,
      writable: true
    });

    // Test with auto-redirect enabled
    localStorage.setItem('deployed', 'true');
    const wrapper = createWrapper();
    await flushPromises();
    
    expect(locationMock.search).toContain('classroom/test-hash');
    
    // Test with auto-redirect disabled
    localStorage.setItem('deployed', 'false');
    const wrapper2 = createWrapper();
    await flushPromises();
    
    expect(wrapper2.vm.ready).toBe(true);
    expect(locationMock.search).not.toContain('classroom/test-hash');
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
});
