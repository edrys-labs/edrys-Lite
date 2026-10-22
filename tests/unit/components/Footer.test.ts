import { describe, test, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Footer from '../../../src/components/Footer.vue';

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
    expect(wrapper.findAll('.v-btn')).toHaveLength(4);
  });

  test('has correct GitHub link', () => {
    const githubBtn = wrapper.findAll('.v-btn')[0];
    expect(githubBtn.attributes('href')).toBe('https://github.com/edrys-labs/edrys-Lite/');
    expect(githubBtn.attributes('icon')).toBe('mdi-github');
  });

  test('has correct Documentation link', () => {
    const docsBtn = wrapper.findAll('.v-btn')[1];
    expect(docsBtn.attributes('href')).toBe('https://LiaScript.github.io/course/?https://raw.githubusercontent.com/edrys-labs/documentation/refs/heads/main/README.md');
    expect(docsBtn.attributes('icon')).toBe('mdi-information');
  });

  test('has correct Classrooms link', () => {
    const classroomsBtn = wrapper.findAll('.v-btn')[2];
    expect(classroomsBtn.attributes('href')).toBe('https://github.com/topics/edrys-lab');
    expect(classroomsBtn.attributes('icon')).toBe('mdi-share-circle');
  });

  test('has correct Blog link', () => {
    const classroomsBtn = wrapper.findAll('.v-btn')[3];
    expect(classroomsBtn.attributes('href')).toBe('https://edrys-labs.github.io/blog');
    expect(classroomsBtn.attributes('icon')).toBe('mdi-rss-box');
  });

  test('all buttons open in new tab', () => {
    const buttons = wrapper.findAll('.v-btn');
    buttons.forEach(btn => {
      expect(btn.attributes('target')).toBe('_blank');
    });
  });
});
