import { describe, test, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Classroom from '../../../src/views/Classroom.vue';
import { i18n, messages } from '../../setup';

// Mock dependencies
vi.mock('../../../src/ts/Database', () => ({
  Database: vi.fn().mockImplementation(() => ({
    setProtection: vi.fn(),
    get: vi.fn().mockResolvedValue({
      id: 'test-class',
      data: {
        name: 'Test Class',
        modules: [],
        createdBy: 'test-user',
        meta: { defaultNumberOfRooms: 2 }
      }
    }),
    setObservable: vi.fn(),
    update: vi.fn(),
    drop: vi.fn()
  }))
}));

vi.mock('../../../src/ts/Utils', () => ({
  infoHash: vi.fn(() => 'test-hash'),
  scrapeModule: vi.fn().mockResolvedValue({ name: 'Test Module' }),
  clone: vi.fn(obj => JSON.parse(JSON.stringify(obj))),
  getPeerID: vi.fn(() => 'test-peer-id'),
  getShortPeerID: vi.fn(() => 'test-user'),
  getBasePeerID: vi.fn(id => id?.split('-')[0] || id),
  deepEqual: vi.fn(),
  copyToClipboard: vi.fn(),
  extractCommunicationConfigFromUrl: vi.fn().mockReturnValue(null),
  compareCommunicationConfig: vi.fn((oldConfig, newConfig) => {
    if (!oldConfig && !newConfig) return true;
    if (!oldConfig || !newConfig) return false;
    return JSON.stringify(oldConfig) === JSON.stringify(newConfig);
  }),
  updateUrlWithCommConfig: vi.fn(),
}));

// Create a mock communication object that uses vi.fn() for all methods
const mockCommunication = {
  on: vi.fn(),
  join: vi.fn(),
  update: vi.fn(),
  gotoRoom: vi.fn(),
  addRoom: vi.fn(),
  sendMessage: vi.fn(),
  newSetup: vi.fn(),
  allowedToParticipate: vi.fn().mockReturnValue(true)  
};

// Update the Peer mock to return our mockCommunication
vi.mock('../../../src/ts/Peer', () => ({
  default: vi.fn().mockImplementation(() => mockCommunication)
}));

describe('Classroom View', () => {
  const createWrapper = (props = {}) => {
    return mount(Classroom, {
      props: {
        id: 'test-class',
        station: false,
        hash: null,
        ...props
      },
      global: {
        stubs: {
          'v-app': {
            template: '<div class="v-app"><slot /></div>'
          },
          'v-layout': {
            template: '<div class="v-layout"><slot /></div>'
          },
          'v-app-bar': {
            template: '<div class="v-app-bar"><slot /></div>'
          },
          'v-app-bar-nav-icon': true,
          'v-app-bar-title': true,
          'v-main': true,
          'v-navigation-drawer': {
            template: `
              <nav class="v-navigation-drawer">
                <div class="v-navigation-drawer-prepend">
                  <slot name="prepend" />
                </div>
                <slot />
                <div class="v-navigation-drawer-append">
                  <slot name="append" />
                </div>
              </nav>
            `
          },
          'v-dialog': {
            template: '<div class="v-dialog"><slot /></div>'
          },
          'v-list': {
            template: '<div class="v-list"><slot /></div>'
          },
          'v-list-item': {
            template: `
              <div class="v-list-item">
                <slot />
                <div class="v-list-item-append">
                  <slot name="append" />
                </div>
              </div>
            `
          },
          'v-list-item-title': {
            template: '<div class="v-list-item-title"><slot /></div>'
          },
          'v-list-item-subtitle': {
            template: '<div class="v-list-item-subtitle"><slot /></div>'
          },
          'v-btn': {
            template: '<button class="v-btn" :title="$attrs.title" :class="$attrs.class" @click="$emit(\'click\')"><slot /><i v-if="$attrs.icon" :class="$attrs.icon"></i></button>'
          },
          'v-icon': {
            template: '<i :class="$attrs.icon"><slot /></i>'
          },
          'v-spacer': true,
          'v-divider': true,
          'v-menu': true,
          'v-badge': true,
          'v-overlay': {
            template: '<div class="v-overlay"><slot /></div>'
          },
          'v-card': {
            template: '<div class="v-card"><slot /></div>'
          },
          'v-card-text': {
            template: '<div class="v-card-text"><slot /></div>'
          },
          'v-form': {
            template: '<form class="v-form"><slot /></form>'
          },
          'v-text-field': {
            template: '<div class="v-text-field"><slot /></div>'
          },
          Settings: true,
          Chat: true,
          Modules: true,
          Checks: true,
          Logger: true
        }
      }
    });
  };

  test('initializes correctly', async () => {
    const wrapper = createWrapper();
    
    expect(wrapper.vm.states.webRTCSupport).toBeDefined();
    expect(wrapper.vm.database).toBeDefined();
    expect(wrapper.vm.peerID).toBe('test-peer-id');
  });

  test('handles room management', async () => {
    const wrapper = createWrapper();

    // Wait for initialization
    await wrapper.vm.init();
    expect(wrapper.vm.communication).toBeTruthy();

    wrapper.vm.liveClassProxy = {
      users: {
        'test-user': { room: 'Lobby' }
      },
      rooms: {
        'Lobby': {},
        'Room1': {}
      }
    };

    expect(Object.keys(wrapper.vm.getRooms())).toHaveLength(2);
    
    wrapper.vm.gotoRoom('Room1');
    expect(mockCommunication.gotoRoom).toHaveBeenCalledWith('Room1');
  });

  test('handles user roles correctly', async () => {
    const wrapper = createWrapper();

    await wrapper.vm.init();
    
    // Test teacher role
    wrapper.vm.peerID = 'test-user';
    expect(wrapper.vm.getRole()).toBe('teacher');

    // Test student role
    wrapper.vm.peerID = 'test-student';
    expect(wrapper.vm.getRole()).toBe('student');

    // Test station role
    wrapper.vm.isStation = true;
    expect(wrapper.vm.getRole()).toBe('station');
  });

  test('handles chat messages', async () => {
    const wrapper = createWrapper();
    
    await wrapper.vm.init();
    expect(wrapper.vm.communication).toBeTruthy();
    
    wrapper.vm.sendMessage('test message');
    expect(mockCommunication.sendMessage).toHaveBeenCalledWith('test message');
  });

  test('handles class configuration updates', async () => {
    const wrapper = createWrapper();
    await wrapper.vm.init();

    const newConfig = {
      name: 'Updated Class',
      modules: [],
      meta: { defaultNumberOfRooms: 3 }
    };

    // Directly update the configuration
    wrapper.vm.configuration = {
      ...wrapper.vm.configuration,
      data: newConfig
    };

    wrapper.vm.updateClass({ data: newConfig });
    
    expect(wrapper.vm.data).toEqual(newConfig);
    
    // Test database update
    await wrapper.vm.database.update(wrapper.vm.configuration);
    expect(wrapper.vm.database.update).toHaveBeenCalled();
  });

  test('handles station mode', () => {
    const wrapper = createWrapper({ station: true });

    expect(wrapper.vm.isStation).toBe(true);
    expect(wrapper.vm.stationName).toBeTruthy();
    
    wrapper.vm.setStationName();
    expect(sessionStorage.getItem(`station_test-class`)).toBeTruthy();
  });

  test('validates station names', () => {
    const wrapper = createWrapper({ station: true });
    const rules = wrapper.vm.stationNameRules;

    expect(rules[0]('')).toBe('Name is required');
    expect(rules[0]('test')).toBe(true);
  });

  test('handles station name change', async () => {
    // Mock window.location.reload
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload: reloadMock },
      writable: true
    });

    const wrapper = createWrapper({ station: true });
    await wrapper.vm.init();

    // Set new station name
    wrapper.vm.stationNameInput = 'new-station';
    
    // Mock liveClassProxy to test name availability
    wrapper.vm.liveClassProxy = {
      rooms: {
        'Station other-station': {}
      }
    };

    // Call setStationName
    await wrapper.vm.setStationName();

    // Verify storage and reload
    expect(sessionStorage.getItem(`station_test-class`)).toBe('new-station');
    expect(reloadMock).toHaveBeenCalled();
  });

  describe('translations', () => {
    test.each(['en', 'de', 'uk', 'ar', 'es'])('displays correct translations for %s locale', async (locale) => {
      i18n.global.locale.value = locale as 'en' | 'de' | 'uk' | 'ar' | 'es';
      
      // Test station mode translations
      const stationWrapper = createWrapper({ station: true });
      await stationWrapper.vm.$nextTick();
      
      const translations = messages[locale].classroom;
      
      // Check station mode text
      const cardTexts = stationWrapper.findAll('.v-card-text');
      expect(cardTexts[0].text()).toContain(translations.station.mode);

      // Check station mode form content
      const form = stationWrapper.find('.v-form');
      expect(form.exists()).toBe(true);

      // Check that station label is used somewhere in the template
      expect(stationWrapper.html()).toContain(translations.station.label);

      // Check station mode description
      expect(cardTexts[1].text()).toContain(translations.station.modeDescription);

      // Check exit station mode button
      const lastCardText = stationWrapper.findAll('.v-card-text').at(-1);
      const exitButton = lastCardText.find('.v-btn');
      expect(exitButton.text()).toContain(translations.station.exit);

      // Create a new wrapper for side menu tests (classroom mode)
      const menuWrapper = createWrapper();
      await menuWrapper.vm.$nextTick();

      menuWrapper.vm.showSideMenu = true;
      await menuWrapper.vm.$nextTick();

      // Check side menu texts
      const sideMenuTranslations = translations.sideMenu;
      
      expect(menuWrapper.html()).toContain(sideMenuTranslations.onlineUsers);

      menuWrapper.vm.isOwner = true;
      await menuWrapper.vm.$nextTick();
      
      expect(menuWrapper.html()).toContain(sideMenuTranslations.settings);
      expect(menuWrapper.html()).toContain(sideMenuTranslations.newRoom);
    });
  });
});


