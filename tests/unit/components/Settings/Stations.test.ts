import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Stations from '../../../../src/components/Settings/Stations.vue';

describe('Stations Settings Component', () => {
  let originalLocation: Location;
  let originalClipboard: typeof navigator.clipboard;

  beforeEach(() => {
    // Save the original window.location and navigator.clipboard
    originalLocation = window.location;
    originalClipboard = navigator.clipboard;

    // Mock window.location
    delete (window as any).location;
    (window as any).location = {
      ...originalLocation,
      toString: () => 'http://localhost:3000/classroom',
    } as Location;

    // Mock navigator.clipboard
    const mockClipboard = {
      writeText: vi.fn().mockResolvedValue(undefined)
    };
    Object.assign(navigator, {
      clipboard: mockClipboard
    });
  });

  afterEach(() => {
    // Restore the original window.location and navigator.clipboard
    (window as any).location = originalLocation;
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      writable: true,
      configurable: true
    });
  });

  const createWrapper = (props = {}) => {
    return mount(Stations, {
      props: {
        config: {},
        ...props
      },
      global: {
        stubs: {
          'v-text-field': {
            props: ['modelValue'],
            template: '<div class="v-text-field"><input :value="modelValue" readonly /><slot name="append-inner" /></div>'
          },
          'v-container': true,
          'v-btn': {
            template: '<button class="v-btn"><slot /></button>'
          }
        }
      } 
    });
  };

  test('displays correct station URL', () => {
    const wrapper = createWrapper();
    expect(wrapper.vm.url).toContain('/station');
  });

  test('shows the link in a field with an open button', () => {
    const wrapper = createWrapper();
    expect(wrapper.find('input').element.value).toBe('http://localhost:3000/station');
    expect(wrapper.findAll('.v-btn')).toHaveLength(2);
    expect(wrapper.findAll('.steps li')).toHaveLength(3);
  });

  test('handles copy url button click', async () => {
    const wrapper = createWrapper();
    const copyBtn = wrapper.find('.copy-btn');
    await copyBtn.trigger('click');

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost:3000/station');
  });
});
