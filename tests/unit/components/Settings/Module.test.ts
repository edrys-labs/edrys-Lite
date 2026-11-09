import { describe, test, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import Module from '../../../../src/components/Settings/Module.vue';

describe('Module Settings Component', () => {
  const mockModule = {
    url: 'https://example.com/module',
    width: 'full',
    height: 'tall',
    config: '',
    studentConfig: '',
    teacherConfig: '',
    stationConfig: '',
    showInCustom: '*'
  };

  const mockError = {
    config: '',
    studentConfig: '',
    teacherConfig: '',
    stationConfig: '',
    showInCustom: ''
  };

  const createWrapper = (props = {}) => {
    return mount(Module, {
      props: {
        module: { ...mockModule },
        error: mockError,
        ...props
      },
      global: {
        stubs: {
          'v-expansion-panels': {
            template: '<div class="v-expansion-panels"><slot /></div>'
          },
          'v-expansion-panel': {
            template: '<div class="v-expansion-panel"><slot /></div>'
          },
          'v-expansion-panel-title': {
            template: '<div class="v-expansion-panel-title"><slot /><slot name="actions" /></div>'
          },
          'v-expansion-panel-text': {
            template: '<div class="v-expansion-panel-text"><slot /></div>'
          },
          'v-text-field': {
            template: '<input type="text" :label="$attrs.label" :value="modelValue" :disabled="$attrs.disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
            props: ['modelValue'],
            inheritAttrs: false
          },
          'v-radio-group': {
            template: '<div class="v-radio-group" :data-disabled="disabled"><slot /></div>',
            props: ['modelValue', 'disabled']
          },
          'v-radio': {
            template: `<div class="v-radio" data-test-label="true">{{label}}</div>`,
            props: ['label']
          },
          'v-row': {
            template: '<div class="v-row"><slot /></div>'
          },
          'v-col': {
            template: '<div class="v-col"><slot /></div>'
          },
          'v-container': {
            template: '<div class="v-container"><slot /></div>'
          },
          'v-icon': true,
          Editor: {
            template: '<div class="editor" :title="$attrs.title"><slot /></div>',
            inheritAttrs: false
          }
        }
      }
    });
  };

  test('renders module settings', () => {
    const wrapper = createWrapper();
    expect((wrapper.find('input[type="text"]').element as HTMLInputElement).value).toBe('https://example.com/module');
  });

  test('updates module URL', async () => {
    const wrapper = createWrapper();
    const input = wrapper.find('input[type="text"]');
    await input.setValue('https://newexample.com/module');
    expect(wrapper.vm.module.url).toBe('https://newexample.com/module');
  });


  test('emits error updates', async () => {
    const wrapper = createWrapper();
    await wrapper.setProps({
      error: { ...mockError, config: 'Test error' }
    });
    expect(wrapper.emitted('update:error')).toBeTruthy();
  });

  const heads = (wrapper: any) => wrapper.findAll('.row-head');
  const rowByTitle = (wrapper: any, title: string) =>
    wrapper.findAll('.advanced-row').find((row: any) => row.find('.row-title').text() === title);

  test('each part shows a summary of its value', () => {
    const wrapper = createWrapper({
      module: { ...mockModule, config: { content: '# Hi' }, studentConfig: 'free text', showInCustom: 'lobby, station' },
    });
    const summary = (title: string) => rowByTitle(wrapper, title).find('.row-summary').text();
    expect(summary('URL')).toBe('https://example.com/module');
    expect(summary('Design')).toBe('Width Full · Height Tall');
    expect(summary('General Settings')).toBe('1 key: content');
    expect(summary('Student Settings')).toBe('Text');
    expect(summary('Teacher Settings')).toBe('Empty');
    expect(summary('Show in')).toBe('lobby, station');
  });

  test('one part is open at a time', async () => {
    const wrapper = createWrapper();
    const open = () => wrapper.findAll('.row-head[aria-expanded="true"]').map((h: any) => h.find('.row-title').text());
    expect(open()).toEqual([]);

    await heads(wrapper)[0].trigger('click');
    expect(open()).toEqual(['URL']);
    await heads(wrapper)[1].trigger('click');
    expect(open()).toEqual(['Design']);
    await heads(wrapper)[1].trigger('click');
    expect(open()).toEqual([]);
  });

  test('a part with an error shows the error pill', () => {
    const wrapper = createWrapper({ error: { ...mockError, teacherConfig: 'bad indentation' } });
    expect(rowByTitle(wrapper, 'Teacher Settings').find('.error-pill').exists()).toBe(true);
    expect(rowByTitle(wrapper, 'General Settings').find('.error-pill').exists()).toBe(false);
  });

  test('the design switches set width and height', async () => {
    const module = { ...mockModule };
    const wrapper = createWrapper({ module });
    await wrapper.find('input[type="radio"][value="half"]').setValue(true);
    expect(module.width).toBe('half');
    await wrapper.find('input[type="radio"][value="short"]').setValue(true);
    expect(module.height).toBe('short');
  });

  test('the "Show in" buttons edit the text and keep role values', async () => {
    const module = { ...mockModule, showInCustom: '*' };
    const wrapper = createWrapper({ module, rooms: ['Lobby', 'Room 1', 'Station A'] });
    // one button per place: everywhere, the Lobby, each room, the stations (not each station)
    const labels = wrapper.findAll('.place').map((b: any) => b.text().slice(1).trim());
    expect(labels).toEqual(['All rooms', 'Lobby', 'Room 1', 'Station']);
    const button = (label: string) => wrapper.findAll('.place').find((b: any) => b.text().includes(label));

    expect(button('All rooms').attributes('aria-pressed')).toBe('true');

    await button('Lobby').trigger('click');
    expect(module.showInCustom).toBe('lobby');
    await button('Room 1').trigger('click');
    expect(module.showInCustom).toBe('lobby, Room 1');
    expect(button('All rooms').attributes('aria-pressed')).toBe('false');

    module.showInCustom = 'lobby, Room 1, teacher-only';
    await wrapper.vm.$nextTick();
    await button('Lobby').trigger('click');
    expect(module.showInCustom).toBe('Room 1, teacher-only');
    await button('Room 1').trigger('click');
    expect(module.showInCustom).toBe('*, teacher-only');
    await button('Station').trigger('click');
    expect(module.showInCustom).toBe('station, teacher-only');
    await button('All rooms').trigger('click');
    expect(module.showInCustom).toBe('*, teacher-only');
  });

  test('a "Show in" button shows the room label but saves the internal name', async () => {
    const module = { ...mockModule, showInCustom: '*' };
    const wrapper = createWrapper({
      module,
      rooms: ['Lobby', 'Room 1', 'Room 2'],
      roomNames: { 'Room 2': 'Group B' },
    });
    const button = () => wrapper.findAll('.place').find((b: any) => b.text().includes('Group B'));

    expect(button().text().charAt(0)).toBe('G');
    await button().trigger('click');
    expect(module.showInCustom).toBe('Room 2');
    expect(button().attributes('aria-pressed')).toBe('true');
  });

  test('the "Show in" summary reads the label while the stored value stays', () => {
    const module = { ...mockModule, showInCustom: 'Room 2' };
    const wrapper = createWrapper({ module, rooms: ['Room 2'], roomNames: { 'Room 2': 'Group B' } });

    expect(wrapper.vm.showInSummary).toBe('Group B');
    expect(module.showInCustom).toBe('Room 2');
  });

  test('a "Show in" button is on for a module listing the label, and takes it off', async () => {
    const module = { ...mockModule, showInCustom: 'group b, Room 1' };
    const wrapper = createWrapper({
      module,
      rooms: ['Lobby', 'Room 1', 'Room 2'],
      roomNames: { 'Room 2': 'Group B' },
    });
    const button = wrapper.findAll('.place').find((b: any) => b.text().includes('Group B'));

    expect(button.attributes('aria-pressed')).toBe('true');
    await button.trigger('click');
    expect(module.showInCustom).toBe('Room 1');
  });
});

