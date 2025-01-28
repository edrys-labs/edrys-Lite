import { describe, test, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Settings from '../../../src/components/Settings.vue';
import { i18n, messages } from '../../setup';

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
        writeProtection: false,
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
    const tabs = wrapper.findAll('.v-tab');
    expect(tabs).toHaveLength(5);
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

  test('shows write protection status', () => {
    const wrapper = createWrapper({ writeProtection: true });
    const protectionStatus = wrapper.find('.text-medium-emphasis');
    expect(protectionStatus.text()).toContain('Write Protection: ON');
  });

  describe('translations', async () => {
    test.each(['en', 'de', 'uk', 'ar'])('displays correct translations for %s locale', async (locale) => {
      i18n.global.locale.value = locale as 'en' | 'de' | 'uk' | 'ar';
      const wrapper = createWrapper();
      
      const translations = messages[locale].settings.general;

      // Check toolbar title
      const toolbarTitle = wrapper.find('.v-toolbar-title');
      expect(toolbarTitle.text()).toBe(translations.title);

      // Check write protection status
      const protectionStatus = wrapper.find('.text-medium-emphasis');
      await wrapper.setProps({ writeProtection: true });
      expect(protectionStatus.text()).toContain(translations.writeProtection);
      expect(protectionStatus.text()).toContain(translations.actions.on);

      // Check tab titles
      const tabTitles = [
        translations.Main,
        translations.Members,
        translations.Modules,
        translations.Stations,
        translations.Share
      ];
      const tabs = wrapper.findAll('.v-tab');
      tabTitles.forEach((title, index) => {
        expect(tabs[index].text()).toContain(title);
      });

      // Check save button text
      const saveButton = wrapper.findAll('.v-btn').find(btn => btn.text().includes(translations.actions.save));
      expect(saveButton).toBeTruthy();

      // Check delete button text
      const deleteButton = wrapper.findAll('.v-btn').find(btn => btn.text().includes(translations.actions.delete));
      expect(deleteButton).toBeTruthy();

      // Check delete confirmation text
      const deleteConfirm = wrapper.findAll('.v-list-item-title').find(el => el.text().includes(translations.actions.deleteConfirm));
      expect(deleteConfirm).toBeTruthy();

      // Check delete forever button text
      const deleteForever = wrapper.findAll('.v-btn').find(btn => btn.text().includes(translations.actions.deleteForever));
      expect(deleteForever).toBeTruthy();
    });
  });
});
