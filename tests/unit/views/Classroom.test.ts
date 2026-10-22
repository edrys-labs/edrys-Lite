import { describe, test, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Classroom from '../../../src/views/Classroom.vue';
import { scrapeModule, getPeerID } from '../../../src/ts/Utils';

const flushPromises = () => new Promise((r) => setTimeout(r, 0));

// Mock dependencies
vi.mock('../../../src/ts/Database', () => ({
  Database: vi.fn().mockImplementation(() => ({
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
  sameKey: vi.fn((a: any, b: any) => !!a && !!b && a.replace(/=/g, '') === b.replace(/=/g, '')),
  isMember: vi.fn((list: any, key: string) => (list || []).some((m: string) => m.replace(/=/g, '') === key.replace(/=/g, ''))),
  getBasePeerID: vi.fn(id => id?.split('-')[0] || id),
  getDisplayPeerID: vi.fn(() => 'test-user'),
  deepEqual: vi.fn((a, b) => JSON.stringify(a) === JSON.stringify(b)),
  decodeCommConfig: vi.fn((s) => (s === 'ws' ? { communicationMethod: 'Websocket' } : null)),
  copyToClipboard: vi.fn(),
  roomColor: vi.fn(() => '#1E88E5'),
  hashPubKey: vi.fn(() => Promise.resolve('testhash1234')),
  initCryptoIdentity: vi.fn(() => Promise.resolve()),
  signSetup: vi.fn(() => Promise.resolve('mock-signature')),
  verifySetup: vi.fn(() => Promise.resolve(true)),
  extractCommunicationConfigFromUrl: vi.fn().mockReturnValue(null),
  compareCommunicationConfig: vi.fn((oldConfig, newConfig) => {
    if (!oldConfig && !newConfig) return true;
    if (!oldConfig || !newConfig) return false;
    return JSON.stringify(oldConfig) === JSON.stringify(newConfig);
  }),
  updateUrlWithCommConfig: vi.fn(),
  cleanUrlAfterCommConfigExtraction: vi.fn()
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
  stop: vi.fn(),
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

  test('stops its Peer when unmounted', async () => {
    // The router remounts the app on popstate; the old Peer must leave the room.
    const wrapper = createWrapper();
    await wrapper.vm.init();
    expect(wrapper.vm.communication).toBeTruthy();
    mockCommunication.stop.mockClear();

    wrapper.unmount();

    expect(mockCommunication.stop).toHaveBeenCalledTimes(1);
  });

  test('hands the owner hash from the URL to Peer as the expected owner', async () => {
    const PeerMock = vi.mocked((await import('../../../src/ts/Peer')).default);
    PeerMock.mockClear();

    const wrapper = createWrapper({ owner: 'owner-hash-123' });
    await wrapper.vm.init();

    expect(PeerMock).toHaveBeenCalledTimes(1);
    expect(PeerMock.mock.calls[0][4]).toBe('owner-hash-123');
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
    
    // The owner (createdBy) is a teacher, also with the key's padding stripped
    vi.mocked(getPeerID).mockReturnValue('test-user');
    expect(wrapper.vm.getRole()).toBe('teacher');
    wrapper.vm.configuration.data.createdBy = 'test-user==';
    expect(wrapper.vm.getRole()).toBe('teacher');

    // Listed teachers too, compared the same way
    vi.mocked(getPeerID).mockReturnValue('listed-teacher');
    wrapper.vm.configuration.data.members = { teacher: ['listed-teacher='], student: [] };
    expect(wrapper.vm.getRole()).toBe('teacher');

    vi.mocked(getPeerID).mockReturnValue('test-student');
    expect(wrapper.vm.getRole()).toBe('student');

    // Test station role
    wrapper.vm.isStation = true;
    expect(wrapper.vm.getRole()).toBe('station');
    vi.mocked(getPeerID).mockReturnValue('test-peer-id');
  });

  test('shows that the connection is lost until it is back', async () => {
    const wrapper = createWrapper();
    mockCommunication.on.mockClear();
    await wrapper.vm.init();
    const onOnline = mockCommunication.on.mock.calls.find(([event]) => event === 'online')![1];

    expect(wrapper.find('[data-test="offline-chip"]').exists()).toBe(false);
    onOnline(false);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="offline-chip"]').exists()).toBe(true);
    onOnline(true);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="offline-chip"]').exists()).toBe(false);
  });

  test('handles chat messages', async () => {
    const wrapper = createWrapper();
    
    await wrapper.vm.init();
    expect(wrapper.vm.communication).toBeTruthy();
    
    wrapper.vm.sendMessage('test message');
    expect(mockCommunication.sendMessage).toHaveBeenCalledWith('test message');
  });

  test('marks the chat as new only for messages written since the class was opened', async () => {
    const wrapper = createWrapper();
    await wrapper.vm.init();
    mockCommunication.on.mockClear();
    await wrapper.vm.scrapeModules();
    const onChat = mockCommunication.on.mock.calls.find(([event]) => event === 'chat')![1];
    const since = wrapper.vm.chat.since;
    const msg = (signature: string, timestamp: number) => ({ signature, timestamp, msg: signature, user: 'u' });

    // History: written before we came, shown as its writers' presence arrives
    onChat({ messages: [], truncated: false });
    onChat({ messages: [msg('old-1', since - 60000)], truncated: false });
    onChat({ messages: [msg('old-1', since - 60000), msg('old-2', since - 1000)], truncated: false });
    expect(wrapper.vm.chat.new).toBe(false);

    onChat({ messages: [msg('old-1', since - 60000), msg('old-2', since - 1000), msg('new', since + 1)], truncated: false });
    expect(wrapper.vm.chat.new).toBe(true);
  });

  describe('saveClass', () => {
    const savedModule = { url: 'https://module.example/new' };

    async function saveWith(changes: any) {
      const wrapper = createWrapper();
      await wrapper.vm.init();
      const db: any = wrapper.vm.database;
      db.update.mockResolvedValue('test-class');
      vi.mocked(scrapeModule).mockClear();
      mockCommunication.newSetup.mockClear();

      wrapper.vm.saveClass({ ...wrapper.vm.configuration.data, ...changes });
      await flushPromises();
      return { wrapper, db };
    }

    test('stores the new setup, hands it to Peer and loads changed modules', async () => {
      const { wrapper, db } = await saveWith({ name: 'Updated Class', modules: [savedModule] });

      expect(db.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'Updated Class' }) })
      );
      // Peer gets what the database stored, so it signs the persisted version.
      expect(mockCommunication.newSetup).toHaveBeenCalledWith(await db.get.mock.results[0].value);
      expect(wrapper.vm.data.name).toBe('Updated Class');
      expect(scrapeModule).toHaveBeenCalledWith(savedModule);
    });

    test('does not reload modules when the transport changed (the page reloads instead)', async () => {
      await saveWith({ modules: [savedModule], communicationConfig: 'ws' });
      expect(scrapeModule).not.toHaveBeenCalled();
    });

    test('does not reload modules that did not change', async () => {
      await saveWith({ name: 'Renamed only' });
      expect(scrapeModule).not.toHaveBeenCalled();
    });
  });

  describe('scrapeModules', () => {
    // scrapeModule() calls that resolve only when the test says so.
    function deferScrapes() {
      const pending: { module: any; resolve: () => void }[] = [];
      vi.mocked(scrapeModule).mockImplementation(
        (module: any) =>
          new Promise((resolve) =>
            pending.push({ module, resolve: () => resolve({ ...module, scraped: true }) })
          )
      );
      return pending;
    }

    async function startTwoScrapes() {
      const wrapper = createWrapper();
      await wrapper.vm.init();
      await flushPromises();
      const pending = deferScrapes();

      const oldModule = { url: 'https://module.example/old' };
      const newModule = { url: 'https://module.example/new' };
      wrapper.vm.data.modules = [oldModule];
      const first = wrapper.vm.scrapeModules();
      wrapper.vm.data.modules = [newModule];
      const second = wrapper.vm.scrapeModules();

      return { wrapper, pending, first, second, oldModule, newModule };
    }

    test('a slow older load does not overwrite the modules of a newer one', async () => {
      const { wrapper, pending, first, second, newModule } = await startTwoScrapes();

      pending[1].resolve();
      await second;
      pending[0].resolve();
      await first;

      expect(wrapper.vm.scrapedModules).toEqual([{ ...newModule, scraped: true }]);
    });

    test('stays loading until the newest load finishes', async () => {
      const { wrapper, pending, first, second, newModule } = await startTwoScrapes();

      pending[0].resolve();
      await first;
      expect(wrapper.vm.isLoadingModules).toBe(true);
      expect(wrapper.vm.scrapedModules).not.toEqual([{ url: 'https://module.example/old', scraped: true }]);

      pending[1].resolve();
      await second;
      expect(wrapper.vm.isLoadingModules).toBe(false);
      expect(wrapper.vm.scrapedModules).toEqual([{ ...newModule, scraped: true }]);
    });
  });

  test('handles station mode', () => {
    const wrapper = createWrapper({ station: true });

    expect(wrapper.vm.isStation).toBe(true);
    expect(wrapper.vm.stationName).toBeTruthy();
    // A station keeps its generated name for the session.
    expect(sessionStorage.getItem(`station_test-class`)).toBe(wrapper.vm.stationName);
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
});


