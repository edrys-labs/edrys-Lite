import { describe, test, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import UserMenu from '../../../src/components/UserMenu.vue';
import { copyToClipboard } from '../../../src/ts/Utils';

// Mock Utils
vi.mock('../../../src/ts/Utils', () => ({
  getPeerID: vi.fn(() => 'test-user'),
  getDisplayPeerID: vi.fn(() => 'test-user'),
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
          'v-tooltip': {
            template: `<div class="v-tooltip"><slot name="activator" :props="{}" /></div>`
          },
          'v-btn': {
            template: `
              <button
                class="v-btn"
                :data-icon="$attrs.icon"
                :data-value="$attrs.value"
                @click="$emit('click', $event)"
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
        }
      }
    });
  };

  test('renders correctly', () => {
    const wrapper = createWrapper();
    expect(wrapper.find('.v-menu').exists()).toBe(true);
    expect(wrapper.find('.user-menu').exists()).toBe(true);
  });

  test('displays user ID', () => {
    const wrapper = createWrapper();
    expect(wrapper.text()).toContain('test-user');
  });

  test('copies peer ID to clipboard', async () => {
    const wrapper = createWrapper();
    const copyButton = wrapper.find('button[data-icon="mdi-content-copy"]');
    
    await copyButton.trigger('click');
    expect(copyToClipboard).toHaveBeenCalledWith('test-user');
  });

  test('changes locale', async () => {
    const wrapper = createWrapper();
    const select = wrapper.find('#user-menu-language');

    await select.setValue('de');
    expect(wrapper.vm.locale).toBe('de');
    expect(localStorage.getItem('locale')).toBe('de');
  });

  test('switches and saves the theme', async () => {
    const wrapper = createWrapper();

    await wrapper.find('input[type="radio"][value="dark"]').setValue();
    expect(wrapper.vm.themePreference).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  test('marks the chosen theme', () => {
    const wrapper = createWrapper();
    const checked = wrapper.findAll('input[type="radio"]').filter((r) => (r.element as HTMLInputElement).checked);
    expect(checked.map((r) => r.attributes('value'))).toEqual([wrapper.vm.themePreference]);
  });

  test('shows the role section only when given one', () => {
    expect(createWrapper().find('.value').exists()).toBe(false);
    const withRole = mount(UserMenu, {
      slots: { 'user-role': 'Teacher' },
      global: { stubs: { 'v-menu': { template: '<div><slot /></div>' } } },
    });
    expect(withRole.find('.value').text()).toBe('Teacher');
  });

  test('offers every supported language', () => {
    const wrapper = createWrapper();
    const options = wrapper.find('#user-menu-language').findAll('option').map((o) => o.text());
    expect(options.sort()).toEqual(['Deutsch', 'English', 'Español', 'Українська', 'العربية'].sort());
  });
});
