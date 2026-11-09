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
  roomSlot: vi.fn((name: string) => (name === 'Lobby' ? null : 0)),
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
  clearRoomState: vi.fn(),
  sendMessage: vi.fn(),
  newSetup: vi.fn(),
  stop: vi.fn(),
  allowedToParticipate: vi.fn().mockReturnValue(true)  
};

// Update the Peer mock to return our mockCommunication
vi.mock('../../../src/ts/Peer', () => ({
  default: vi.fn().mockImplementation(() => mockCommunication),
  MAX_ROOMS: 50,
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

    expect(wrapper.vm.orderedRooms()).toEqual(['Lobby', 'Room1']);
    
    wrapper.vm.gotoRoom('Room1');
    expect(mockCommunication.gotoRoom).toHaveBeenCalledWith('Room1');
  });

  describe('rooms drawer', () => {
    const live = {
      users: {
        'test-peer-id': { room: 'Lobby', displayName: 'test-user', role: 'teacher' },
        'other-peer': { room: 'Room 1', displayName: 'other', role: 'student' },
        'Station abc': { room: 'Station abc', displayName: 'Station abc', role: 'station' },
      },
      rooms: { 'Lobby': {}, 'Room 1': {}, 'Station abc': {} },
    };

    const openDrawer = async () => {
      const wrapper = createWrapper();
      await wrapper.vm.init();
      wrapper.vm.liveClassProxy = live;
      await wrapper.vm.$nextTick();
      return wrapper;
    };

    const nameRooms = async (wrapper: any, roomNames: Record<string, string>) => {
      const data = wrapper.vm.configuration.data;
      wrapper.vm.database.update = vi.fn().mockResolvedValue('test-id');
      wrapper.vm.saveClass({ ...data, meta: { ...data.meta, roomNames } });
      await flushPromises();
    };

    test('has one button per room that goes there, the current one marked', async () => {
      const wrapper = await openDrawer();
      const rows = wrapper.findAll('.room-row');
      expect(rows.map((r) => r.attributes('aria-label'))).toEqual([
        'Go to Lobby, 1 person',
        'Go to Room 1, 1 person',
        'Go to Station abc',
      ]);
      expect(rows[0].attributes('aria-current')).toBe('true');
      expect(rows[1].attributes('aria-current')).toBeUndefined();

      mockCommunication.gotoRoom.mockClear();
      await rows[1].trigger('click');
      expect(mockCommunication.gotoRoom).toHaveBeenCalledWith('Room 1');
    });

    test('shows a room label but still goes to the internal room', async () => {
      const wrapper = await openDrawer();
      await nameRooms(wrapper, { 'Room 1': 'Group B' });

      const room = wrapper.vm.drawerRooms.find((r: any) => r.name === 'Room 1');
      expect(room).toMatchObject({ label: 'Group B', initial: 'G' });

      mockCommunication.gotoRoom.mockClear();
      await wrapper.findAll('.room-row')[1].trigger('click');
      expect(mockCommunication.gotoRoom).toHaveBeenCalledWith('Room 1');
    });

    test('keeps the number for an empty label and never labels the Lobby or a station', async () => {
      const wrapper = await openDrawer();
      await nameRooms(wrapper, { 'Room 1': '   ', Lobby: 'Hall', 'Station abc': 'Bench' });

      const [lobby, room, station] = wrapper.vm.drawerRooms;
      expect(room).toMatchObject({ label: 'Room 1', initial: '1' });
      expect(lobby.label).toBe('Lobby');
      expect(station.label).toBe('Station abc');
    });

    test('lets teachers rename numbered rooms only', async () => {
      const wrapper = await openDrawer();
      expect(wrapper.find('.room-rename-open').exists()).toBe(false);

      wrapper.vm.isTeacher = true;
      await wrapper.vm.$nextTick();
      expect(wrapper.findAll('.room-rename-open')).toHaveLength(1);
    });

    test('New room is for owners and teachers', async () => {
      const wrapper = createWrapper();
      await wrapper.vm.init();
      wrapper.vm.isOwner = false;
      wrapper.vm.isTeacher = false;
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.drawer-btn').exists()).toBe(false);

      wrapper.vm.isTeacher = true;
      await wrapper.vm.$nextTick();
      expect(wrapper.findAll('.drawer-btn')).toHaveLength(1);
    });

    test('saves a new label into the setup', async () => {
      const wrapper = await openDrawer();
      wrapper.vm.database.update = vi.fn().mockResolvedValue('test-id');
      wrapper.vm.startRoomRename('Room 1');
      wrapper.vm.roomLabelInput = ' Group B ';
      wrapper.vm.saveRoomLabel();
      await flushPromises();

      expect(wrapper.vm.renamingRoom).toBeNull();
      expect(wrapper.vm.database.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            meta: expect.objectContaining({ roomNames: { 'Room 1': 'Group B' } }),
          }),
        })
      );
    });

    test('keeps the form open and saves nothing for an invalid label', async () => {
      const wrapper = await openDrawer();
      wrapper.vm.database.update = vi.fn().mockResolvedValue('test-id');
      wrapper.vm.startRoomRename('Room 1');
      wrapper.vm.roomLabelInput = 'Lobby';
      await wrapper.vm.$nextTick();
      wrapper.vm.saveRoomLabel();

      expect(wrapper.vm.roomLabelError).not.toBe('');
      expect(wrapper.vm.renamingRoom).toBe('Room 1');
      expect(wrapper.vm.database.update).not.toHaveBeenCalled();
    });

    test('warns about modules that would leave the room, and still allows the rename', async () => {
      const wrapper = await openDrawer();
      await nameRooms(wrapper, { 'Room 1': 'Group B' });
      wrapper.vm.scrapedModules = [{ name: 'Editor', showInCustom: 'Group B' }];
      wrapper.vm.startRoomRename('Room 1');
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.roomLabelWarning).toBe('');

      wrapper.vm.roomLabelInput = 'Other';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.roomLabelWarning).toContain('Editor');
      expect(wrapper.vm.roomLabelError).toBe('');
    });

    test('does not save when an unnamed room stays unnamed', async () => {
      const wrapper = await openDrawer();
      wrapper.vm.database.update = vi.fn().mockResolvedValue('test-id');
      wrapper.vm.startRoomRename('Room 1');
      wrapper.vm.saveRoomLabel();

      expect(wrapper.vm.renamingRoom).toBeNull();
      expect(wrapper.vm.database.update).not.toHaveBeenCalled();
    });

    test('does not list or count a station as a person in its room', async () => {
      const wrapper = await openDrawer();
      const stationRoom = wrapper.findAll('.room')[2];
      expect(stationRoom.find('.room-count').exists()).toBe(false);
      expect(stationRoom.findAll('.room-user')).toHaveLength(0);

      wrapper.vm.liveClassProxy = {
        ...live,
        users: { ...live.users, 'other-peer': { room: 'Station abc', displayName: 'other', role: 'student' } },
      };
      await wrapper.vm.$nextTick();
      expect(wrapper.findAll('.room')[2].find('.room-count').text()).toBe('1');
      expect(wrapper.findAll('.room')[2].findAll('.room-user')).toHaveLength(1);
      expect(wrapper.vm.stationRooms[0].online).toBe(true);
    });

    test('shows numbered rooms by their number and others by their initial', async () => {
      const wrapper = await openDrawer();
      expect(wrapper.findAll('.room-row .room-tile').map((t) => t.text())).toEqual(['L', '1', 'S']);
    });

    test('tags you and teachers, and spells out every role for screen readers', async () => {
      const wrapper = await openDrawer();
      const users = wrapper.findAll('.room-user');
      expect(users[0].find('.user-tag').text()).toBe('you · Teacher');
      expect(users[0].find('.d-sr-only').text()).toBe(', Teacher, you');
      expect(users[1].find('.user-tag').exists()).toBe(false);
      expect(users[1].find('.d-sr-only').text()).toBe(', Student');
    });

    test('shows the current room in the app bar only while the drawer is closed', async () => {
      const wrapper = await openDrawer();
      expect(wrapper.find('[data-test="room-pill"]').exists()).toBe(false);

      wrapper.vm.showSideMenu = false;
      await wrapper.vm.$nextTick();
      const pill = wrapper.find('[data-test="room-pill"]');
      expect(pill.attributes('aria-label')).toBe('Rooms: Lobby, 1 person');

      await pill.trigger('click');
      expect(wrapper.vm.showSideMenu).toBe(true);
    });
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

    test('New room saves the room count plus one', async () => {
      const { wrapper, db } = await saveWith({});
      db.update.mockClear();
      mockCommunication.newSetup.mockClear();

      wrapper.vm.addRoom();
      await flushPromises();

      expect(db.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ meta: expect.objectContaining({ defaultNumberOfRooms: 3 }) }) })
      );
      expect(mockCommunication.newSetup).toHaveBeenCalled();
      expect(wrapper.vm.configuration.data.meta.defaultNumberOfRooms).toBe(3);
    });

    test('New room counts up from a room count saved as text', async () => {
      // The settings field stored the count as a string before it used v-model.number.
      const { wrapper, db } = await saveWith({ meta: { defaultNumberOfRooms: '1' } });
      db.update.mockClear();

      wrapper.vm.addRoom();
      await flushPromises();

      expect(wrapper.vm.configuration.data.meta.defaultNumberOfRooms).toBe(2);
    });

    test('New room does nothing at the room cap', async () => {
      const { wrapper, db } = await saveWith({ meta: { defaultNumberOfRooms: 50 } });
      db.update.mockClear();

      expect(wrapper.vm.canAddRoom()).toBe(false);
      wrapper.vm.addRoom();
      await flushPromises();

      expect(db.update).not.toHaveBeenCalled();
      expect(wrapper.vm.configuration.data.meta.defaultNumberOfRooms).toBe(50);
    });

    test('lowering the room count clears the state of the rooms it drops', async () => {
      const { wrapper } = await saveWith({ meta: { defaultNumberOfRooms: 3 } });
      mockCommunication.clearRoomState.mockClear();

      wrapper.vm.saveClass({ ...wrapper.vm.configuration.data, meta: { defaultNumberOfRooms: 1 } });

      expect(mockCommunication.clearRoomState.mock.calls).toEqual([['Room 2'], ['Room 3']]);
    });

    test('lowering the room count drops only the labels of the rooms it removes', async () => {
      const { wrapper } = await saveWith({
        meta: { defaultNumberOfRooms: 2, roomNames: { 'Room 1': 'Group A', 'Room 2': 'Group B' } },
      });

      wrapper.vm.saveClass({
        ...wrapper.vm.configuration.data,
        meta: { defaultNumberOfRooms: 1, roomNames: { 'Room 1': 'Group A', 'Room 2': 'Group B' } },
      });

      expect(wrapper.vm.configuration.data.meta.roomNames).toEqual({ 'Room 1': 'Group A' });
    });

    test('raising the room count clears nothing', async () => {
      const { wrapper } = await saveWith({ meta: { defaultNumberOfRooms: 1 } });
      mockCommunication.clearRoomState.mockClear();

      wrapper.vm.addRoom();

      expect(mockCommunication.clearRoomState).not.toHaveBeenCalled();
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
    expect(rules[0]('   ')).toBe('Name is required');
    expect(rules[0]('test')).toBe(true);
  });

  test('rejects station names too long or with room list characters', () => {
    const wrapper = createWrapper({ station: true });
    const rules = wrapper.vm.stationNameRules;

    expect(rules[1](`  ${'x'.repeat(40)}  `)).toBe(true);
    expect(rules[1]('x'.repeat(41))).toBe('Use at most 40 characters');
    expect(rules[1]('a,b')).toBe('Commas and asterisks are not allowed');
    expect(rules[1]('a*')).toBe('Commas and asterisks are not allowed');
  });

  test('a station name is taken by another station but not by this one', () => {
    const wrapper = createWrapper({ station: true });
    wrapper.vm.liveClassProxy = {
      rooms: { 'Station other': {}, [`Station ${wrapper.vm.stationName}`]: {} },
    };
    const taken = wrapper.vm.stationNameRules[2];

    expect(taken(' other ')).toBe('Name is already taken');
    expect(taken(wrapper.vm.stationName)).toBe(true);
    expect(taken('free')).toBe(true);
  });

  test('stores a station name trimmed and does not reload for its own name', async () => {
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', { value: { reload: reloadMock }, writable: true });
    const wrapper = createWrapper({ station: true });

    wrapper.vm.stationNameInput = ` ${wrapper.vm.stationName} `;
    await wrapper.vm.setStationName();
    expect(reloadMock).not.toHaveBeenCalled();

    wrapper.vm.stationNameInput = '  Bench 2  ';
    await wrapper.vm.setStationName();
    expect(sessionStorage.getItem('station_test-class')).toBe('Bench 2');
    expect(reloadMock).toHaveBeenCalledOnce();
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


