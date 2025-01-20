import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Chat from '../../../src/components/Chat.vue';
import markdownit from 'markdown-it';

// Mock prism dependencies
const mockPrismHighlight = vi.fn((code) => code);
const mockPrismLanguages = {
  markdown: {},
};

// Mock markdown-it
vi.mock('markdown-it', () => {
  return {
    default: vi.fn(() => ({
      render: vi.fn((text) => `<p>${text}</p>`),
      utils: {
        escapeHtml: vi.fn((text) => text),
      },
    })),
  };
});

// Create stub components
const stubs = {
  'v-navigation-drawer': {
    template: '<div class="v-navigation-drawer"><slot /><slot name="append" /></div>',
    props: ['modelValue', 'permanent', 'width', 'location'],
  },
  'v-container': {
    template: '<div class="v-container"><slot /></div>',
  },
  'v-row': {
    template: '<div class="v-row"><slot /></div>',
  },
  'v-col': {
    template: '<div class="v-col"><slot /></div>',
  },
  'v-card': {
    template: '<div class="v-card"><slot /></div>',
  },
  'v-card-text': {
    template: '<div class="v-card-text"><slot /></div>',
  },
  'v-btn': {
    template: '<button class="v-btn" @click="$emit(\'click\')"><slot /></button>',
    emits: ['click'],
  },
  'prism-editor': {
    template: '<div class="prism-editor"><textarea v-model="modelValue" @keyup="handleKeyup" /></div>',
    props: ['modelValue', 'highlight', 'readonly', 'rows'],
    emits: ['update:modelValue', 'keyup'],
    methods: {
      handleKeyup(e: KeyboardEvent) {
        if (e.ctrlKey && e.key === 'Enter') {
          this.$emit('keyup', { ctrlKey: true, key: 'Enter' });
        }
      }
    }
  },
};

describe('Chat Component', () => {
  let wrapper: any;

  const createWrapper = (props = {}) => {
    return mount(Chat, {
      props: {
        show: true,
        messages: [],
        truncated: false,
        ...props,
      },
      global: {
        provide: {
          prismHighlight: mockPrismHighlight,
          prismLanguages: mockPrismLanguages,
        },
        stubs,
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  test('renders correctly with initial props', () => {
    wrapper = createWrapper();
    console.log('wrapper', wrapper.html());
    expect(wrapper.find('.v-navigation-drawer').exists()).toBe(true);
    expect(wrapper.find('.prism-editor').exists()).toBe(true);
    expect(wrapper.find('.v-btn').exists()).toBe(true);
  });

  test('displays messages correctly', async () => {
    const messages = [
      { timestamp: 1234567890000, msg: 'Hello', user: 'user1' },
      { timestamp: 1234567890001, msg: 'World', user: 'user2' },
    ];

    wrapper = createWrapper({ messages });
    await wrapper.vm.$nextTick();

    const cards = wrapper.findAll('.v-card');
    expect(cards).toHaveLength(2);
    
    // Check message content
    expect(wrapper.html()).toContain('Hello');
    expect(wrapper.html()).toContain('World');
    
    // Check user names
    expect(wrapper.html()).toContain('user1');
    expect(wrapper.html()).toContain('user2');
  });

  test('handles message sending', async () => {
    wrapper = createWrapper();
    
    const message = 'Test message';
    await wrapper.setData({ message });
    
    await wrapper.find('.v-btn').trigger('click');
    
    expect(wrapper.emitted('sendMessage')).toBeTruthy();
    expect(wrapper.emitted('sendMessage')[0]).toEqual([message]);
    expect(wrapper.vm.message).toBe(''); // Should clear input after sending
  });

  test('does not send empty messages', async () => {
    wrapper = createWrapper();
    
    await wrapper.setData({ message: '   ' });
    await wrapper.find('.v-btn').trigger('click');
    
    expect(wrapper.emitted('sendMessage')).toBeFalsy();
  });

  test('handles markdown rendering', () => {
    wrapper = createWrapper();
    
    const message = '**bold** text';
    const rendered = wrapper.vm.render('key', message);
    
    expect(rendered).toBeTruthy();
    expect(markdownit).toHaveBeenCalled();
  });

  test('formats timestamps correctly', () => {
    wrapper = createWrapper();
    
    const timestamp = 1234567890000; // Example timestamp
    const formatted = wrapper.vm.toDate(timestamp);
    
    expect(formatted).toBe(new Date(timestamp).toLocaleString());
  });

  test('handles invalid timestamps', () => {
    wrapper = createWrapper();
    
    const invalidTimestamp = 'invalid';
    const result = wrapper.vm.toDate(invalidTimestamp);
    
    expect(result).toBe('Invalid Date');
  });

  test('shows truncation message when appropriate', async () => {
    wrapper = createWrapper({ truncated: true });
    
    expect(wrapper.html()).toContain('previous messages have been deleted');
  });

  test('updates when props change', async () => {
    wrapper = createWrapper({ show: true });
    
    await wrapper.setProps({ show: false });
    expect(wrapper.vm.open).toBe(false);
    
    const newMessages = [{ timestamp: Date.now(), msg: 'New message', user: 'user1' }];
    await wrapper.setProps({ messages: newMessages });
    expect(wrapper.vm.history).toEqual(newMessages);
  });

  test('handles code highlighting', () => {
    wrapper = createWrapper();
    
    const code = '```js\nconst x = 1;\n```';
    const highlighted = wrapper.vm.highlighter(code);
    
    expect(mockPrismHighlight).toHaveBeenCalledWith(
      code,
      mockPrismLanguages.markdown,
      'markdown'
    );
  });

  test('handles missing prism dependencies gracefully', () => {
    wrapper = mount(Chat, {
      props: {
        show: true,
        messages: [],
        truncated: false,
      },
      global: {
        provide: {
          prismHighlight: null,
          prismLanguages: {},
        },
        stubs,
      },
    });

    const code = 'test code';
    const result = wrapper.vm.highlighter(code);
    expect(result).toBe(code);
  });

  test('responsive behavior based on window width', async () => {
    wrapper = createWrapper();
    
    // Mock window.innerWidth
    const originalInnerWidth = window.innerWidth;
    
    // Test permanent mode
    window.innerWidth = 2000;
    expect(wrapper.vm.permanent()).toBe(true);
    
    // Test non-permanent mode
    window.innerWidth = 800;
    expect(wrapper.vm.permanent()).toBe(false);
    
    // Restore original value
    window.innerWidth = originalInnerWidth;
  });
});
