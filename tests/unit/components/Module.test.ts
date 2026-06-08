import { describe, test, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Module from '../../../src/components/Module.vue';

describe('Module Component', () => {
  let wrapper: any;
  const mockPostMessage = vi.fn();
  const mockConsoleError = vi.fn();

  // Mock data
  const defaultProps = {
    role: 'student',
    username: 'test-user',
    liveClassProxy: {
      doc: { some: 'data' },
      users: {
        'test-user': { room: 'room1' }
      }
    },
    scrapedModule: {
      url: 'https://example.com/module',
      origin: 'https://example.com',
      srcdoc: null
    },
    class_id: 'class123'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock iframe contentWindow
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      value: {
        postMessage: mockPostMessage
      }
    });
    console.error = mockConsoleError;
  });

  const createWrapper = (props = {}) => {
    return mount(Module, {
      props: { ...defaultProps, ...props }
    });
  };

  test('renders iframe with correct attributes', () => {
    wrapper = createWrapper();
    const iframe = wrapper.find('iframe');
    
    expect(iframe.exists()).toBe(true);
    expect(iframe.attributes('src')).toBe('https://example.com/module');
    expect(iframe.attributes('allow')).toContain('camera');
    expect(iframe.attributes('frameborder')).toBe('0');
  });

  test('handles srcdoc and URL correctly', () => {
    const dataUrlModule = {
      ...defaultProps.scrapedModule,
      url: 'data:text/html,<html><body>Test</body></html>',
      srcdoc: '<html><body>Test</body></html>'
    };
    wrapper = createWrapper({ scrapedModule: dataUrlModule });
    
    expect(wrapper.find('iframe').attributes('src')).toBe(dataUrlModule.srcdoc);
    expect(wrapper.find('iframe').attributes('srcdoc')).toBe(dataUrlModule.url);
  });

  test('sends correct postMessage on load', async () => {
    wrapper = createWrapper();
    await wrapper.find('iframe').trigger('load');

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'update',
        role: 'student',
        username: 'test-user',
        liveClass: expect.any(Object),
        module: expect.any(Object),
        class_id: 'class123'
      }),
      'https://example.com'
    );
  });

  test('handles postMessage errors gracefully', async () => {
    mockPostMessage.mockImplementation(() => {
      throw new Error('PostMessage failed');
    });

    wrapper = createWrapper();
    await wrapper.find('iframe').trigger('load');

    expect(mockConsoleError).toHaveBeenCalledWith(
      'Module update',
      expect.any(Error)
    );
  });

  test('computes iframe origin correctly', () => {
    wrapper = createWrapper();
    expect(wrapper.vm.iframeOrigin).toBe('https://example.com');
  });

  test('sets loaded flag after initial update', async () => {
    wrapper = createWrapper();
    expect(wrapper.vm.loaded).toBe(false);
    
    await wrapper.find('iframe').trigger('load');
    expect(wrapper.vm.loaded).toBe(true);
  });

  test('reacts to room changes', async () => {
    wrapper = createWrapper();
    await wrapper.find('iframe').trigger('load');
    mockPostMessage.mockClear();

    await wrapper.setProps({
      liveClassProxy: {
        ...defaultProps.liveClassProxy,
        users: {
          'test-user': { room: 'new-room' }
        }
      }
    });

    expect(mockPostMessage).toHaveBeenCalled();
  });
});
