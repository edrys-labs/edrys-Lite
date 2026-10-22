import { describe, test, expect, vi } from 'vitest';
import { copyToClipboard, hashPubKey } from '../../../src/ts/Utils';
import { mount } from '@vue/test-utils';
import Index from '../../../src/views/Index.vue';

// Mock dependencies
const setObservableSpy = vi.fn();

vi.mock('../../../src/ts/Database', () => ({
  Database: vi.fn().mockImplementation(() => ({
    setObservable: setObservableSpy.mockImplementation((query, callback) => {
      callback(mockClassrooms);
    }),
    put: vi.fn().mockResolvedValue('test-hash'),
    drop: vi.fn()
  }))
}));

vi.mock('../../../src/ts/Utils', () => ({
  infoHash: vi.fn(() => 'test-hash'),
  getPeerID: vi.fn(() => 'test-user'),
  hashPubKey: vi.fn(() => Promise.resolve('testhash1234')),
  isPubKey: vi.fn((key: string) => key !== 'legacy-id'),
  initCryptoIdentity: vi.fn(() => Promise.resolve()),
  clone: vi.fn(obj => JSON.parse(JSON.stringify(obj))),
  normalizeClassroom: vi.fn((data) => data),
  sameKey: vi.fn((a: any, b: any) => !!a && !!b && a.replace(/=/g, '') === b.replace(/=/g, '')),
  isMember: vi.fn((list: any, key: string) => (list || []).some((m: string) => m.replace(/=/g, '') === key.replace(/=/g, ''))),
  removeKeysStartingWithSecret: vi.fn(),
  copyToClipboard: vi.fn()
}));

const mockClassrooms = [
  {
    id: 'class-1',
    data: {
      name: 'Test Class 1',
      createdBy: 'test-user',
      meta: {
        logo: 'test-logo',
        description: 'Test Description'
      },
      members: {
        teacher: ['test-user'],
        student: []
      },
      modules: []
    },
    hash: null
  },
  {
    id: 'class-2',
    data: {
      name: 'Test Class 2',
      createdBy: 'other-user',
      meta: {},
      members: {
        teacher: [],
        student: ['test-user']
      },
      modules: []
    },
    hash: 'protected'
  }
];

