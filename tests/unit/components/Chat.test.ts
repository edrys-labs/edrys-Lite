import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Chat from '../../../src/components/Chat.vue';
import markdownit from 'markdown-it';
import { i18n } from '../../setup';

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
        plugins: [i18n],
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
    expect(wrapper.find('textarea').exists()).toBe(true);
    expect(wrapper.find('.v-btn').exists()).toBe(true);
  });

  test('displays messages correctly', async () => {
    const messages = [
      { timestamp: 1234567890000, msg: 'Hello', user: 'user1' },
      { timestamp: 1234567890001, msg: 'World', user: 'user2' },
    ];

    wrapper = createWrapper({ messages });
    await wrapper.vm.$nextTick();

    const cards = wrapper.findAll('.chat-message');
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

  test('renders raw HTML in a message as text, not markup', async () => {
    const { default: realMarkdownit } = await vi.importActual<any>('markdown-it');
    (markdownit as any).mockImplementationOnce((options: any) => realMarkdownit(options));

    wrapper = createWrapper({
      messages: [{ timestamp: 1, msg: 'hi <img src=x onerror=alert(1)>', user: 'u' }],
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.markdown img').exists()).toBe(false);
    expect(wrapper.find('.markdown').text()).toContain('<img src=x onerror=alert(1)>');
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

  test('tags your own messages and the teachers\'', async () => {
    const messages = [
      { timestamp: 1, msg: 'mine', user: 'me', signer: 'KEY-ME=', signature: 'a' },
      { timestamp: 2, msg: 'teacher', user: 'tea', signer: 'KEY-TEACHER', signature: 'b' },
      { timestamp: 3, msg: 'other', user: 'oth', signer: 'KEY-OTHER', signature: 'c' },
    ];
    // padding is ignored, as in the signature checks
    wrapper = createWrapper({ messages, me: 'KEY-ME', teachers: ['KEY-TEACHER='] });
    await wrapper.vm.$nextTick();

    const [mine, teacher, other] = wrapper.findAll('.chat-message');
    expect(mine.classes()).toContain('mine');
    expect(mine.find('.chat-you').text()).toBe('you');
    expect(mine.find('.chat-teacher').exists()).toBe(false);

    expect(teacher.classes()).not.toContain('mine');
    expect(teacher.find('.chat-teacher').text()).toBe('Teacher');

    expect(other.find('.chat-you').exists()).toBe(false);
    expect(other.find('.chat-teacher').exists()).toBe(false);
  });

  test('shows a chosen name as text beside the ID', async () => {
    wrapper = createWrapper({
      messages: [
        { timestamp: 1, msg: 'x', user: 'abc123', username: '<b>Ada</b>', signature: 'a' },
        { timestamp: 2, msg: 'y', user: 'def456', username: null, signature: 'b' },
      ],
    });
    await wrapper.vm.$nextTick();

    const [named, plain] = wrapper.findAll('.chat-message');
    expect(named.find('.chat-name').text()).toBe('<b>Ada</b>');
    expect(named.find('.chat-name b').exists()).toBe(false);
    expect(named.find('.chat-user').text()).toBe('abc123');
    expect(plain.find('.chat-name').exists()).toBe(false);
    expect(plain.find('.chat-user').text()).toBe('def456');
  });

  test('no tags without keys', async () => {
    wrapper = createWrapper({ messages: [{ timestamp: 1, msg: 'x', user: 'u', signature: 'a' }] });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.chat-you').exists()).toBe(false);
    expect(wrapper.find('.chat-teacher').exists()).toBe(false);
  });

  test('shows the time of day for today, with the date before that', () => {
    wrapper = createWrapper();

    const now = new Date();
    now.setHours(14, 2, 0, 0);
    expect(wrapper.vm.shortTime(now.getTime())).toBe(
      now.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
    );

    const earlier = new Date(2026, 0, 5, 9, 30).getTime();
    const short = wrapper.vm.shortTime(earlier);
    expect(short).toContain('Jan');
    expect(short).toContain('5');

    expect(wrapper.vm.shortTime('invalid')).toBe('invalid');
  });
});
