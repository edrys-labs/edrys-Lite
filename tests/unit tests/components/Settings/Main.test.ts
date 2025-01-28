import { describe, test, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import Main from '../../../../src/components/Settings/Main.vue';
import { i18n, messages } from '../../../setup';

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

  test('disables inputs when write protected', () => {
    const wrapper = createWrapper({ writeProtection: true });
    const inputs = wrapper.findAll('v-input');
    inputs.forEach(input => {
      expect(input.attributes('disabled')).toBeTruthy();
    });
  });

  describe('translations', () => {
    test.each(['en', 'de', 'uk', 'ar'])('displays correct translations for %s locale', (locale) => {
      i18n.global.locale.value = locale as 'en' | 'de' | 'uk' | 'ar';
      const wrapper = createWrapper();
      
      const translations = messages[locale];

      // Get all elements with their labels
      const elements = wrapper.findAll('[label]');
      
      // Verify each translation exists as a label
      const expectedLabels = [
        translations.settings.main.className,
        translations.settings.main.logoUrl,
        translations.settings.main.description,
        translations.settings.main.roomsNum,
        translations.settings.main.selfAssign,
      ];

      expectedLabels.forEach(label => {
        const element = elements.find(el => el.attributes('label') === label);
        expect(element, `Element with label "${label}" should exist`).toBeTruthy();
      });
    });
  });
});
