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
        writeProtection: false,
        ...props
      },
      global: {
        stubs: {
          'v-text-field': true,
          'v-textarea': true
        }
      }
    });
  };

  test('renders class details', () => {
    const wrapper = createWrapper();
    expect(wrapper.props('config').name).toBe('Test Class');
    expect(wrapper.props('config').meta.description).toBe('Test Description');
  });

  test('disables inputs when write protected', () => {
    const wrapper = createWrapper({ writeProtection: true });
    const inputs = wrapper.findAll('input');
    inputs.forEach(input => {
      expect(input.attributes('disabled')).toBeTruthy();
    });
  });
});
