import { describe, test, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import Design from '../../../../src/components/Settings/Design.vue';
import { activeTheme, previewTheme, designs, FONTS } from '../../../../src/ts/Theme';
import { steppedCorners, steppedText } from '../../../../src/ts/CustomDesign';

describe('Design Settings Component', () => {
  const mockConfig = {
    id: 'class-1',
    name: 'Test Class',
    meta: {
        logo: 'https://example.com/logo.png',
        description: 'Test Description',
    }
  };

  const createWrapper = (props = {}) => {
    return mount(Design, {
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

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });


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

    test('downloading saves the design as stored, form changes included, and it uploads again unchanged', async () => {
      const config = reactive({ id: 'class-1', name: 'Lab', meta: { design: 'custom' } as any });
      const wrapper = createWrapper({ config });
      // nothing to download before the design has anything in it
      expect(wrapper.find('.custom-download').exists()).toBe(false);

      await uploadText(wrapper, 'name: Ocean Blue\nbase: compact\nlight:\n  colors:\n    primary: "#0077b6"\n');
      await wrapper.find('.custom-font button:last-child').trigger('click');
      const stored = JSON.parse(JSON.stringify(config.meta.customDesign));
      expect(stored.font).toBe('fredoka');

      // jsdom has neither
      let blob: Blob | undefined;
      vi.stubGlobal('URL', Object.assign(class extends URL {}, {
        createObjectURL: (b: Blob) => {
          blob = b;
          return 'blob:design';
        },
        revokeObjectURL: () => {},
      }));
      let fileName = '';
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        fileName = this.download;
      });

      await wrapper.find('.custom-download').trigger('click');
      expect(fileName).toBe('ocean-blue.yml');
      const text = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(blob!);
      });

      config.meta.customDesign = { name: 'Other' };
      await wrapper.vm.$nextTick();
      await uploadText(wrapper, text);
      expect(config.meta.customDesign).toEqual(stored);
      expect(wrapper.find('.custom-ignored').exists()).toBe(false);
    });

    describe('the short form', () => {
      const custom = (meta: any = {}) => {
        const config = reactive({ id: 'class-1', name: 'Lab', meta: { design: 'custom', ...meta } as any });
        return { config, wrapper: createWrapper({ config }) };
      };
      const clickIn = async (wrapper: any, group: string, label: string) => {
        const button = wrapper.findAll(`${group} button`).find((b: any) => b.text() === label);
        await button.trigger('click');
      };

      afterEach(() => {
        previewTheme.value = null;
        activeTheme.value = 'light';
      });

      test('shows the base values before anything is set, and the first change makes the design', async () => {
        const { config, wrapper } = custom();
        expect(wrapper.find('.custom-base .v-btn--active').text()).toBe('Standard');
        expect(wrapper.find('.custom-font .v-btn--active').text()).toBe('Noto Sans');
        expect((wrapper.find('#custom-color-primary').element as HTMLInputElement).value).toBe(
          designs.standard.light.colors!.primary
        );
        expect(wrapper.find('.custom-corners .v-btn--active').text()).toBe('Normal');
        expect(wrapper.find('.custom-text .v-btn--active').text()).toBe('Normal');
        expect(wrapper.find('.custom-reset').exists()).toBe(false);
        expect(config.meta.customDesign).toBeUndefined();

        await clickIn(wrapper, '.custom-font', 'Fredoka');
        expect(config.meta.customDesign).toEqual({ font: 'fredoka' });
      });

      test('a color sets the text on it to black or white and can go back to the base color', async () => {
        const { config, wrapper } = custom({ customDesign: { light: { colors: { 'pop-2': '#123456' } } } });
        await wrapper.find('#custom-color-surface-variant').setValue('#ffd23f');
        expect(config.meta.customDesign.light.colors).toEqual({
          'pop-2': '#123456', // set by a file, kept
          'surface-variant': '#ffd23f',
          'on-surface-variant': '#1b2029',
          'bar-icon': '#1b2029',
        });
        expect(wrapper.find('.custom-color--surface-variant .custom-hex').text()).toBe('#ffd23f');

        await wrapper.find('.custom-color--surface-variant .custom-reset').trigger('click');
        expect(config.meta.customDesign.light.colors).toEqual({ 'pop-2': '#123456' });
      });

      test('the Light/Dark switch shows that half without saving it and edits its colors', async () => {
        const { config, wrapper } = custom();
        await clickIn(wrapper, '.custom-half', 'Dark');
        expect(previewTheme.value).toBe('dark');
        activeTheme.value = 'dark'; // what followThemePreference does in the app
        await wrapper.vm.$nextTick();
        expect((wrapper.find('#custom-color-background').element as HTMLInputElement).value).toBe(
          designs.standard.dark.colors!.background
        );
        await wrapper.find('#custom-color-primary').setValue('#48cae4');
        expect(config.meta.customDesign).toEqual({
          dark: { colors: { primary: '#48cae4', 'on-primary': '#1b2029' } },
        });

        wrapper.unmount();
        expect(previewTheme.value).toBeNull();
      });

      test('picking a built-in design gives the half back to the user, as the switch goes with the form', async () => {
        const { wrapper } = custom();
        await clickIn(wrapper, '.custom-half', 'Dark');
        expect(previewTheme.value).toBe('dark');
        await wrapper.find('input[value=compact]').trigger('change');
        expect(wrapper.find('.custom-half').exists()).toBe(false);
        expect(previewTheme.value).toBeNull();
      });

      test('corner and text steps write all sizes, and Normal takes them out again', async () => {
        const { config, wrapper } = custom();
        await clickIn(wrapper, '.custom-corners', 'Round');
        await clickIn(wrapper, '.custom-text', 'Large');
        expect(config.meta.customDesign.shape).toEqual(steppedCorners('standard', 4));
        expect(config.meta.customDesign.text).toEqual(steppedText('standard', 3));
        expect(wrapper.find('.custom-corners .v-btn--active').text()).toBe('Round');

        await clickIn(wrapper, '.custom-corners', 'Normal');
        expect(config.meta.customDesign.shape).toEqual({});
      });

      test('a new base keeps the steps, now of that base', async () => {
        const { config, wrapper } = custom();
        await clickIn(wrapper, '.custom-corners', 'Square');
        await clickIn(wrapper, '.custom-text', 'Larger');
        await clickIn(wrapper, '.custom-base', 'Playful');
        expect(config.meta.customDesign.base).toBe('playful');
        expect(config.meta.customDesign.shape).toEqual(steppedCorners('playful', 0));
        expect(config.meta.customDesign.text).toEqual(steppedText('playful', 4));
        expect(wrapper.find('.custom-font .v-btn--active').text()).toBe('Fredoka'); // the base's font
      });

      test('sizes set by hand in a file show no step until one is picked', () => {
        const { wrapper } = custom({ customDesign: { shape: { 'radius-card': '13px' } } });
        expect(wrapper.find('.custom-corners .v-btn--active').exists()).toBe(false);
        expect(wrapper.find('.custom-text .v-btn--active').text()).toBe('Normal');
      });

      test('points to the documentation for every other field', () => {
        const { wrapper } = custom();
        const link = wrapper.find('.custom-more a');
        expect(wrapper.find('.custom-more').text()).toContain('The documentation lists every field you can set.');
        expect(link.text()).toBe('The documentation');
        expect(link.attributes('href')).toMatch(/edrys-labs\/documentation\/.*README\.md#Design-file$/);
        expect(link.attributes('target')).toBe('_blank');
        expect(link.attributes('rel')).toBe('noopener');
      });

      test('each font is named in its own font', () => {
        const { wrapper } = custom();
        const button = wrapper.findAll('.custom-font button').find((b) => b.text() === 'IBM Plex Sans')!;
        expect(button.attributes('style')).toContain(FONTS['ibm-plex-sans'].split(',')[0]);
      });
    });

    test('picking a built-in design clears the class\'s own, so Custom starts empty again', async () => {
      const customDesign = { name: 'Ocean', base: 'playful', light: { colors: { primary: '#0077b6' } } };
      const config = reactive({ id: 'class-1', name: 'Lab', meta: { design: 'custom', customDesign } as any });
      const wrapper = createWrapper({ config });
      expect(wrapper.find('.custom-current').text()).toBe('Ocean · based on Playful');

      await wrapper.find('input[value=compact]').trigger('change');
      expect(config.meta.design).toBe('compact');
      expect(config.meta.customDesign).toBeUndefined();

      await wrapper.find('input[value=custom]').trigger('change');
      expect(config.meta.design).toBe('custom');
      expect(config.meta.customDesign).toBeUndefined();
      expect(wrapper.find('.custom-current').exists()).toBe(false);
      expect(wrapper.find('.custom-base .v-btn--active').text()).toBe('Standard');
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
