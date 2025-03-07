import { describe, test, expect, vi } from 'vitest';
import { copyToClipboard } from '../../../src/ts/Utils';
import { mount } from '@vue/test-utils';
import Index from '../../../src/views/Index.vue';
import { i18n, messages } from '../../setup';

// Mock dependencies
const setObservableSpy = vi.fn();

vi.mock('../../../src/ts/Database', () => ({
  Database: vi.fn().mockImplementation(() => ({
    setObservable: setObservableSpy.mockImplementation((query, callback) => {
      callback(mockClassrooms);
    }),
    put: vi.fn(),
    drop: vi.fn(),
    setProtection: vi.fn()
  }))
}));

vi.mock('../../../src/ts/Utils', () => ({
  infoHash: vi.fn(() => 'test-hash'),
  getPeerID: vi.fn(() => 'test-user'),
  clone: vi.fn(obj => JSON.parse(JSON.stringify(obj))),
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
    
    expect(wrapper.vm.database.put).toHaveBeenCalled();
    expect(locationMock.search).toContain('classroom/test-hash');
  });

  test('handles classroom deletion', async () => {
    const wrapper = createWrapper();
    wrapper.vm.deleteClass('class-1');
    expect(wrapper.vm.database.drop).toHaveBeenCalledWith('class-1');
  });

  test('toggles write protection', async () => {
    const wrapper = createWrapper();
    wrapper.vm.switchClassroomProtection('class-1', true);
    expect(wrapper.vm.database.setProtection).toHaveBeenCalledWith('class-1', true);
  });

  test('handles classroom forking', async () => {
    const wrapper = createWrapper();
    
    // Mock window.location
    const locationMock = { search: '' };
    Object.defineProperty(window, 'location', {
      value: locationMock,
      writable: true
    });

    wrapper.vm.forkClass(mockClassrooms[1]);
    
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

  test('copies user ID to clipboard', async () => {
    const wrapper = createWrapper();
    wrapper.vm.copyPeerID();
    expect(vi.mocked(copyToClipboard)).toHaveBeenCalledWith('test-user');
  });

  describe('translations', () => {
    test.each(['en', 'de', 'uk', 'ar', 'es'])('displays correct translations for %s locale', async (locale) => {
      i18n.global.locale.value = locale as 'en' | 'de' | 'uk' | 'ar' | 'es';
      const translations = messages[locale].index.classroom;
      
      const wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      
      // Set up classroom data
      await wrapper.setData({
        classrooms: mockClassrooms
      });
      await wrapper.vm.$nextTick();

      // Check create classroom card
      const createCard = wrapper.findAll('[data-test="classroom-card"]')
        .filter(card => card.text().includes(translations.create))
        .at(0);
      
      expect(createCard.exists()).toBe(true);
      expect(createCard.text()).toContain(translations.startTeaching);

      // Check classroom cards
      const cards = wrapper.findAll('[data-test="classroom-card"]');
      const firstCard = cards[0];
      
      // Check write protection text
      const writeProtectionChip = firstCard.find('.v-chip');
      expect(writeProtectionChip.text()).toContain(translations.writeProtection);
      
      // Check ownership texts
      const cardSubtitle = firstCard.find('.v-card-subtitle');
      expect(cardSubtitle.text()).toContain(translations.ownership.owner);
      console.log('wrapperr', wrapper.html())
      // Check action buttons
      expect(firstCard.find('[title="' + translations.actions.fork + '"]').exists()).toBe(true);

      // Check action buttons and delete dialog
      const deleteBtn = firstCard.find('button[icon="mdi-delete"]');
      expect(deleteBtn.exists()).toBe(true);
      
      // Delete dialog should be visible in the menu content
      const deleteDialog = wrapper.find('.v-menu-content .v-list-item');
      expect(deleteDialog.text()).toContain(translations.actions.deleteConfirm);
      
      const deleteButton = wrapper.find('button.v-btn.red');
      expect(deleteButton.exists()).toBe(true);
      expect(deleteButton.text()).toContain(translations.actions.deleteForever);
    });
  });
});
