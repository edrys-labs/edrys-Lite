import { describe, test, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import Main from '../../../../src/components/Settings/Main.vue';

describe('Main Settings Component', () => {
  const mockConfig = {
    id: 'class-1',
    name: 'Test Class',
    meta: {
        logo: 'https://example.com/logo.png',
        description: 'Test Description',
    }
  };

  const createWrapper = (props = {}) => {
    return mount(Main, {
      props: {
        config: mockConfig,
        ...props
      },
      global: {
        stubs: {
          'v-text-field': {
            template: '<input type="text" :label="$attrs.label" v-model="value" :disabled="$attrs.disabled" />',
            props: ['value'],
            inheritAttrs: false
          },
          'v-textarea': {
            template: '<textarea :label="$attrs.label" v-model="value" :disabled="$attrs.disabled" />',
            props: ['value'],
            inheritAttrs: false
          },
          'v-checkbox': {
            template: '<input type="checkbox" :label="$attrs.label" v-model="value" />',
            props: ['value'],
            inheritAttrs: false
          },
        }
      }
    });
  };

  test('renders class details', () => {
    const wrapper = createWrapper();
    expect(wrapper.props('config').name).toBe('Test Class');
    expect(wrapper.props('config').meta.description).toBe('Test Description');
  });

  test('the preview shows the name, the description and the class picture without a logo', () => {
    const wrapper = createWrapper({
      config: { id: 'class-1', name: 'Linux Basics', meta: { description: 'One room per group.' } },
    });
    expect(wrapper.find('.preview-name').text()).toBe('Linux Basics');
    expect(wrapper.find('.preview-description').text()).toBe('One room per group.');
    expect(wrapper.find('svg.class-art').exists()).toBe(true);
    expect(wrapper.find('img').exists()).toBe(false);
  });

  test('the preview shows the logo, and the class picture once the logo fails', async () => {
    const wrapper = createWrapper();
    const img = wrapper.find('img.preview-banner');
    expect(img.attributes('src')).toBe('https://example.com/logo.png');

    await img.trigger('error');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('svg.class-art').exists()).toBe(true);
  });
});
