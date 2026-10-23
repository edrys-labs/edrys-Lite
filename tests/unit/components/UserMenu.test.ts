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
          'v-tooltip': {
            template: `<div class="v-tooltip"><slot name="activator" :props="{}" /></div>`
          },
          'v-btn': {
            template: `
              <button 
                class="v-btn" 
                :data-icon="$attrs.icon"
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
    const copyButton = wrapper.find('button[data-icon="mdi-content-copy"]');
    
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

  test('offers every supported language', () => {
    const wrapper = createWrapper();
    const options = wrapper.find('.v-select').findAll('option').map((o) => o.text());
    expect(options.sort()).toEqual(['Deutsch', 'English', 'Español', 'Українська', 'العربية'].sort());
  });
});
