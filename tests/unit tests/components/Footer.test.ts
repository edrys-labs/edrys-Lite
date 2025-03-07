import { describe, test, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Footer from '../../../src/components/Footer.vue';
import { i18n, messages } from '../../setup';

// Create stub components with templates to render content
const stubs = {
  'v-footer': {
    template: '<div class="v-footer" v-bind="$attrs"><slot /></div>',
  },
  'v-row': {
    template: '<div class="v-row" v-bind="$attrs"><slot /></div>',
  },
  'v-tooltip': {
    template: '<div class="v-tooltip" v-bind="$attrs" :text="$attrs.text"><slot name="activator" :props="{}" /></div>',
  },
  'v-btn': {
    template: '<button class="v-btn" v-bind="$attrs"><slot /></button>',
  },
};

describe('Footer Component', () => {
  let wrapper: any;

  beforeEach(() => {
    wrapper = mount(Footer, {
      global: {
        stubs,
      },
    });
  });

  test('renders correctly', () => {
    expect(wrapper.find('.v-footer').exists()).toBe(true);
    expect(wrapper.findAll('.v-btn')).toHaveLength(3);
  });

  test('has correct GitHub link', () => {
    const githubBtn = wrapper.findAll('.v-btn')[0];
    expect(githubBtn.attributes('href')).toBe('https://github.com/edrys-labs/edrys-Lite/');
    expect(githubBtn.attributes('icon')).toBe('mdi-github');
  });

  test('has correct Documentation link', () => {
    const docsBtn = wrapper.findAll('.v-btn')[1];
    expect(docsBtn.attributes('href')).toBe('https://github.com/edrys-labs/documentation');
    expect(docsBtn.attributes('icon')).toBe('mdi-information');
  });

  test('has correct Classrooms link', () => {
    const classroomsBtn = wrapper.findAll('.v-btn')[2];
    expect(classroomsBtn.attributes('href')).toBe('https://github.com/topics/edrys-lab');
    expect(classroomsBtn.attributes('icon')).toBe('mdi-share-circle');
  });

  test('all buttons open in new tab', () => {
    const buttons = wrapper.findAll('.v-btn');
    buttons.forEach(btn => {
      expect(btn.attributes('target')).toBe('_');
    });
  });

  test('buttons have correct density', () => {
    const buttons = wrapper.findAll('.v-btn');
    buttons.forEach(btn => {
      expect(btn.attributes('density')).toBe('compact');
    });
  });

  test('footer has correct styling', () => {
    const footer = wrapper.find('.v-footer');
    expect(footer.attributes('color')).toBe('surface-variant');
    expect(footer.attributes('elevation')).toBe('15');
    expect(footer.attributes('app')).toBe('true');
  });

  test('row has correct layout properties', () => {
    const row = wrapper.find('.v-row');
    expect(row.attributes('justify')).toBe('center');
    expect(row.attributes('no-gutters')).toBe('');
  });

  describe('translations', () => {
    test.each(['en', 'de', 'uk', 'ar', 'es'])('displays correct translations for %s locale', async (locale) => {
      i18n.global.locale.value = locale as 'en' | 'de' | 'uk' | 'ar' | 'es';
      await wrapper.vm.$nextTick();

      const translations = messages[locale].footer;

      const tooltips = wrapper.findAll('.v-tooltip');

      // Check GitHub button tooltip
      expect(tooltips[0].attributes('text')).toBe(translations.github);

      // Check Docs button tooltip
      expect(tooltips[1].attributes('text')).toBe(translations.docs);

      // Check Explore button tooltip
      expect(tooltips[2].attributes('text')).toBe(translations.explore);
    });
  });
});