describe('Index View', () => {
  const createWrapper = () => {
    return mount(Index, {
      global: {
        stubs: {
          'v-app': {
            template: '<div class="v-app"><slot /></div>'
          },
          'v-app-bar': {
            template: '<div class="v-app-bar"><slot /></div>'
          },
          'v-main': {
            template: '<div class="v-main"><slot /></div>'
          },
          'v-container': {
            template: '<div class="v-container"><slot /></div>'
          },
          'v-row': {
            template: '<div class="v-row"><slot /></div>'
          },
          'v-col': {
            template: '<div class="v-col" v-bind="$attrs"><slot /></div>',
            inheritAttrs: false
          },
          'v-card': {
            template: `
              <div 
                class="v-card" 
                data-test="classroom-card"
                @click="$emit('click')"
              >
                <slot />
                <slot name="title" />
                <slot name="subtitle" />
                <slot name="text" />
                <slot name="actions" />
              </div>
            `,
            inheritAttrs: false
          },
          'v-card-title': {
            template: '<div class="v-card-title"><slot /></div>'
          },
          'v-card-subtitle': {
            template: '<div class="v-card-subtitle"><slot /></div>'
          },
          'v-card-text': {
            template: '<div class="v-card-text"><slot /></div>'
          },
          'v-card-actions': {
            template: '<div class="v-card-actions"><slot /></div>'
          },
          'v-btn': {
            template: `
              <button 
                :class="['v-btn', $attrs.color]"
                :title="$attrs.title"
                :icon="$attrs.icon"
                @click="$emit('click')"
              >
                <i v-if="$attrs.icon" :class="$attrs.icon"></i>
                <slot />
              </button>
            `,
            inheritAttrs: false
          },
          'v-icon': {
            template: '<span class="v-icon" :class="$attrs.icon"><slot /></span>',
            inheritAttrs: true
          },
          'v-menu': {
            template: `
              <div class="v-menu">
                <slot name="activator" :props="{ props: {} }" />
                <div class="v-menu-content" style="display: block">
                  <slot />
                </div>
              </div>
            `
          },
          'v-list': {
            template: '<div class="v-list"><slot /></div>'
          },
          'v-list-item': {
            template: '<div class="v-list-item"><slot /></div>'
          },
          'v-chip': {
            template: '<div class="v-chip"><slot /></div>'
          },
          'v-switch': true,
          'v-spacer': true,
          'v-img': true,
          Footer: true
        }
      }
    });
  };

  test('renders classroom list', async () => {
    const wrapper = createWrapper();
    
    await wrapper.setData({
      classrooms: mockClassrooms
    });
    
    const cards = wrapper.findAll('[data-test="classroom-card"]');
    expect(cards).toHaveLength(mockClassrooms.length + 1); // +1 for create card
  });

  test('a stored classroom without members does not hide the list', async () => {
    const wrapper = createWrapper();
    const bare = { id: 'bare', data: { name: 'Imported', createdBy: 'other-user', meta: {} }, hash: null };

    await wrapper.setData({ classrooms: [bare, ...mockClassrooms] });

    expect(wrapper.text()).toContain('Imported');
    expect(wrapper.text()).toContain('Test Class 1');
  });

  test('shows a classroom description as text, not HTML', async () => {
    const wrapper = createWrapper();
    const payload = '<img src=x onerror=alert(1)>';
    const classroom = JSON.parse(JSON.stringify(mockClassrooms[0]));
    classroom.data.meta.description = payload;

    await wrapper.setData({ classrooms: [classroom] });

    const text = wrapper.find('.v-card-text');
    expect(text.find('img').exists()).toBe(false);
    expect(text.text()).toContain(payload);
  });

  test('creates new classroom', async () => {
    const wrapper = createWrapper();
    
    const createCard = wrapper.findAll('[data-test="classroom-card"]')
      .filter(card => card.text().includes('Create a class'))
      .at(0);
    
    // Mock window.location
    const locationMock = { search: '' };
    Object.defineProperty(window, 'location', {
      value: locationMock,
      writable: true
    });

    await createCard.trigger('click');
    
    // Wait for the async operations to complete
    await new Promise(resolve => setTimeout(resolve, 100));
    
    expect(wrapper.vm.database.put).toHaveBeenCalled();
    expect(locationMock.search).toContain('classroom/test-hash');
  });

  test('handles classroom deletion', async () => {
    const wrapper = createWrapper();
    wrapper.vm.deleteClass('class-1');
    expect(wrapper.vm.database.drop).toHaveBeenCalledWith('class-1');
  });

  test('handles classroom forking', async () => {
    const wrapper = createWrapper();
    
    // Mock window.location
    const locationMock = { search: '' };
    Object.defineProperty(window, 'location', {
      value: locationMock,
      writable: true
    });

    // Call the method and wait for completion
    await wrapper.vm.forkClass(mockClassrooms[1]);
    
    expect(wrapper.vm.database.put).toHaveBeenCalled();
    expect(locationMock.search).toContain('classroom/test-hash');
  });

  test('displays correct user role for classrooms', async () => {
    const wrapper = createWrapper();
    
    await wrapper.setData({
      classrooms: mockClassrooms
    });
    
    const cards = wrapper.findAll('[data-test="classroom-card"]');
    expect(cards).toHaveLength(mockClassrooms.length + 1);
    
    const subtitles = wrapper.findAll('.v-card-subtitle');
    expect(subtitles[0].text()).toContain('You own this class');
    expect(subtitles[1].text()).toContain('You\'re a student here');
  });

  test('lists every classroom when some have a legacy or unhashable createdBy', async () => {
    const wrapper = createWrapper();
    vi.mocked(hashPubKey).mockImplementation(async (key: string) => {
      if (key === 'broken-key') throw new Error('atob failed');
      return 'testhash1234';
    });

    const rooms = [
      { id: 'legacy', data: { name: 'Legacy', createdBy: 'legacy-id', members: { teacher: [], student: [] } }, hash: null },
      { id: 'broken', data: { name: 'Broken', createdBy: 'broken-key', members: { teacher: [], student: [] } }, hash: null },
      { id: 'owned', data: { name: 'Owned', createdBy: 'test-user', members: { teacher: [], student: [] } }, hash: null },
    ];
    const onRooms = setObservableSpy.mock.calls.at(-1)![1];
    await onRooms(rooms);
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.classrooms.map((c: any) => c.id)).toEqual(['legacy', 'broken', 'owned']);
    expect(hashPubKey).not.toHaveBeenCalledWith('legacy-id');
    expect(wrapper.vm.classrooms.map((c: any) => c.ownerHash)).toEqual([undefined, undefined, 'testhash1234']);

    const links = wrapper.findAll('a[data-link="true"]').map(a => a.attributes('href'));
    expect(links).toContain('./?/classroom/legacy');
    expect(links).toContain('./?/classroom/owned/testhash1234');
    expect(links.some(l => l?.includes('undefined'))).toBe(false);
  });

  test('copies user ID to clipboard', async () => {
    const wrapper = createWrapper();
    wrapper.vm.copyPeerID();
    expect(vi.mocked(copyToClipboard)).toHaveBeenCalledWith('test-user');
  });
});
