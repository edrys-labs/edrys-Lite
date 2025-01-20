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
    delete window.location;
    window.location = {
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
    window.location = originalLocation;
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
          'v-alert': {
            template: '<div class="v-alert"><slot /><slot name="append" /></div>'
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

  test('handles copy url button click', async () => {
    const wrapper = createWrapper();
    const copyBtn = wrapper.find('.v-btn');
    await copyBtn.trigger('click');

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost:3000/station');
  });
});
