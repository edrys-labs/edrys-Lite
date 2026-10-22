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

  test('loads an inlined module as src, never as srcdoc', () => {
    // srcdoc would give the module this page's origin
    const dataUrlModule = {
      ...defaultProps.scrapedModule,
      url: 'data:text/html,<html><body>Test</body></html>',
      srcdoc: 'data:text/html,%3Chtml%3E%3Cbody%3ETest%3C/body%3E%3C/html%3E'
    };
    wrapper = createWrapper({ scrapedModule: dataUrlModule });

    expect(wrapper.find('iframe').attributes('src')).toBe(dataUrlModule.srcdoc);
    expect(wrapper.find('iframe').attributes('srcdoc')).toBeUndefined();
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

  test('emits loaded on every iframe load, not only the first', async () => {
    // A module page that reloads itself gets a new window; it needs a current
    // doc, which the parent asks for on "loaded".
    wrapper = createWrapper();
    await wrapper.find('iframe').trigger('load');
    await wrapper.find('iframe').trigger('load');

    expect(wrapper.emitted('loaded')).toHaveLength(2);
  });

  test('hands its frame and origin to the parent on load, after the first update', async () => {
    wrapper = createWrapper();
    await wrapper.find('iframe').trigger('load');

    const [frame, origin] = wrapper.emitted('loaded')[0];
    expect(frame.postMessage).toBe(mockPostMessage);
    expect(origin).toBe('https://example.com');
    // the frame got its update (which creates its awareness) before the parent may seed it
    expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({ event: 'update' }), 'https://example.com');
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
