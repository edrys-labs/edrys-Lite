import { describe, test, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import UserMenu from '../../../src/components/UserMenu.vue';
import { copyToClipboard, getPeerID } from '../../../src/ts/Utils';
import { i18n, messages } from '../../setup';

// Mock Utils
vi.mock('../../../src/ts/Utils', () => ({
  getPeerID: vi.fn(() => 'test-user'),
  copyToClipboard: vi.fn()
}));

describe('UserMenu Component', () => {
  const createWrapper = () => {
    return mount(UserMenu, {
      global: {
        stubs: {
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
          'v-list-item-title': {
            template: '<div class="v-list-item-title"><slot /></div>'
          },
          'v-list-item-subtitle': {
            template: '<div class="v-list-item-subtitle"><slot /></div>'
          },
          'v-btn': {
            template: `
              <button 
                class="v-btn" 
                :icon="$attrs.icon"
                @click="$emit('click')"
              >
                <i v-if="$attrs.icon" :class="$attrs.icon"></i>
                <slot />
              </button>
            `
          },
          'v-icon': {
            template: '<i :class="$attrs.icon"><slot /></i>'
          },
          'v-divider': {
            template: '<hr class="v-divider" />'
          },
          'v-select': {
            template: `
              <select 
                class="v-select" 
                :value="modelValue"
                @change="$emit('update:model-value', $event.target.value)"
              >
                <option 
                  v-for="item in items" 
                  :key="item.value" 
                  :value="item.value"
                >
                  {{ item.title }}
                </option>
              </select>
            `,
            props: ['modelValue', 'items']
          }
        }
      }
    });
  };

  test('renders correctly', () => {
    const wrapper = createWrapper();
    expect(wrapper.find('.v-menu').exists()).toBe(true);
    expect(wrapper.find('.v-list').exists()).toBe(true);
  });

  test('displays user ID', () => {
    const wrapper = createWrapper();
    expect(wrapper.text()).toContain('test-user');
  });

  test('copies peer ID to clipboard', async () => {
    const wrapper = createWrapper();
    const copyButton = wrapper.find('button[icon="mdi-content-copy"]');
    
    await copyButton.trigger('click');
    expect(copyToClipboard).toHaveBeenCalledWith('test-user');
  });

  test('changes locale', async () => {
    const wrapper = createWrapper();
    const select = wrapper.find('.v-select');
    
    await select.setValue('de');
    expect(wrapper.vm.locale).toBe('de');
    expect(localStorage.getItem('locale')).toBe('de');
  });

  describe('translations', () => {
    test.each(['en', 'de', 'uk', 'ar', 'es'])('displays correct translations for %s locale', async (locale) => {
      i18n.global.locale.value = locale as 'en' | 'de' | 'uk' | 'ar' | 'es';
      const translations = messages[locale].general;
      
      const wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      // Check translations
      expect(wrapper.find('.v-list-item-title').text()).toContain(translations.userId);
      expect(wrapper.findAll('.v-list-item-title')[1].text()).toContain(translations.language);

      // Check language options exist
      const select = wrapper.find('.v-select');
      const options = select.findAll('option');
      expect(options.length).toBe(5); // en, de, uk, ar, es

      // Test each language option exists
      const languageOptions = [
        { title: 'English', value: 'en' },
        { title: 'Deutsch', value: 'de' },
        { title: 'Українська', value: 'uk' },
        { title: 'العربية', value: 'ar' },
        { title: 'Español', value: 'es' }
      ];

      languageOptions.forEach(lang => {
        const option = options.find(o => o.text() === lang.title);
        expect(option).toBeTruthy();
      });
    });
  });
});
