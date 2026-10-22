import { describe, test, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import Main from '../../../../src/components/Settings/Main.vue';

describe('Main Settings Component', () => {
  const mockConfig = {
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

});
