import { describe, test, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Settings from '../../../src/components/Settings.vue';

describe('Settings Component', () => {
  const mockConfig = {
    name: 'Test Class',
    description: 'Test Description',
    members: ['user1', 'user2'],
    modules: [],
    stations: []
  };

  const mockScrapedModules = {
    module1: { name: 'Module 1' },
    module2: { name: 'Module 2' }
  };

  const createWrapper = (props = {}) => {
    return mount(Settings, {
      props: {
        config: mockConfig,
        scrapedModules: mockScrapedModules,
        ...props
      },
      global: {
        stubs: {
          'v-card': {
            template: '<div class="v-card"><slot /><slot name="extension" /></div>'
          },
          'v-toolbar': {
            template: '<div class="v-toolbar"><slot /><slot name="extension" /></div>'
          },
          'v-toolbar-title': {
            template: '<div class="v-toolbar-title"><slot /></div>'
          },
          'v-tabs': {
            template: '<div class="v-tabs"><slot /></div>'
          },
          'v-tab': {
            template: '<div class="v-tab" data-test="tab"><slot /></div>'
          },
          'v-spacer': true,
          'v-window': {
            template: '<div class="v-window"><slot /></div>'
          },
          'v-window-item': true,
          'v-card-text': true,
          'v-card-actions': {
            template: '<div class="v-card-actions"><slot /></div>'
          },
          'v-btn': {
            template: '<button class="v-btn" @click="$emit(\'click\')"><slot /></button>'
          },
          'v-icon': true,
          'v-menu': {
            template: '<div class="v-menu"><slot /><slot name="activator" /></div>'
          },
          'v-list': {
            template: '<div class="v-list"><slot /></div>'
          },
          'v-list-item': {
            template: '<div class="v-list-item"><slot /></div>'
          },
          'v-badge': true
        }
      }
    });
  };

  test('renders all tabs', () => {
    const wrapper = createWrapper();
    const tabs = wrapper.findAll('.v-tab').map((tab) => tab.text());
    expect(tabs).toEqual(['Main', 'Members', 'Modules', 'Stations', 'Design', 'Import / Export', 'Communication']);
  });

  test('emits close event', async () => {
    const wrapper = createWrapper();
    await wrapper.find('.v-btn').trigger('click');
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  test('handles config changes', async () => {
    const wrapper = createWrapper();
    await wrapper.setProps({
      config: { ...mockConfig, name: 'Updated Name' }
    });
    expect(wrapper.vm.configChanged).toBe(true);
  });

  test('saves class changes', () => {
    const wrapper = createWrapper();
    wrapper.vm.saveClass();
    expect(wrapper.emitted('saveClass')).toBeTruthy();
    expect(wrapper.vm.configChanged).toBe(false);
  });

  test('takes over meta the save adjusted, so nothing shows as unsaved', async () => {
    const config = { ...mockConfig, meta: { defaultNumberOfRooms: 1, roomNames: { 'Room 2': 'Old' } } };
    const wrapper = createWrapper({
      config,
      onSaveClass: (saved: any) => {
        saved.meta = { defaultNumberOfRooms: 1 };
      },
    });

    wrapper.vm.saveClass();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.configClone.meta).toEqual({ defaultNumberOfRooms: 1 });
    expect(wrapper.vm.configChanged).toBe(false);
  });


  test('reports the design picked in the dialog so the classroom can show it before saving', async () => {
    const wrapper = createWrapper({ config: { ...mockConfig, meta: { design: 'standard' } } });
    expect(wrapper.emitted('previewDesign')?.[0]).toEqual([{ design: 'standard', custom: undefined }]);

    (wrapper.vm as any).$data.configClone.meta.design = 'other';
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('previewDesign')?.at(-1)).toEqual([{ design: 'other', custom: undefined }]);
  });

  test("reports changes inside the class's own design too", async () => {
    const customDesign = { light: { colors: { primary: '#112233' } } };
    const wrapper = createWrapper({ config: { ...mockConfig, meta: { design: 'custom', customDesign } } });
    (wrapper.vm as any).$data.configClone.meta.customDesign.light.colors.primary = '#445566';
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('previewDesign')?.at(-1)).toEqual([
      { design: 'custom', custom: { light: { colors: { primary: '#445566' } } } },
    ]);
  });
});
