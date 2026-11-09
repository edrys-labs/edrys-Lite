import { beforeEach, describe, expect, test, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import UserMenu from '../../../src/components/UserMenu.vue';
import { loadUsername, saveUsername } from '../../../src/ts/UserNames';

vi.mock('../../../src/ts/Utils', () => ({
  getPeerID: vi.fn(() => 'me'),
  getDisplayPeerID: vi.fn(() => 'me'),
  copyToClipboard: vi.fn(),
}));

const mountMenu = (props = {}) =>
  mount(UserMenu, {
    props,
    global: {
      stubs: {
        'v-menu': { template: '<div><slot /></div>' },
        'v-tooltip': true,
        'v-btn': true,
        'v-icon': true,
      },
    },
  });

describe('UserMenu display name', () => {
  beforeEach(() => localStorage.clear());

  test('shows the saved name', () => {
    saveUsername('Ada');
    const input = mountMenu().find('#user-menu-username').element as HTMLInputElement;
    expect(input.value).toBe('Ada');
  });

  test('saves a cleaned name and reports it', async () => {
    const wrapper = mountMenu();
    const input = wrapper.find('#user-menu-username');
    await input.setValue('  Ada ');

    expect(loadUsername()).toBe('Ada');
    expect((input.element as HTMLInputElement).value).toBe('Ada');
    expect(wrapper.emitted('username-change')).toEqual([['Ada']]);
  });

  test('clearing the field forgets the name', async () => {
    saveUsername('Ada');
    const input = mountMenu().find('#user-menu-username');
    await input.setValue('');

    expect(loadUsername()).toBe('');
    expect(localStorage.getItem('username_me')).toBeNull();
  });

  test('a station has no name field', () => {
    expect(mountMenu({ nameEditable: false }).find('#user-menu-username').exists()).toBe(false);
  });
});
