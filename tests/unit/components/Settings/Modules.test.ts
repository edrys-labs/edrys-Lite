import { describe, test, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Modules from '../../../../src/components/Settings/Modules.vue';
import { roomTile } from '../../../../src/ts/Theme';

describe('Modules Settings Component', () => {
  let mockConfig;
  let mockScrapedModules;

  beforeEach(() => {
    // Reset mock data before each test
    mockConfig = {
      modules: [
        {
          url: 'https://example.com/module1',
          config: '',
          showInCustom: '*'
        },
        {
          url: 'https://example.com/module2',
          config: '',
          showInCustom: 'lobby'
        }
      ]
    };

    mockScrapedModules = [
      { name: 'Module 1', description: 'Test description 1', icon: 'mdi-test' },
      { name: 'Module 2', description: 'Test description 2' }
    ];
  });

  const createWrapper = (props = {}) => {
    return mount(Modules, {
      props: {
        config: mockConfig,
        scrapedModules: mockScrapedModules,
        ...props
      },
      global: {
        stubs: {
          'v-list': {
            template: '<div class="v-list"><slot /></div>'
          },
          'v-list-item': {
            template: '<div class="v-list-item" data-test="module-item"><slot /><slot name="prepend" /><slot name="append" /></div>'
            
          },
          'v-list-item-title': {
            template: '<div class="v-list-item-title"><slot /></div>'
          },
          'v-list-item-subtitle': {
            template: '<div class="v-list-item-subtitle"><slot /></div>'
          },
          'v-btn': {
            template: '<button :class="[$attrs.color, $attrs.icon]" :disabled="$attrs.disabled"><slot /></button>',
            inheritAttrs: false
          },
          'v-icon': {
            template: '<span class="v-icon"><slot /></span>'
          },
          'v-menu': {
            template: `
              <div class="v-menu">
                <div class="v-menu__activator">
                  <slot name="activator" :props="{ isActive: true }" />
                </div>
                <div class="v-menu__content">
                  <slot />
                </div>
              </div>
            `,
            inheritAttrs: false
          },
          'v-chip': true,
          'v-text-field': {
            template: '<input type="text" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
            props: ['modelValue']
          },
          'v-divider': true,
          draggable: {
            template: '<div class="draggable-container"><slot name="item" v-for="(item, index) in list" :key="index" :element="item" :index="index" /></div>',
            props: ['list']
          },
          Module: true
        }
      }
    });
  };

  // Mock the scrapeModule function
  vi.mock('../../../../src/ts/Utils', async (importOriginal) => ({
    roomSlot: (await importOriginal()).roomSlot,
    scrapeModule: vi.fn().mockResolvedValue({ name: 'New Module', description: 'New Description' }),
    validateUrl: vi.fn().mockReturnValue(true),
    parse: vi.fn().mockReturnValue({}),
  }));

  test('renders module list', () => {
    const wrapper = createWrapper();
    const moduleItems = wrapper.findAll('.list-group-item');
    expect(moduleItems).toHaveLength(mockConfig.modules.length);
  });

  test("renders only text and web links from a module's description", () => {
    mockScrapedModules[0].description =
      'See <img src=x onerror=alert(1)><br/><a href="https://example.com/m" onclick="alert(1)">docs</a>';
    const wrapper = createWrapper();

    const subtitle = wrapper.find('.module-description');
    expect(subtitle.find('img').exists()).toBe(false);
    const link = subtitle.find('a');
    expect(link.attributes()).toEqual({
      href: 'https://example.com/m',
      target: '_blank',
      rel: 'noopener noreferrer',
    });
    expect(subtitle.text()).toBe('See \ndocs');
  });

  test('handles module deletion', async () => {
    const wrapper = createWrapper();
    wrapper.vm.deleteModule(0);
    expect(wrapper.vm.config.modules).toHaveLength(1);
    expect(wrapper.vm.errors).toHaveLength(1);
    expect(wrapper.vm.localScrapedModules).toHaveLength(1);
  });

  test('handles module addition', async () => {
    const wrapper = createWrapper();
    wrapper.vm.moduleImportUrl = 'https://example.com/new-module';
    await wrapper.vm.loadURL();
    expect(wrapper.vm.config.modules).toHaveLength(3);
    expect(wrapper.vm.moduleImportUrl).toBe('');
  });

  test("colors a group's dots like the drawer's rooms", () => {
    const wrapper = createWrapper({ rooms: ['Lobby', 'Room 1', 'Room 2'] });
    const dots = (showIn) => wrapper.vm.groupDots(showIn);

    expect(dots('Room 2')).toEqual([{ key: 'Room 2', color: roomTile(1, 'light').dot }]);
    expect(dots('room 1, Room 2').map((d) => d.key)).toEqual(['Room 1', 'Room 2']);
    // all rooms and rooms not created yet share one hollow ring
    expect(dots('*')).toEqual([{ key: 'other', color: null }]);
    expect(dots('Room 9')).toEqual([{ key: 'other', color: null }]);
    // "station" with no station online
    expect(dots('station, station-only')).toEqual([{ key: 'other', color: null }]);
  });

  test('"station" gets a dot per online station, role values none', () => {
    const rooms = ['Lobby', 'Room 1', 'Station A', 'Station B'];
    const wrapper = createWrapper({ rooms });

    expect(wrapper.vm.groupDots('station, station-only')).toEqual([
      { key: 'Station A', color: roomTile(1, 'light').dot },
      { key: 'Station B', color: roomTile(2, 'light').dot },
    ]);
    expect(wrapper.vm.groupDots('Room 1, teacher-only').map((d) => d.key)).toEqual(['Room 1']);
  });

  test('validates module configuration', () => {
    const wrapper = createWrapper();
    expect(wrapper.vm.validate_config(0)).toBe(true);
    wrapper.vm.errors[0].config = 'error';
    expect(wrapper.vm.validate_config(0)).toBe(false);
  });

});
