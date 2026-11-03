import { describe, test, expect, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import SectionHead from '../../../../src/components/Settings/SectionHead.vue';
import { activeTheme, roomTile } from '../../../../src/ts/Theme';

// jsdom keeps hex colors as rgb()
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
};

describe('SectionHead', () => {
  const mountHead = (props = {}) =>
    mount(SectionHead, {
      props: { title: 'Teachers', text: 'Can change the class.', icon: 'mdi-school-outline', color: 3, ...props },
      global: { stubs: { 'v-icon': { props: ['icon'], template: '<i :data-icon="icon"></i>' } } },
    });

  afterEach(() => {
    activeTheme.value = 'light';
  });

  test('shows the title, the text and the icon', () => {
    const wrapper = mountHead();
    expect(wrapper.find('h3').text()).toBe('Teachers');
    expect(wrapper.find('p').text()).toBe('Can change the class.');
    expect(wrapper.find('[data-icon]').attributes('data-icon')).toBe('mdi-school-outline');
  });

  test('leaves out the text line when there is none', () => {
    const wrapper = mountHead({ text: '' });
    expect(wrapper.find('p').exists()).toBe(false);
  });

  test('the icon tile takes the room color of its slot, per theme', async () => {
    const wrapper = mountHead();
    const style = () => wrapper.find('.section-icon').attributes('style');
    expect(style()).toContain(rgb(roomTile(3, 'light').bg));

    activeTheme.value = 'dark';
    await wrapper.vm.$nextTick();
    expect(style()).toContain(rgb(roomTile(3, 'dark').bg));
    expect(style()).toContain(rgb(roomTile(3, 'dark').fg));
  });
});
