import { describe, test, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import Main from '../../../../src/components/Settings/Main.vue';
import { activeTheme } from '../../../../src/ts/Theme';

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
            template: '<input type="checkbox" v-bind="$attrs" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
            props: ['modelValue'],
            emits: ['update:modelValue'],
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

  test('the "only teachers move students" box sets meta.teacherMovesStudents and points to its hint', async () => {
    const config = { id: 'class-1', name: 'Lab', meta: { teacherMovesStudents: false } };
    const wrapper = createWrapper({ config });
    const box = wrapper.find('input.teacher-moves');
    expect(box.attributes('aria-describedby')).toBe('teacher-moves-hint');
    expect(wrapper.find('#teacher-moves-hint').exists()).toBe(true);

    await box.setValue(true);
    expect(config.meta.teacherMovesStudents).toBe(true);
  });

  test('the design picker offers every design with its name and hint, and picking one sets meta.design', async () => {
    const config = { id: 'class-1', name: 'Lab', meta: { design: 'standard' } };
    const wrapper = createWrapper({ config });
    const group = wrapper.find('[role=radiogroup]');
    expect(group.attributes('aria-label')).toBe('Design');
    const radio = group.find('input[type=radio][value=standard]');
    expect(radio.attributes('aria-describedby')).toBe('design-hint-standard');
    expect(wrapper.find('#design-hint-standard').text()).toBe('The usual edrys look');
    expect(wrapper.find('.design--selected .design-name').text()).toBe('Standard');

    config.meta.design = 'something-else';
    await wrapper.vm.$nextTick();
    await radio.trigger('change');
    expect(config.meta.design).toBe('standard');
  });

  test('a class without a design, or with an unknown one, shows Standard as picked', async () => {
    for (const meta of [{}, { design: 'neon' }, { design: 7 }]) {
      const wrapper = createWrapper({ config: { id: 'class-1', name: 'Lab', meta } });
      expect((wrapper.find('input[value=standard]').element as HTMLInputElement).checked).toBe(true);
    }
  });

  test("each preview is drawn in that design's own theme, in the user's light or dark half", async () => {
    activeTheme.value = 'dark';
    const wrapper = createWrapper({ config: { id: 'class-1', name: 'Lab', meta: {} } });
    expect(wrapper.find('.design-preview').classes()).toContain('v-theme--standard-dark');
    activeTheme.value = 'light';
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.design-preview').classes()).toContain('v-theme--standard-light');
  });

  describe("the class's own design", () => {
    const uploadText = async (wrapper: any, text: string) => {
      const input = wrapper.find('input[type=file]');
      Object.defineProperty(input.element, 'files', {
        value: [new File([text], 'design.yml', { type: 'text/yaml' })],
        configurable: true,
      });
      await input.trigger('change');
      await new Promise((r) => setTimeout(r, 20));
      await wrapper.vm.$nextTick();
    };

    afterEach(() => vi.restoreAllMocks());


    test('is a fourth choice with a placeholder until it is picked, then its own preview and panel', async () => {
      const config = reactive({ id: 'class-1', name: 'Lab', meta: { design: 'standard' } as any });
      const wrapper = createWrapper({ config });
      expect(wrapper.findAll('input[type=radio]').map((r) => r.attributes('value'))).toEqual([
        'standard',
        'compact',
        'playful',
        'custom',
      ]);
      expect(wrapper.find('#design-hint-custom').text()).toBe('Your own colors, corners and text size');
      expect(wrapper.find('.design-preview--custom').exists()).toBe(true);
      expect(wrapper.find('.custom-design').exists()).toBe(false);

      await wrapper.find('input[value=custom]').trigger('change');
      expect(config.meta.design).toBe('custom');
      expect(wrapper.find('.design-preview--custom').exists()).toBe(false);
      expect(wrapper.findAll('.design-preview').at(3)!.classes()).toContain('v-theme--custom-light');
      expect(wrapper.find('.design--selected .design-name').text()).toBe('Custom');
      expect(wrapper.find('.custom-design').exists()).toBe(true);
      // nothing uploaded yet
      expect(wrapper.find('.custom-current').exists()).toBe(false);
    });

    test('uploading a file stores it as written, picks Custom and lists what it leaves out', async () => {
      const config = reactive({ id: 'class-1', name: 'Lab', meta: { design: 'custom' } as any });
      const wrapper = createWrapper({ config });
      await uploadText(
        wrapper,
        `name: Ocean
base: playful
light:
  colors:
    primary: '#0077b6'
    background: url(https://evil.example/t.png)
  css: 'body { display: none }'
`
      );
      expect(config.meta.design).toBe('custom');
      expect(config.meta.customDesign).toEqual({
        name: 'Ocean',
        base: 'playful',
        light: {
          colors: { primary: '#0077b6', background: 'url(https://evil.example/t.png)' },
          css: 'body { display: none }',
        },
      });
      expect(wrapper.find('.custom-current').text()).toBe('Ocean · based on Playful');
      expect(wrapper.findAll('.custom-ignored li').map((li) => li.text())).toEqual([
        'light.css — not a design field',
        'light.colors.background — value not allowed',
      ]);
      expect(wrapper.find('.custom-error').exists()).toBe(false);
    });

    test('a file that cannot be used changes nothing and says why', async () => {
      const customDesign = { name: 'Kept', light: { colors: { primary: '#112233' } } };
      const config = reactive({ id: 'class-1', name: 'Lab', meta: { design: 'custom', customDesign } as any });
      const wrapper = createWrapper({ config });

      await uploadText(wrapper, 'name: [unclosed');
      expect(wrapper.find('.custom-error').text()).toBe('The file is not YAML or JSON.');
      await uploadText(wrapper, '- a list');
      expect(wrapper.find('.custom-error').text()).toBe('The file does not hold a design.');
      await uploadText(wrapper, 'name: x\n#' + 'x'.repeat(60_000));
      expect(wrapper.find('.custom-error').text()).toBe('The file is larger than 50 KB.');
      expect(config.meta.customDesign).toEqual(customDesign);

      await uploadText(wrapper, 'name: Fixed');
      expect(wrapper.find('.custom-error').exists()).toBe(false);
      expect(config.meta.customDesign).toEqual({ name: 'Fixed' });
    });

    test('lists what a design written into the lab file leaves out', () => {
      const customDesign = { base: 'compact', extras: { dots: true }, sizes: { bar: 500 } };
      const wrapper = createWrapper({ config: { id: 'class-1', name: 'Lab', meta: { design: 'custom', customDesign } } });
      expect(wrapper.find('.custom-current').text()).toBe('Custom · based on Compact');
      expect(wrapper.findAll('.custom-ignored li').map((li) => li.text())).toEqual([
        'sizes.bar — value not allowed',
        'extras.dots — needs Playful as the base',
      ]);
    });
  });
});
