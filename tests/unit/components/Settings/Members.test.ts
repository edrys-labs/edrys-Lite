import { describe, test, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Members from '../../../../src/components/Settings/Members.vue';

describe('Members Settings Component', () => {
  const mockMembers = {
    teacher: ['teacher1', 'teacher2'],
    student: ['student1', 'student2']
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createWrapper = (props = {}) => {
    return mount(Members, {
      props: {
        members: mockMembers,
        ...props
      },
      global: {
        stubs: {
          'v-text-field': {
            props: ['modelValue'],
            template: '<div class="v-text-field"><input :value="modelValue" readonly /><slot name="append-inner" /></div>'
          },
          'v-btn': {
            props: ['icon', 'href'],
            template: '<button class="v-btn" :data-icon="icon" :data-href="href" @click="$emit(\'click\')"><slot /></button>'
          },
          'v-divider': true,
          'v-textarea': {
            template: '<textarea class="v-textarea" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)"></textarea>',
            props: ['modelValue'],
            inheritAttrs: false
          }
        }
      }
    });
  };

  test('renders members list correctly', () => {
    const wrapper = createWrapper();
    const [teachers, students] = wrapper.findAll('.v-textarea');
    expect((teachers.element as HTMLTextAreaElement).value).toBe('teacher1, teacher2');
    expect((students.element as HTMLTextAreaElement).value).toBe('student1, student2');
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

  test('shows the class link with a copy and an open button', () => {
    const wrapper = createWrapper();
    const url = window.location.toString();
    expect((wrapper.find('.v-text-field input').element as HTMLInputElement).value).toBe(url);
    expect(wrapper.find('[data-icon="mdi-content-copy"]').exists()).toBe(true);
    expect(wrapper.find('[data-icon="mdi-open-in-new"]').attributes('data-href')).toBe(url);
    // the edrys-dev notes only show when the link differs from this page
    expect(wrapper.find('.link-note').exists()).toBe(false);
  });

  test('copy button copies the class link and shows a check for a moment', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const wrapper = createWrapper();
    await wrapper.find('[data-icon="mdi-content-copy"]').trigger('click');

    expect(writeText).toHaveBeenCalledWith(window.location.toString());
    expect(wrapper.find('[data-icon="mdi-check"]').exists()).toBe(true);

    vi.advanceTimersByTime(2000);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-icon="mdi-content-copy"]').exists()).toBe(true);
    vi.useRealTimers();
  });
});
