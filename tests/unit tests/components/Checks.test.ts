import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Checks from '../../../src/components/Checks.vue';

describe('Checks Component', () => {
  let wrapper: any;

  const createWrapper = (states = {}) => {
    return mount(Checks, {
      props: {
        states: {
          webRTCSupport: false,
          receivedConfiguration: false,
          connectedToNetwork: false,
          ...states,
        },
      },
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    if (wrapper) wrapper.unmount();
  });

  test('renders correctly with initial states', () => {
    wrapper = createWrapper();
    expect(wrapper.find('v-overlay').exists()).toBe(true);
    expect(wrapper.find('v-progress-circular').exists()).toBe(true);
    expect(wrapper.findAll('[icon="mdi-close"]')).toHaveLength(3);
  });

  test('updates visibility based on all states being true', async () => {
    wrapper = createWrapper({
      webRTCSupport: true,
      receivedConfiguration: true,
      connectedToNetwork: true,
    });

    expect(wrapper.vm.model).toBe(false);
  });

  test('shows success icons when states are true', async () => {
    wrapper = createWrapper({
      webRTCSupport: true,
      receivedConfiguration: true,
      connectedToNetwork: true,
    });

    expect(wrapper.findAll('[icon=mdi-check]')).toHaveLength(3);
    expect(wrapper.findAll('[icon=mdi-close]')).toHaveLength(0);
  });

  test('increments counter when not connected to network', async () => {
    wrapper = createWrapper({
      receivedConfiguration: true,
      connectedToNetwork: false,
    });

    expect(wrapper.vm.counter).toBe(0);
    
    vi.advanceTimersByTime(2000);
    await wrapper.vm.$nextTick();
    
    expect(wrapper.vm.counter).toBe(2);
  });

  test('resets counter when connected to network', async () => {
    wrapper = createWrapper({
      receivedConfiguration: true,
      connectedToNetwork: false,
    });

    vi.advanceTimersByTime(2000);
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.counter).toBe(2); 

    await wrapper.setProps({
      states: {
        receivedConfiguration: true,
        connectedToNetwork: true,
      },
    });

    expect(wrapper.vm.counter).toBe(0);
  });

  test('updates model when states change', async () => {
    wrapper = createWrapper();
    expect(wrapper.vm.model).toBe(true);

    await wrapper.setProps({
      states: {
        webRTCSupport: true,
        receivedConfiguration: true,
        connectedToNetwork: true,
      },
    });

    expect(wrapper.vm.model).toBe(false);
  });

  test('stops counter increment when component is unmounted', async () => {
    wrapper = createWrapper({
      receivedConfiguration: true,
      connectedToNetwork: false,
    });

    vi.advanceTimersByTime(1000);
    await wrapper.vm.$nextTick();
    
    wrapper.unmount();
    
    vi.advanceTimersByTime(1000);
    expect(wrapper.vm.counter).toBe(1);
  });

  test('handles partial state updates', async () => {
    wrapper = createWrapper();
    
    await wrapper.setProps({
      states: {
        webRTCSupport: true,
        receivedConfiguration: false,
        connectedToNetwork: false,
      },
    });

    expect(wrapper.findAll('[icon=mdi-check]')).toHaveLength(1);
    expect(wrapper.findAll('[icon=mdi-close]')).toHaveLength(2);
  });

  test('displays correct counter in network status text', async () => {
    wrapper = createWrapper({
      receivedConfiguration: true,
      connectedToNetwork: false,
    });

    vi.advanceTimersByTime(3000);
    await wrapper.vm.$nextTick();

    const networkStatus = wrapper.findAll('div').find((el: any) => el.text().includes('Connected to peer 2 peer network'));
    expect(networkStatus).toBeTruthy();
    expect(networkStatus?.text()).toContain('3 sec.');
  });

  test('maintains overlay visibility until all checks pass', async () => {
    wrapper = createWrapper();
    expect(wrapper.vm.model).toBe(true);

    await wrapper.setProps({
      states: {
        webRTCSupport: true,
        receivedConfiguration: true,
        connectedToNetwork: false,
      },
    });
    expect(wrapper.vm.model).toBe(true);

    await wrapper.setProps({
      states: {
        webRTCSupport: true,
        receivedConfiguration: true,
        connectedToNetwork: true,
      },
    });
    expect(wrapper.vm.model).toBe(false);
  });
});
