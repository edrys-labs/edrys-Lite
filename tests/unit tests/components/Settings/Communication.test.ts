import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import Communication from '../../../../src/components/Settings/Communication.vue';
import { i18n, messages } from '../../../setup';

// Mock the Utils functions
vi.mock('../../../../src/ts/Utils', () => ({
  encodeCommConfig: vi.fn((config) => {
    if (config.communicationMethod === 'WebRTC') {
      return 'encodedWebRTC';
    } else if (config.communicationMethod === 'Websocket') {
      return 'encodedWebsocket';
    }
    return 'encodedConfig';
  }),
  
  decodeCommConfig: vi.fn((encodedConfig) => {
    if (encodedConfig === 'encodedWebRTC') {
      return {
        communicationMethod: 'WebRTC',
        webrtcConfig: { iceServers: [{ urls: 'stun:custom.stun' }] },
        signalingServer: ['wss://custom.server']
      };
    } else if (encodedConfig === 'encodedWebsocket') {
      return {
        communicationMethod: 'Websocket',
        websocketUrl: 'wss://test.com'
      };
    }
    return null;
  })
}));

describe('Communication Component', () => {
  let wrapper: any;
  
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    if (wrapper) wrapper.unmount();
  });
  
  const createWrapper = (config = '', writeProtection = false, locale = 'en') => {
    i18n.global.locale.value = locale as 'en' | 'de' | 'uk' | 'ar' | 'es';
    
    return mount(Communication, {
      props: {
        config,
        writeProtection,
        classId: 'test-class'
      },
      global: {
        stubs: {
          'v-container': {
            template: '<div class="v-container"><slot /></div>'
          },
          'v-select': {
            template: '<div class="v-select"><label>{{ $attrs.label }}</label><select v-model="modelValue" :disabled="$attrs.disabled" @change="$emit(\'update:modelValue\', $event.target.value)"><option value="WebRTC">WebRTC</option><option value="Websocket">Websocket</option></select></div>',
            props: ['modelValue'],
            emits: ['update:modelValue']
          },
          'v-text-field': {
            template: '<div class="v-text-field"><label>{{ $attrs.label }}</label><input v-model="modelValue" :disabled="$attrs.disabled" @input="$emit(\'update:modelValue\', $event.target.value)" /></div>',
            props: ['modelValue'],
            emits: ['update:modelValue']
          },
          'v-textarea': {
            template: '<div class="v-textarea"><label>{{ $attrs.label }}</label><textarea v-model="modelValue" :disabled="$attrs.disabled" @input="$emit(\'update:modelValue\', $event.target.value)"></textarea></div>',
            props: ['modelValue'],
            emits: ['update:modelValue']
          },
          'v-alert': {
            template: '<div class="v-alert"><slot /></div>'
          },
          'v-divider': {
            template: '<hr class="v-divider" />'
          },
          'v-btn': {
            template: '<button class="v-btn" @click="$emit(\'click\')"><slot /></button>',
            emits: ['click']
          }
        }
      }
    });
  };

  describe('Initialization', () => {
    test('initializes with empty WebRTC config when no config is provided', () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.communicationMethod).toBe('WebRTC');
      expect(wrapper.vm.signalingServer).toBe('');
      expect(wrapper.vm.webrtcConfig).toBe('');
    });

    test('initializes with WebRTC config from encoded string', () => {
      wrapper = createWrapper('encodedWebRTC');
      
      expect(wrapper.vm.communicationMethod).toBe('WebRTC');
      expect(wrapper.vm.signalingServer).toBe('wss://custom.server');
      expect(wrapper.vm.webrtcConfig).toContain('custom.stun');
    });
    
    test('initializes with Websocket config from encoded string', () => {
      wrapper = createWrapper('encodedWebsocket');
      
      expect(wrapper.vm.communicationMethod).toBe('Websocket');
      expect(wrapper.vm.websocketUrl).toBe('wss://test.com');
    });
  });

  describe('Method Switching', () => {
    test('shows/hides appropriate fields based on communication method', async () => {
      wrapper = createWrapper();

      // Initially WebRTC
      expect(wrapper.find('.v-textarea').exists()).toBe(true);
      
      // Switch to Websocket
      await wrapper.setData({ communicationMethod: 'Websocket' });
      await wrapper.vm.$nextTick();
      
      expect(wrapper.find('.v-textarea').exists()).toBe(false);
      expect(wrapper.find('.v-text-field').exists()).toBe(true);
    });

    test('emits update event with encoded config when method changes', async () => {
      wrapper = createWrapper();
      
      // Switch to Websocket method
      await wrapper.setData({ communicationMethod: 'Websocket' });
      await wrapper.vm.updateConfig();
      
      expect(wrapper.emitted()['update:config']).toBeTruthy();
      expect(wrapper.emitted()['update:config'][0][0]).toBe('encodedWebsocket');
    });
    
    test('does not emit update when in write protection mode', async () => {
      wrapper = createWrapper('encodedWebRTC', true);
      
      // Try to update config
      await wrapper.vm.updateConfig();
      
      // Should not emit update events when write-protected
      expect(wrapper.emitted()['update:config']).toBeFalsy();
    });
  });

  describe('URL Generation', () => {
    test('generates shareable link with encoded communication config', async () => {
      wrapper = createWrapper('encodedWebRTC');
      
      // Mock window.location
      const locationMock = {
        origin: 'http://localhost',
        pathname: '/'
      };
      Object.defineProperty(window, 'location', { value: locationMock, writable: true });
      
      await wrapper.vm.generateShareableLink();
      
      // Link should contain the class ID and encoded config in the hash
      expect(wrapper.vm.shareableLink).toContain('classroom/test-class#comm=');
    });

    test('copies link to clipboard', async () => {
      wrapper = createWrapper('encodedWebRTC');
      
      // Mock the clipboard API
      const mockClipboard = {
        writeText: vi.fn().mockImplementation(() => Promise.resolve())
      };
      Object.defineProperty(navigator, 'clipboard', {
        value: mockClipboard,
        writable: true
      });
      
      // Set a test link and trigger copy
      wrapper.vm.shareableLink = 'test-link';
      await wrapper.vm.copyShareableLink();
      
      expect(mockClipboard.writeText).toHaveBeenCalledWith('test-link');
      expect(wrapper.vm.copied).toBe(true);
      
      // Advance timers to test reset
      vi.advanceTimersByTime(2000);
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.copied).toBe(false);
    });
  });

  describe('Write Protection', () => {
    test('disables inputs when write protected', async () => {
      wrapper = createWrapper('encodedWebRTC', true);
      await wrapper.vm.$nextTick();
      
      const select = wrapper.find('select');
      const inputs = wrapper.findAll('input');
      const textareas = wrapper.findAll('textarea');
      
      expect(select.element.disabled).toBe(true);
      inputs.forEach((input: any) => {
        expect(input.element.disabled).toBe(true);
      });
      textareas.forEach((textarea: any) => {
        expect(textarea.element.disabled).toBe(true);
      });
    });
    
    test('hides share link section when write protected', async () => {
      wrapper = createWrapper('encodedWebRTC', true);
      await wrapper.vm.$nextTick();
      
      // The share link section should not be visible
      expect(wrapper.text()).not.toContain(messages.en.settings.communication.shareLink.title);
    });
  });

  describe('Translations', () => {
    test.each(['en', 'de', 'uk', 'ar', 'es'])('displays correct translations for %s locale', async (locale) => {
      wrapper = createWrapper('encodedWebRTC', false, locale);
      
      await wrapper.vm.$nextTick();
      
      const translations = messages[locale].settings.communication;
      const labels = translations.labels;
      
      // Check method label for communication method
      expect(wrapper.text()).toContain(labels.method);
      
      // Check WebRTC specific fields
      expect(wrapper.text()).toContain(labels.webrtcSignaling);
      expect(wrapper.text()).toContain(labels.webrtcConfig);
      
      // Check alert text - should contain both parts of the alert
      expect(wrapper.find('.v-alert').text()).toContain(translations.alert.first);
      expect(wrapper.find('.v-alert').text()).toContain(translations.alert.second);
      
      // Check shareable link section
      expect(wrapper.text()).toContain(translations.shareLink.title);
      expect(wrapper.text()).toContain(translations.shareLink.description);
      
      // Switch to Websocket method to test those translations
      await wrapper.setData({ communicationMethod: 'Websocket' });
      await wrapper.vm.$nextTick();
      
      // Check websocket server label
      expect(wrapper.text()).toContain(labels.websocketServer);
    });
  });
});
