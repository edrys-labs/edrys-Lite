import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Modules from '../../../src/components/Modules.vue';
import Module from '../../../src/components/Module.vue';

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

  const createWrapper = (props = {}) => {
    return mount(Modules, {
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

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.clearAllTimers(); 
    vi.useRealTimers(); 
  });

  test('renders correct number of modules based on filter', () => {
    wrapper = createWrapper({ role: 'teacher' });
    const modules = wrapper.findAllComponents(Module);
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
    const modules = wrapper.findAllComponents(Module);
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
    expect(wrapper.findAllComponents(Module)).toHaveLength(1);
    
    // Test as teacher
    wrapper = createWrapper({
      role: 'teacher',
      scrapedModules_: teacherOnlyModule,
    });
    expect(wrapper.findAllComponents(Module)).toHaveLength(2);
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

  test('handles window messages correctly', async () => {
    wrapper = createWrapper();
    
    const messageEvent = new MessageEvent('message', {
      data: {
        event: 'message',
        subject: 'test',
        body: 'hello',
      },
    });
    
    window.dispatchEvent(messageEvent);
    await wrapper.vm.$nextTick();
    vi.advanceTimersByTime(100); 
    
    expect(mockCommunication.broadcast).toHaveBeenCalled();
    
    const stateEvent = new MessageEvent('message', {
      data: {
        event: 'state',
        data: { test: true },
      },
    });
    
    window.dispatchEvent(stateEvent);
    await wrapper.vm.$nextTick();
    
    expect(mockCommunication.updateState).toHaveBeenCalled();
  });

  test('shows empty state message when no modules', () => {
    wrapper = createWrapper({ scrapedModules_: [] });
    console.log(wrapper.html());

    expect(wrapper.find('.v-card-text').exists()).toBe(true);
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
});
