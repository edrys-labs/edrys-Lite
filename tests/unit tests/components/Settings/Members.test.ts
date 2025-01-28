import { describe, test, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import Members from '../../../../src/components/Settings/Members.vue';
import { i18n, messages } from '../../../setup';

describe('Members Settings Component', () => {
  const mockMembers = {
    teacher: ['teacher1', 'teacher2'],
    student: ['student1', 'student2']
  };

  const createWrapper = (props = {}) => {
    return mount(Members, {
      props: {
        members: mockMembers,
        writeProtection: false,
        ...props
      },
      global: {
        stubs: {
          'v-alert': {
            template: '<div class="v-alert"><slot /><slot name="append" /></div>'
          },
          'v-container': true,
          'v-btn': true,
          'v-divider': true,
          'v-textarea': {
            template: '<textarea class="v-textarea" :value="modelValue" :disabled="$attrs.disabled" :label="$attrs.label" @input="$emit(\'update:modelValue\', $event.target.value)"></textarea>',
            props: ['modelValue'],
            inheritAttrs: false
          }
        }
      }
    });
  };

  test('renders members list correctly', () => {
    const wrapper = createWrapper();
    const textarea = wrapper.find('.v-textarea');
    expect((textarea.element as HTMLTextAreaElement).value).toBe('teacher1, teacher2');
  });

  test('emits updateMembers event when teachers list changes', async () => {
    const wrapper = createWrapper();
    const textarea = wrapper.find('.v-textarea');
    
    await textarea.setValue('teacher1, teacher2, teacher3');
    
    expect(wrapper.emitted('updateMembers')).toBeTruthy();
    expect(wrapper.emitted('updateMembers')[0][0]).toEqual({
      teacher: ['teacher1', 'teacher2', 'teacher3'],
      student: ['student1', 'student2']
    });
  });

  test('disables inputs when write protected', () => {
    const wrapper = createWrapper({ writeProtection: true });
    const textarea = wrapper.find('.v-textarea');
    expect((textarea.element as HTMLTextAreaElement).disabled).toBe(true);
  });


  describe('translations', () => {
    test.each(['en', 'de', 'uk', 'ar'])('displays correct translations for %s locale', (locale) => {
      i18n.global.locale.value = locale as 'en' | 'de' | 'uk' | 'ar';
      const wrapper = createWrapper();
      
      const translations = messages[locale].settings.members;

      const alerts = wrapper.findAll('.v-alert');
      const inputs = wrapper.findAll('.v-textarea');

      const alertText = alerts.find(alert => alert.attributes('text')  === translations.info);
      expect(alertText).toBeTruthy();

      const teacherIdsInput = inputs.find(input => input.attributes('label') === translations.teacherIds);
      expect(teacherIdsInput).toBeTruthy();

      const studentsIdsInput = inputs.find(input => input.attributes('label') === translations.studentIds);
      expect(studentsIdsInput).toBeTruthy();
    });
  });
});
