import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Modules from '../../../src/components/Modules.vue';
import { i18n, messages } from '../../setup';

// Mock Muuri
vi.mock('muuri', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      destroy: vi.fn(),
      layout: vi.fn(),
    })),
  };
});

// Create stub components
const stubs = {
  Module: true,
  'v-card': {
    template: '<div class="v-card"><slot /></div>',
  },
  'v-card-text': {
    template: '<div class="v-card-text"><slot /></div>',
  },
};

describe('Modules Component', () => {
  let wrapper: any;
  const mockCommunication = {
    on: vi.fn(),
    broadcast: vi.fn(),
    update: vi.fn(),
    updateState: vi.fn(),
    updateAwareness: vi.fn(),
    onState: vi.fn((_cb: (data: Uint8Array, origin: any) => void) => vi.fn()),
    onAwareness: vi.fn((_cb: (data: Uint8Array, origin: any) => void) => vi.fn()),
    getWebRTCConfig: vi.fn(() => Promise.resolve({})),
  };

  const mockScrapedModules = [
    {
      name: 'Module 1',
      url: 'https://example.com/module1',
      height: 'medium',
      width: 'half',
      showInCustom: 'lobby',
    },
    {
      name: 'Module 2',
      url: 'https://example.com/module2',
      height: 'tall',
      width: 'full',
      showInCustom: 'station',
    },
    {
      name: 'Module 3',
      url: 'https://example.com/module3',
      height: 'huge',
      width: 'full',
      showInCustom: 'station',
    },
  ];

  const mockLiveClassProxy = {
    users: {
      'test-user': { room: 'lobby' },
      'test-teacher': { room: 'chat' },
    },
  };

  const createWrapper = (props = {}, options = {}) => {
    return mount(Modules, {
      ...options,
      props: {
        role: 'student',
        username_: 'test-user',
        liveClassProxy: mockLiveClassProxy,
        scrapedModules_: mockScrapedModules,
        communication: mockCommunication,
        class_id: 'test-class',
        ...props,
      },
      global: {
        stubs,
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers(); 
  });

  // Module is stubbed, so give the component a stand-in module iframe (it must
  // be in the document to get a window). Returns that module's window.
  let frames: HTMLIFrameElement[] = [];
  const mountWithModuleFrame = (props = {}) => {
    wrapper = createWrapper(props, { attachTo: document.body });
    const frame = document.createElement('iframe');
    wrapper.element.appendChild(frame);
    frames.push(frame);
    return frame.contentWindow as Window;
  };
  const postFrom = (source: Window | null, data: any, origin = 'https://example.com') =>
    window.dispatchEvent(new MessageEvent('message', { data, origin, source }));

  afterEach(() => {
    frames.forEach((f) => f.remove());
    frames = [];
    if (wrapper) wrapper.unmount();
    vi.clearAllTimers(); 
    vi.useRealTimers(); 
  });

  test('renders correct number of modules based on filter', () => {
    wrapper = createWrapper({ role: 'teacher' });
    const modules = wrapper.findAllComponents({ name: 'Module' });
    expect(modules).toHaveLength(1);
  });

  test('filters modules based on room name', async () => {
    wrapper = createWrapper({
      username_: 'test-user',
      role: 'student',
    });

    await wrapper.setProps({
      liveClassProxy: {
        users: {
          'test-user': { room: 'Station 1' },
        },
      },
    });
    
    expect(wrapper.vm.roomName).toBe('Station 1');
    const modules = wrapper.findAllComponents({ name: 'Module' });
    expect(modules).toHaveLength(2); 
  });

  test('handles teacher-only modules correctly', () => {
    const teacherOnlyModule = [...mockScrapedModules, {
      name: 'Teacher Module',
      showInCustom: 'lobby, teacher-only',
    }];
    
    // Test as student
    wrapper = createWrapper({
      role: 'student',
      scrapedModules_: teacherOnlyModule,
    });
    expect(wrapper.findAllComponents({ name: 'Module' })).toHaveLength(1);
    
    // Test as teacher
    wrapper = createWrapper({
      role: 'teacher',
      scrapedModules_: teacherOnlyModule,
    });
    expect(wrapper.findAllComponents({ name: 'Module' })).toHaveLength(2);
  });

  test('calculates correct module sizes', () => {
    wrapper = createWrapper();
    
    expect(wrapper.vm.width('full')).toBe('1030px');
    expect(wrapper.vm.width('half')).toBe('510px');
    expect(wrapper.vm.height('huge')).toBe('840px');
    expect(wrapper.vm.height('tall')).toBe('720px');
    expect(wrapper.vm.height('medium')).toBe('410px');
  });

  test('handles message broadcasting', async () => {
    wrapper = createWrapper();
    
    const message = {
      subject: 'test',
      body: 'hello',
      user: 'test-user',
      module: 'module1',
    };
    
    await wrapper.vm.sendMessage(
      message.subject,
      message.body,
      message.user,
      message.module
    );
    
    expect(mockCommunication.broadcast).toHaveBeenCalledWith(
      'lobby',
      expect.objectContaining({
        subject: 'test',
        body: 'hello',
        user: 'test-user',
      })
    );
  });

  test('acts on messages and state from its module iframes', () => {
    const moduleWindow = mountWithModuleFrame();

    postFrom(moduleWindow, { event: 'message', subject: 'test', body: 'hello' });
    expect(mockCommunication.broadcast).toHaveBeenCalled();

    const update = [1, 2, 3];
    postFrom(moduleWindow, { event: 'state', data: update });
    expect(mockCommunication.updateState).toHaveBeenCalledWith(update, moduleWindow);

    // Inlined (data:) modules post with an opaque "null" origin.
    postFrom(moduleWindow, { event: 'awareness', data: update }, 'null');
    expect(mockCommunication.updateAwareness).toHaveBeenCalledWith(update, moduleWindow);
  });

  test('ignores messages from any window that is not one of its modules', () => {
    mountWithModuleFrame();
    const outsider = document.createElement('iframe'); // e.g. another frame on the page
    document.body.appendChild(outsider);
    frames.push(outsider);

    for (const source of [null, window, outsider.contentWindow]) {
      postFrom(source, { event: 'message', subject: 'spoof', body: 'x' });
      postFrom(source, { event: 'state', data: [1] });
      postFrom(source, { event: 'awareness', data: [1] });
      postFrom(source, { event: 'reload' });
    }
    vi.advanceTimersByTime(100);

    expect(mockCommunication.broadcast).not.toHaveBeenCalled();
    expect(mockCommunication.updateState).not.toHaveBeenCalled();
    expect(mockCommunication.updateAwareness).not.toHaveBeenCalled();
    expect(mockCommunication.update).not.toHaveBeenCalled();
  });

  test('asks for a current room whenever a module (re)loads', () => {
    // A module's "reload" is posted from its unloading page, so it arrives with
    // no source and is dropped above. The new page's load must still get a doc.
    wrapper = createWrapper();

    wrapper.findComponent({ name: 'Module' }).vm.$emit('loaded');

    expect(mockCommunication.update).toHaveBeenCalledWith('room');
  });

  test('answers a WebRTC config request only from a module at its own origin', async () => {
    // Student in lobby: Module 1 at https://example.com.
    const moduleWindow = mountWithModuleFrame();
    const reply = vi.spyOn(moduleWindow, 'postMessage').mockImplementation(() => {});

    postFrom(moduleWindow, { event: 'requestWebRTCConfig' }, 'https://evil.example');
    await Promise.resolve();
    expect(mockCommunication.getWebRTCConfig).not.toHaveBeenCalled();

    postFrom(moduleWindow, { event: 'requestWebRTCConfig' }, 'https://example.com');
    await Promise.resolve();
    await Promise.resolve();
    expect(reply).toHaveBeenCalledWith({ event: 'webrtcConfig', config: {} }, 'https://example.com');
  });

  describe('forwarding live updates into module iframes', () => {
    // Module is stubbed, so stand in for its iframes (paired by index with the
    // modules shown in the lobby).
    const lobbyModules = [
      { ...mockScrapedModules[0] },
      { ...mockScrapedModules[0], name: 'Module 1b', url: 'https://other.example/module' },
    ];
    let iframes: HTMLIFrameElement[];
    let posts: ReturnType<typeof vi.spyOn>[];

    beforeEach(() => {
      iframes = [document.createElement('iframe'), document.createElement('iframe')];
      iframes.forEach((f) => document.body.appendChild(f));
      posts = iframes.map((f) =>
        vi.spyOn(f.contentWindow as Window, 'postMessage').mockImplementation(() => {})
      );
    });

    afterEach(() => iframes.forEach((f) => f.remove()));

    test('forwards doc updates to every module origin', () => {
      wrapper = createWrapper({ scrapedModules_: lobbyModules });
      const onState = mockCommunication.onState.mock.calls[0][0];
      const update = new Uint8Array([1, 2, 3]);

      onState(update, null); // a remote peer's edit
      expect(posts[0]).toHaveBeenCalledWith({ event: 'state', data: update }, 'https://example.com');
      expect(posts[1]).toHaveBeenCalledWith({ event: 'state', data: update }, 'https://other.example');
    });

    test("forwards a module's own doc update to its siblings, not back to it", () => {
      wrapper = createWrapper({ scrapedModules_: lobbyModules });
      const onState = mockCommunication.onState.mock.calls[0][0];
      const update = new Uint8Array([1, 2, 3]);

      onState(update, { transactionId: 'extern', source: iframes[0].contentWindow });
      expect(posts[0]).not.toHaveBeenCalled();
      expect(posts[1]).toHaveBeenCalledWith({ event: 'state', data: update }, 'https://other.example');
    });

    test("forwards a module's own awareness update to its siblings, not back to it", () => {
      wrapper = createWrapper({ scrapedModules_: lobbyModules });
      const onAwareness = mockCommunication.onAwareness.mock.calls[0][0];
      const update = new Uint8Array([4, 5]);

      onAwareness(update, { transactionId: 'extern', source: iframes[1].contentWindow });
      expect(posts[0]).toHaveBeenCalledWith({ event: 'awareness', data: update }, 'https://example.com');
      expect(posts[1]).not.toHaveBeenCalled();

      onAwareness(update, null); // a remote peer's cursor
      expect(posts[1]).toHaveBeenCalledWith({ event: 'awareness', data: update }, 'https://other.example');
    });
  });

  test('empty state tells teachers and stations to add modules, and students to wait', async () => {
    i18n.global.locale.value = 'en';
    const noModules = messages.en.modules.noModules;
    wrapper = createWrapper({ scrapedModules_: [], role: 'teacher' });
    expect(wrapper.find('.v-card-text').text()).toContain(noModules['1']);
    expect(wrapper.find('.v-card-text').text()).toContain(noModules['2']);

    await wrapper.setProps({ role: 'station' });
    expect(wrapper.find('.v-card-text').text()).toContain(noModules['1']);

    await wrapper.setProps({ role: 'student' });
    expect(wrapper.find('.v-card-text').text()).toContain(noModules['3']);
    expect(wrapper.find('.v-card-text').text()).not.toContain(noModules['1']);
  });

  test('updates grid on room change', async () => {
    wrapper = createWrapper();
    const gridUpdateSpy = vi.spyOn(wrapper.vm, 'gridUpdate');
    
    await wrapper.setProps({
      liveClassProxy: {
        users: {
          'test-user': { room: 'Station 2' },
        },
      },
    });
    
    vi.advanceTimersByTime(1100);
    await wrapper.vm.$nextTick();
    
    expect(gridUpdateSpy).toHaveBeenCalled();
  });

  test('cleans up resources on destroy', () => {
    wrapper = createWrapper();
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    
    wrapper.unmount();
    
    expect(removeEventListenerSpy).toHaveBeenCalledWith('message', expect.any(Function));
    expect(mockCommunication.on).toHaveBeenCalledWith('message', undefined);
  });

  describe('scrapedModulesFilter', () => {
    test('handles translated room names correctly', async () => {
      const modulesWithTranslatedRooms = [
        {
          name: 'Module 1',
          showInCustom: 'Вестибюль', 
        },
        {
          name: 'Module 2',
          showInCustom: 'Кімната 1', 
        },
        {
          name: 'Module 3',
          showInCustom: 'Станція 1', 
        }
      ];

      i18n.global.locale.value = 'uk';
      
      wrapper = createWrapper({
        scrapedModules_: modulesWithTranslatedRooms,
        liveClassProxy: {
          users: {
            'test-user': { room: 'Room 1' }
          }
        }
      });

      // Should show Module 2 since user is in Room 1
      expect(wrapper.findAllComponents({ name: 'Module' })).toHaveLength(1);

      // Update room to Lobby
      await wrapper.setProps({
        liveClassProxy: {
          users: {
            'test-user': { room: 'Lobby' }
          }
        }
      });
      
      // Should show Module 1 since user is in Lobby
      expect(wrapper.findAllComponents({ name: 'Module' })).toHaveLength(1);
    });

    test('handles role-specific modules with translations', async () => {
      const modulesWithRoles = [
        {
          name: 'Teacher Module',
          showInCustom: `${i18n.global.t('settings.modules.module.showIn.teacherOnly')}, Lobby`
        },
        {
          name: 'Station Module',
          showInCustom: `${i18n.global.t('settings.modules.module.showIn.stationOnly')}, station`
        }
      ];

      // Test as teacher
      wrapper = createWrapper({
        role: 'teacher',
        scrapedModules_: modulesWithRoles,
        liveClassProxy: {
          users: {
            'test-user': { room: 'Lobby' }
          }
        }
      });
      expect(wrapper.findAllComponents({ name: 'Module' })).toHaveLength(1);

      // Test as station
      wrapper = createWrapper({
        role: 'station',
        scrapedModules_: modulesWithRoles,
        liveClassProxy: {
          users: {
            'test-user': { room: 'station' }
          }
        }
      });
      expect(wrapper.findAllComponents({ name: 'Module' })).toHaveLength(1);

      // Test as student (should see neither)
      wrapper = createWrapper({
        role: 'student',
        scrapedModules_: modulesWithRoles
      });
      expect(wrapper.findAllComponents({ name: 'Module' })).toHaveLength(0);
    });

    test('handles wildcard (*) in module visibility', () => {
      const modulesWithWildcard = [{
        name: 'Everywhere Module',
        showInCustom: '*'
      }];

      wrapper = createWrapper({
        scrapedModules_: modulesWithWildcard,
      });

      expect(wrapper.findAllComponents({ name: 'Module' })).toHaveLength(1);
    });
  });
});
