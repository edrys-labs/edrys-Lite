import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import Communication from '../../../../src/components/Settings/Communication.vue';
import { i18n, messages } from '../../../setup';

// Mock the Utils functions
vi.mock('../../../../src/ts/Utils', () => ({
  encodeCommConfig: vi.fn((config) => {
    if (config.communicationMethod === 'WebRTC') {
      if (!config.signalingServer && !config.webrtcConfig) {
        return null; // Default WebRTC
      }
      return 'encodedCustomWebRTC';
    } else if (config.communicationMethod === 'Websocket') {
      if (!config.websocketUrl) {
        return 'ws'; // Default Websocket
      }
      return 'encodedCustomWebsocket';
    }
    return 'encodedConfig';
  }),
  
  decodeCommConfig: vi.fn((encodedConfig) => {
    if (encodedConfig === 'encodedCustomWebRTC') {
      return {
        communicationMethod: 'WebRTC',
        webrtcConfig: { iceServers: [{ urls: 'stun:custom.stun' }] },
        signalingServer: ['wss://custom.server']
      };
    } else if (encodedConfig === 'encodedCustomWebsocket') {
      return {
        communicationMethod: 'Websocket',
        websocketUrl: 'wss://custom.com'
      };
    } else if (encodedConfig === 'ws') {
      return {
        communicationMethod: 'Websocket'
      };
    }
    return null;
  }),
  
  updateUrlWithCommConfig: vi.fn(),
  cleanUrlAfterCommConfigExtraction: vi.fn()
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
        classId: 'test-class',
        keepUrlConfig: false
      },
      global: {
        stubs: {
          'v-container': { template: '<div class="v-container"><slot /></div>' },
          'v-select': {
            template: '<div class="v-select"><select v-model="modelValue" :disabled="$attrs.disabled" @change="$emit(\'update:modelValue\', $event.target.value)"><option value="WebRTC">WebRTC</option><option value="Websocket">Websocket</option></select></div>',
            props: ['modelValue'],
            emits: ['update:modelValue']
          },
          'v-text-field': {
            template: '<div class="v-text-field"><input v-model="modelValue" :disabled="$attrs.disabled" @input="$emit(\'update:modelValue\', $event.target.value)" /></div>',
            props: ['modelValue'],
            emits: ['update:modelValue']
          },
          'v-textarea': {
            template: '<div class="v-textarea"><textarea v-model="modelValue" :disabled="$attrs.disabled" @input="$emit(\'update:modelValue\', $event.target.value)"></textarea></div>',
            props: ['modelValue'],
            emits: ['update:modelValue']
          },
          'v-checkbox': {
            template: '<div class="v-checkbox"><input type="checkbox" v-model="modelValue" :disabled="$attrs.disabled" @change="$emit(\'update:modelValue\', $event.target.checked)" /></div>',
            props: ['modelValue'],
            emits: ['update:modelValue']
          },
          'v-alert': { template: '<div class="v-alert"><slot /></div>' },
          'v-divider': { template: '<hr class="v-divider" />' },
          'v-btn': {
            template: '<button class="v-btn" @click="$emit(\'click\')"><slot /></button>',
            emits: ['click']
          }
        }
      }
    });
  };

  describe('Core Functionality', () => {
    test('initializes with correct default values', () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.communicationMethod).toBe('WebRTC');
      expect(wrapper.vm.signalingServer).toBe('');
      expect(wrapper.vm.webrtcConfig).toBe('');
    });

    test('decodes config from encoded string', () => {
      wrapper = createWrapper('encodedCustomWebRTC');
      
      expect(wrapper.vm.communicationMethod).toBe('WebRTC');
      expect(wrapper.vm.signalingServer).toBe('wss://custom.server');
      expect(wrapper.vm.webrtcConfig).toContain('custom.stun');
    });

    test('switches communication methods correctly', async () => {
      wrapper = createWrapper();

      // Switch to Websocket
      await wrapper.setData({ communicationMethod: 'Websocket' });
      await wrapper.vm.$nextTick();
      
      expect(wrapper.find('.v-textarea').exists()).toBe(false);
      expect(wrapper.find('.v-text-field').exists()).toBe(true);
    });

    test('emits update event when config changes', async () => {
      wrapper = createWrapper();
      
      await wrapper.setData({ communicationMethod: 'Websocket' });
      await wrapper.vm.updateConfig();
      
      expect(wrapper.emitted()['update:config']).toBeTruthy();
    });

    test('respects write protection mode', async () => {
      wrapper = createWrapper('', true);
      
      await wrapper.vm.updateConfig();
      expect(wrapper.emitted()['update:config']).toBeFalsy();
    });
  });

  describe('Shareable Links', () => {
    test('generates correct shareable links for different configs', async () => {
      Object.defineProperty(window, 'location', {
        value: { origin: 'http://localhost:6999', pathname: '/' },
        writable: true
      });

      // Test default WebRTC - should not include comm parameter
      wrapper = createWrapper();
      wrapper.setData({
        communicationMethod: 'WebRTC',
        webrtcConfig: '',
        signalingServer: ''
      });
      
      wrapper.vm.generateShareableLink();
      expect(wrapper.vm.shareableLink).toBe('http://localhost:6999/?/classroom/test-class');

      // Test default Websocket - should include comm=ws
      wrapper.setData({ communicationMethod: 'Websocket', websocketUrl: '' });
      wrapper.vm.generateShareableLink();
      expect(wrapper.vm.shareableLink).toBe('http://localhost:6999/?/classroom/test-class#comm=ws');

      // Test custom config - should include encoded config
      wrapper.setData({
        communicationMethod: 'WebRTC',
        signalingServer: 'wss://custom.server'
      });
      wrapper.vm.generateShareableLink();
      expect(wrapper.vm.shareableLink).toBe('http://localhost:6999/?/classroom/test-class#comm=encodedCustomWebRTC');
    });

    test('copies link to clipboard', async () => {
      const mockClipboard = {
        writeText: vi.fn().mockResolvedValue(undefined)
      };
      Object.defineProperty(navigator, 'clipboard', {
        value: mockClipboard,
        writable: true
      });
      
      wrapper = createWrapper();
      wrapper.vm.shareableLink = 'test-link';
      await wrapper.vm.copyShareableLink();

      expect(mockClipboard.writeText).toHaveBeenCalledWith('test-link');
      expect(wrapper.vm.copied).toBe(true);
      
      vi.advanceTimersByTime(2000);
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.copied).toBe(false);
    });
  });

  describe('URL Configuration Checkbox', () => {
    test('renders keepConfigInUrl checkbox when not write protected', () => {
      wrapper = createWrapper();
      
      const checkbox = wrapper.find('.v-checkbox input[type="checkbox"]');
      expect(checkbox.exists()).toBe(true);
    });

    test('does not render checkbox when write protected', () => {
      wrapper = createWrapper('', true);
      
      // Share link section and checkbox should not be visible
      expect(wrapper.text()).not.toContain(messages.en.settings.communication.shareLink.title);
    });

    test('emits keepUrlConfig event when checkbox changes', async () => {
      wrapper = createWrapper();
      
      const checkbox = wrapper.find('.v-checkbox input[type="checkbox"]');
      await checkbox.setValue(true);
      
      expect(wrapper.emitted()['update:keepUrlConfig']).toBeTruthy();
      expect(wrapper.emitted()['update:keepUrlConfig'][0][0]).toBe(true);
    });
  });
});
