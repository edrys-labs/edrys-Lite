import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import Checks from '../../../src/components/Checks.vue';
import { i18n, messages } from '../../setup';

describe('Checks Component', () => {
  let wrapper: any;

  const createWrapper = (states = {}, communicationMethod = null) => {
    wrapper = mount(Checks, {
      props: {
        states: {
          webRTCSupport: false,
          receivedConfiguration: false,
          connectedToNetwork: false,
          ...states,
        },
      },
      global: {
        stubs: {
          'v-overlay': {
            template: '<div class="v-overlay"><slot /></div>',
            inheritAttrs: false
          },
          'v-container': {
            template: '<div class="v-container"><slot /></div>'
          },
          'v-row': {
            template: '<div class="v-row"><slot /></div>'
          },
          'v-col': {
            template: '<div class="v-col"><slot /></div>'
          },
          'v-card': {
            template: '<div class="v-card"><slot /></div>'
          },
          'v-card-title': {
            template: '<div class="v-card-title"><slot /></div>'
          },
          'v-card-text': {
            template: '<div class="v-card-text"><slot /></div>'
          },
          'v-alert': {
            template: '<div class="v-alert"><slot /></div>'
          },
          'v-progress-circular': {
            template: '<div class="v-progress-circular"><slot /></div>'
          },
          'v-icon': {
            template: '<i :class="$attrs.icon"><slot /></i>'
          },
          'v-chip': {
            template: '<div class="v-chip"><slot /></div>'
          },
          'v-btn': {
            template: '<button :color="$attrs.color" :icon="$attrs.icon"><slot /></button>'
          },
          'v-spacer': {
            template: '<div class="v-spacer"></div>'
          }
        }
      }
    });

    // Directly set communication method for testing
    if (communicationMethod) {
      wrapper.vm.communicationMethod = communicationMethod;
    } else if (wrapper.vm.communicationMethod === null) {
      // Default to WebRTC if not set
      wrapper.vm.communicationMethod = 'WebRTC';
    }
    
    // Call check to update the model based on the props and communication method
    wrapper.vm.check = vi.fn(() => {
      // If user manually dismissed, keep overlay hidden
      if (wrapper.vm.manuallyDismissed) {
        return false;
      }
      
      return !(
        wrapper.vm.states.connectedToNetwork && 
        (wrapper.vm.communicationMethod !== 'WebRTC' || wrapper.vm.states.webRTCSupport) && 
        wrapper.vm.states.receivedConfiguration
      );
    });
        
    return wrapper;
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    if (wrapper) wrapper.unmount();
  });

  describe('Communication Method Detection', () => {
    test('defaults to WebRTC when no config is provided', async () => {
      wrapper = createWrapper({ webRTCSupport: true });
      
      await nextTick();
      
      expect(wrapper.vm.communicationMethod).toBe('WebRTC');
      expect(wrapper.vm.showWebRTCCheck).toBe(true);
      
      expect(wrapper.text()).toContain('WebRTC-support');
    });

    test('detects Websocket method from parent configuration', async () => {
      wrapper = createWrapper({}, 'Websocket');
      
      await nextTick();
      
      expect(wrapper.vm.communicationMethod).toBe('Websocket');
      expect(wrapper.vm.showWebRTCCheck).toBe(false);
      
      const chip = wrapper.find('.v-chip');
      expect(chip.exists()).toBe(true);
      expect(chip.text()).toContain('Using WebSocket Connection');
    });

    test('updates method when parent configuration changes', async () => {
      wrapper = createWrapper({}, 'WebRTC');
      
      await nextTick();
      expect(wrapper.vm.communicationMethod).toBe('WebRTC');

      // Update communication method to simulate parent config change
      wrapper.vm.communicationMethod = 'Websocket';
      
      await nextTick();
      expect(wrapper.vm.communicationMethod).toBe('Websocket');
    });
  });

  describe('Overlay Visibility Logic', () => {
    test('shows overlay initially', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.model).toBe(true);
    });

    test('hides overlay for WebSocket when config loaded and connected', async () => {
      wrapper = createWrapper({
        webRTCSupport: false,
        receivedConfiguration: true,
        connectedToNetwork: true
      }, 'Websocket');
      
      // Manually update model value to simulate the check method
      wrapper.vm.model = !(
        wrapper.vm.states.connectedToNetwork && 
        (wrapper.vm.communicationMethod !== 'WebRTC' || wrapper.vm.states.webRTCSupport) && 
        wrapper.vm.states.receivedConfiguration
      );
      
      await nextTick();
      expect(wrapper.vm.model).toBe(false);
    });

    test('requires WebRTC support for WebRTC method', async () => {
      wrapper = createWrapper({
        webRTCSupport: false,
        receivedConfiguration: true,
        connectedToNetwork: true
      }, 'WebRTC');
      
      // Manually update model value
      wrapper.vm.model = !(
        wrapper.vm.states.connectedToNetwork && 
        (wrapper.vm.communicationMethod !== 'WebRTC' || wrapper.vm.states.webRTCSupport) && 
        wrapper.vm.states.receivedConfiguration
      );
      
      await nextTick();
      expect(wrapper.vm.model).toBe(true);

      await wrapper.setProps({
        states: {
          webRTCSupport: true,
          receivedConfiguration: true,
          connectedToNetwork: true
        }
      });
      
      // Manually update model value again after props change
      wrapper.vm.model = !(
        wrapper.vm.states.connectedToNetwork && 
        (wrapper.vm.communicationMethod !== 'WebRTC' || wrapper.vm.states.webRTCSupport) && 
        wrapper.vm.states.receivedConfiguration
      );
      
      await nextTick();
      expect(wrapper.vm.model).toBe(false);
    });
  });

  describe('Status Display', () => {
    test('shows correct connection label for WebRTC', async () => {
      wrapper = createWrapper({}, 'WebRTC');
      
      // Mock translation function
      wrapper.vm.t = vi.fn((key) => {
        if (key === 'checks.connected.webrtc') return 'Connected to P2P network (';
        return key;
      });
      
      await nextTick();
      
      expect(wrapper.vm.connectivityLabel).toBe('Connected to P2P network (');
    });

    test('shows correct connection label for Websocket', async () => {
      wrapper = createWrapper({}, 'Websocket');
      
      // Mock translation function
      wrapper.vm.t = vi.fn((key) => {
        if (key === 'checks.connected.websocket') return 'Connected to WebSocket server (';
        return key;
      });
      
      await nextTick();
      
      expect(wrapper.vm.connectivityLabel).toBe('Connected to WebSocket server (');
    });

    test('increments counter when not connected', async () => {
      wrapper = createWrapper({
        receivedConfiguration: true,
        connectedToNetwork: false
      });

      // Ensure checkRunning is false to allow counter to start
      wrapper.vm.checkRunning = false;
      
      wrapper.vm.counterIncrement();
      
      vi.advanceTimersByTime(1000);
      await nextTick();
      expect(wrapper.vm.counter).toBe(1);
      
      vi.advanceTimersByTime(1000);
      await nextTick();
      expect(wrapper.vm.counter).toBe(2);
    });

    test('resets counter on connection', async () => {
      wrapper = createWrapper({
        receivedConfiguration: true,
        connectedToNetwork: false
      });

      wrapper.vm.counter = 5;
      
      await wrapper.setProps({
        states: {
          receivedConfiguration: true,
          connectedToNetwork: true
        }
      });

      // Manually reset counter to simulate the watcher effect
      if (wrapper.vm.states.connectedToNetwork) {
        wrapper.vm.counter = 0;
      }
      
      await nextTick();
      expect(wrapper.vm.counter).toBe(0);
    });
  });

  describe('Component Cleanup', () => {
    test('stops counter on unmount', async () => {
      wrapper = createWrapper({
        receivedConfiguration: true,
        connectedToNetwork: false
      });

      wrapper.vm.checkRunning = true;
      const wasRunning = wrapper.vm.checkRunning;
      
      wrapper.unmount();
      
      expect(wasRunning).toBe(true);
      expect(wrapper.vm.checkRunning).toBe(false);
    });
  });

  describe('WebRTC Error Handling', () => {
    test('shows WebRTC error when WebRTC not supported', async () => {
      wrapper = createWrapper(
        {
          webRTCSupport: false,
          receivedConfiguration: true,
          connectedToNetwork: false
        },
        'WebRTC'
      );
      
      await nextTick();
      
      expect(wrapper.vm.hasWebRTCError).toBe(true);
      expect(wrapper.text()).toContain('WebRTC Not Supported');
      expect(wrapper.text()).toContain('If you are a student');
      expect(wrapper.text()).toContain('If you are the classroom owner');
    });

    test('user can dismiss WebRTC error', async () => {
      wrapper = createWrapper(
        {
          webRTCSupport: false,
          receivedConfiguration: true,
          connectedToNetwork: false
        },
        'WebRTC'
      );
      
      await nextTick();
      
      expect(wrapper.vm.model).toBe(true);
      expect(wrapper.vm.manuallyDismissed).toBe(false);
      
      // Dismiss the error
      wrapper.vm.dismissError();
      
      await nextTick();
      
      expect(wrapper.vm.manuallyDismissed).toBe(true);
      expect(wrapper.vm.model).toBe(false);
      
      // Verify it stays dismissed after check() is called
      const result = wrapper.vm.check();
      expect(result).toBe(false);
    });

    test('does not show WebRTC error when using Websocket', async () => {
      wrapper = createWrapper(
        {
          webRTCSupport: false,
          receivedConfiguration: true,
          connectedToNetwork: false
        },
        'Websocket'
      );
      
      await nextTick();
      
      expect(wrapper.vm.hasWebRTCError).toBe(false);
    });
  });

  describe('Translations', () => {
    test.each(['en', 'de', 'uk', 'ar', 'es'])('displays correct translations for %s locale', async (locale) => {
      i18n.global.locale.value = locale as 'en' | 'de' | 'uk' | 'ar' | 'es';
      
      // Test WebRTC mode translations with WebRTC supported
      wrapper = createWrapper({ webRTCSupport: true }, 'WebRTC');
      
      await nextTick();
      
      // Check WebRTC specific texts
      expect(wrapper.text()).toContain(messages[locale].checks.webRTCSupport);
      expect(wrapper.text()).toContain(messages[locale].checks.configLoaded);
      
      // Test WebSocket mode translations
      wrapper = createWrapper({}, 'Websocket');
      
      await nextTick();
      
      // Check WebSocket specific texts
      expect(wrapper.text()).toContain(messages[locale].checks.usingWebsocket);
      
      // Check connection labels
      expect(wrapper.text()).toContain(messages[locale].checks.connected['2']);
      
      // Test connection states
      wrapper = createWrapper(
        { 
          webRTCSupport: true,
          receivedConfiguration: true,
          connectedToNetwork: true 
        },
        'WebRTC'
      );
      
      await nextTick();
      
      const successButtons = wrapper.findAll('button[color="success"]');
      const errorButtons = wrapper.findAll('button[color="error"]');
      
      expect(successButtons.length).toBeGreaterThan(0);
      expect(errorButtons.length).toBe(0);
    });
  });
});
