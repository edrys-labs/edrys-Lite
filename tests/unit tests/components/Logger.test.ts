import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import Logger from "../../../src/components/Logger.vue";
import { i18n, messages } from "../../setup";

// Mock echarts
vi.mock("echarts/core", () => {
  const mockInit = vi.fn().mockReturnValue({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    getZr: vi.fn(),
    getDom: vi.fn(),
  });

  return {
    default: {
      init: mockInit,
      graphic: {
        LinearGradient: vi.fn(),
      },
      use: vi.fn(),
    },
  };
});

// Mock performance.memory
Object.defineProperty(window.performance, "memory", {
  value: {
    usedJSHeapSize: 1000000,
    totalJSHeapSize: 2000000,
    jsHeapSizeLimit: 4000000,
  },
  configurable: true,
});

// Create stub components
const stubs = {
  "v-card": {
    template: '<div class="v-card"><slot /></div>',
  },
  "v-toolbar": {
    template: '<div class="v-toolbar"><slot /><slot name="extension" /></div>',
  },
  "v-toolbar-title": {
    template: '<div class="v-toolbar-title"><slot /></div>',
  },
  "v-spacer": true,
  "v-menu": {
    template:
      '<div class="v-menu"><slot /><slot name="activator" :props="{}" /></div>',
  },
  "v-btn": {
    template:
      '<button class="v-btn" @click="$emit(\'click\')"><slot /></button>',
    emits: ["click"],
  },
  "v-icon": true,
  "v-tooltip": {
    template:
      '<div class="v-tooltip" v-bind="$attrs"><slot name="activator" :props="{}" /></div>',
  },
  "v-checkbox": {
    template: '<input class="v-checkbox" type="checkbox" v-bind="$attrs" v-model="modelValue" :label="$attrs.label" />',
    props: ["modelValue"],
    inheritAttrs: false
  },
  "v-tabs": {
    template: '<div class="v-tabs"><slot /></div>',
  },
  "v-tab": {
    template: '<div class="v-tab" data-test="tab"><slot /></div>',
  },
  "v-tabs-window": {
    template: '<div class="v-tabs-window"><slot /></div>',
  },
  "v-tabs-window-item": {
    template: '<div class="v-tabs-window-item"><slot /></div>',
  },
  "v-card-text": true,
  "v-divider": {
    template: '<div class="v-divider"><slot /></div>',
  },
  "v-dialog": {
    template: '<div class="v-dialog"><slot /></div>',
  },
  "v-select": {
    template: '<select v-bind="$attrs" v-model="modelValue"><slot /></select>',
    props: ["modelValue"],
  },
  "v-list": {
    template: '<div class="v-list"><slot /></div>',
  },
  "v-list-item": {
    template: '<div class="v-list-item"><slot /></div>',
  },
  "v-card-actions": {
    template: '<div class="v-card-actions"><slot /></div>',
  },
};

describe("Logger Component", () => {
  let wrapper: any;
  const mockDatabase = {
    putLog: vi.fn(),
    getLogById: vi.fn(),
    getLogsIds: vi.fn(),
  };

  const mockLiveClassProxy = {
    users: {
      user1: { room: "Station1", role: "student" },
      user2: { room: "Lobby", role: "student" },
    },
  };

  const createWrapper = (props = {}) => {
    return mount(Logger, {
      props: {
        liveClassProxy: mockLiveClassProxy,
        classId: "test-class",
        stationName: "test-station",
        database: mockDatabase,
        ...props,
      },
      global: {
        plugins: [i18n],
        stubs,
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  test("initializes with correct default state", () => {
    wrapper = createWrapper();
    expect(wrapper.vm.isLoggerRunning).toBe(false);
    expect(wrapper.vm.memoryData).toEqual([]);
    expect(wrapper.vm.consoleData).toEqual([]);
    expect(wrapper.vm.networkData).toEqual([]);
    expect(wrapper.vm.usersInStations).toEqual([]);
  });

  test("starts logging when start button is clicked", async () => {
    wrapper = createWrapper();
    await wrapper.vm.startLogger();

    expect(wrapper.vm.isLoggerRunning).toBe(true);
    expect(wrapper.vm.isSavingEnabled).toBe(true);
    expect(wrapper.emitted("logger-started")).toBeTruthy();
  });

  test("stops logging when stop button is clicked", async () => {
    wrapper = createWrapper();
    await wrapper.vm.startLogger();
    await wrapper.vm.stopLogger();

    expect(wrapper.vm.isLoggerRunning).toBe(false);
    expect(wrapper.vm.isSavingEnabled).toBe(false);
    expect(wrapper.emitted("logger-stopped")).toBeTruthy();
  });

  test("records memory data when enabled", async () => {
    wrapper = createWrapper();
    await wrapper.vm.startLogger();

    expect(wrapper.vm.memoryData.length).toBeGreaterThan(0);
    expect(wrapper.vm.memoryData[0]).toMatchObject({
      usedJSHeapSize: expect.any(String),
      totalJSHeapSize: expect.any(String),
      jsHeapSizeLimit: expect.any(String),
    });
  });

  test("monitors console logs when enabled", async () => {
    wrapper = createWrapper();
    await wrapper.vm.startLogger();

    console.log("test message");

    expect(wrapper.vm.consoleData).toContainEqual(
      expect.objectContaining({
        message: "test message",
        type: "log",
      })
    );
  });

  test("tracks users in stations", async () => {
    wrapper = createWrapper();
    await wrapper.vm.startLogger();
    await wrapper.vm.monitorUsersInStations();

    expect(wrapper.vm.usersInStations).toContainEqual(
      expect.objectContaining({
        user: "user1",
        station: "Station1",
        event: "joined",
      })
    );
  });

  test("saves logger data to database", async () => {
    wrapper = createWrapper();
    await wrapper.vm.startLogger();
    await wrapper.vm.saveLoggerDataToDB();

    expect(mockDatabase.putLog).toHaveBeenCalled();
  });

  test("loads logger data from database", async () => {
    const mockData = {
      LoggerData: {
        consoleData: [
          { type: "log", message: "test", date: new Date().toISOString() },
        ],
        memoryData: [],
        networkData: [],
        usersInStations: [],
      },
    };

    mockDatabase.getLogById.mockResolvedValue(mockData);

    wrapper = createWrapper();
    await wrapper.setData({
      stationLogsInput: "Station: test - Date: 2023-01-01",
    });
    await wrapper.vm.loadLoggerDataFromDB();

    expect(wrapper.vm.consoleData).toEqual(mockData.LoggerData.consoleData);
  });

  test("clears logger data", async () => {
    wrapper = createWrapper();
    await wrapper.vm.startLogger();
    await wrapper.vm.measureMemory();
    await wrapper.vm.stopLogger();
    await wrapper.vm.clearLogger();

    expect(wrapper.vm.memoryData).toEqual([]);
    expect(wrapper.vm.consoleData).toEqual([]);
    expect(wrapper.vm.networkData).toEqual([]);
    expect(wrapper.vm.usersInStations).toEqual([]);
  });

  test("handles fetch monitoring", async () => {
    wrapper = createWrapper();
    await wrapper.vm.startLogger();

    await fetch("https://jsonplaceholder.typicode.com/posts", {
      method: "POST",
    });

    expect(wrapper.vm.networkData).toContainEqual(
      expect.objectContaining({
        type: "fetch",
        request: "https://jsonplaceholder.typicode.com/posts",
        date: expect.any(String),
      })
    );
  });

  test("handles xhr monitoring", async () => {
    wrapper = createWrapper();
    await wrapper.vm.startLogger();

    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://jsonplaceholder.typicode.com/posts/1");

    await new Promise((resolve) => {
      xhr.onloadend = resolve;
      xhr.send();
    });

    expect(wrapper.vm.networkData).toContainEqual(
      expect.objectContaining({
        type: "xhr",
        url: "https://jsonplaceholder.typicode.com/posts/1",
        method: "GET",
        date: expect.any(String),
      })
    );
  });

  test("handles ws monitoring", async () => {
    wrapper = createWrapper();
    await wrapper.vm.startLogger();

    const ws = new WebSocket("wss://echo.websocket.org");
    await new Promise((resolve) => ws.addEventListener("open", resolve));
    ws.send("Hello, WebSocket!");
    ws.close();

    expect(wrapper.vm.networkData).toContainEqual(
      expect.objectContaining({
        type: "ws",
        request: "wss://echo.websocket.org",
        response: "Connection opened.",
        date: expect.any(String),
      })
    );
  });

  test("handles load resource monitoring", async () => {
    wrapper = createWrapper();
    await wrapper.vm.startLogger();

    const iframe = document.createElement("iframe");
    iframe.src = "https://example.com";

    document.body.appendChild(iframe);
    await wrapper.vm.$nextTick();
    document.body.removeChild(iframe);

    expect(wrapper.vm.networkData).toContainEqual(
      expect.objectContaining({
        date: expect.any(String),
        eventType: "iframe",
        type: "resource",
        url: "https://example.com/",
      })
    );
  });

  test("handles tab switching", async () => {
    wrapper = createWrapper();
    await wrapper.setData({ tab: "network" });
    expect(wrapper.vm.tab).toBe("network");

    await wrapper.setData({ tab: "console" });
    expect(wrapper.vm.tab).toBe("console");
  });

  test("updates active tabs when monitoring options change", async () => {
    wrapper = createWrapper();
    await wrapper.setData({ monitorNetwork: false });

    expect(wrapper.vm.activeTabs).not.toContain("network");
    expect(wrapper.vm.tab).not.toBe("network");
  });

  test("formats messages correctly", () => {
    wrapper = createWrapper();
    const objectMessage = { test: "value" };
    const stringMessage = "test string";

    expect(wrapper.vm.formatMessage(objectMessage)).toBe(
      '{\n  "test": "value"\n}'
    );
    expect(wrapper.vm.formatMessage(stringMessage)).toBe("test string");
  });

  test("handles infinite scroll loading", async () => {
    wrapper = createWrapper();
    const mockData = Array(50)
      .fill(null)
      .map((_, i) => ({
        date: new Date().toISOString(),
        message: `Message ${i}`,
        type: "log",
      }));

    await wrapper.setData({ consoleData: mockData });
    await wrapper.vm.loadMoreData("consoleData");

    expect(wrapper.vm.visibleConsoleData.length).toBe(20);
  });

  test("handles error events", async () => {
    wrapper = createWrapper();
    await wrapper.vm.startLogger();

    const errorEvent = new ErrorEvent("error", {
      error: new Error("Test error"),
      message: "Test error message",
    });

    window.dispatchEvent(errorEvent);

    expect(wrapper.vm.consoleData).toContainEqual(
      expect.objectContaining({
        type: "error",
        message: expect.stringContaining("Test error"),
      })
    );
  });

  test("handles unhandled promise rejections", async () => {
    wrapper = createWrapper();
    await wrapper.vm.startLogger();

    window.dispatchEvent(new Event("unhandledrejection"));
    await Promise.reject(new Error("Test rejection")).catch((e) => e.message);

    await wrapper.vm.$nextTick();

    expect(wrapper.vm.consoleData).toContainEqual(
      expect.objectContaining({
        type: "error",
        message: expect.stringContaining("TypeError"),
        date: expect.any(String),
      })
    );
  });

  test("saves and restores monitor settings", async () => {
    wrapper = createWrapper();
    await wrapper.setData({
      monitorMemory: false,
      monitorNetwork: false,
    });

    expect(wrapper.vm.activeTabs).not.toContain("memory");
    expect(wrapper.vm.activeTabs).not.toContain("network");

    await wrapper.setData({
      monitorMemory: true,
      monitorNetwork: true,
    });

    expect(wrapper.vm.activeTabs).toContain("memory");
    expect(wrapper.vm.activeTabs).toContain("network");
  });

  test("initializes chart after start", async () => {
    const wrapper = createWrapper();

    wrapper.vm.startLogger();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.memoryData.length).toBeGreaterThan(0);
    expect(wrapper.vm.memoryChart).toBeDefined();
  });

  test("properly cleans up on component destroy", async () => {
    wrapper = createWrapper();
    await wrapper.vm.startLogger();

    wrapper.unmount();

    expect(wrapper.vm.intervalId).toBeNull();
    expect(console.log).toBe(wrapper.vm.originalConsoleLog);
    expect(window.fetch).toBe(wrapper.vm.originalFetch);
  });

  test("validates log dates in database operations", async () => {
    wrapper = createWrapper();

    await wrapper.setData({ stationLogsInput: null });
    await wrapper.vm.loadLoggerDataFromDB();

    expect(mockDatabase.getLogById).not.toHaveBeenCalled();
  });

  describe("translations", () => {
    test.each(["en", "de", "uk", "ar", "es"])(
      "displays correct translations for %s locale",
      async (locale) => {
        i18n.global.locale.value = locale as "en" | "de" | "uk" | "ar" | "es";
        const wrapper = createWrapper();

        const translations = messages[locale].logger;

        // Check toolbar title
        const toolbarTitle = wrapper.find(".v-toolbar-title");
        expect(toolbarTitle.text()).toBe(translations.title);

        // Check start/stop button text
        const startButton = wrapper
          .findAll(".v-btn")
          .find((btn) => btn.text().includes(translations.actions.start));
        expect(startButton).toBeTruthy();

        await wrapper.vm.startLogger();
        const stopButton = wrapper
          .findAll(".v-btn")
          .find((btn) => btn.text().includes(translations.actions.stop));
        expect(stopButton).toBeTruthy();

        // Check load button text
        const loadButton = wrapper
          .findAll(".v-btn")
          .find((btn) => btn.text().includes(translations.actions.load));
        expect(loadButton).toBeTruthy();

        // Check clear button text
        const clearButton = wrapper
          .findAll(".v-btn")
          .find((btn) => btn.text().includes(translations.actions.clear));
        expect(clearButton).toBeTruthy();

        // Check minimize button tooltip
        const minimizeTooltip = wrapper
          .findAll(".v-tooltip")
          .find((t) => t.attributes("text") === translations.minimize);
        expect(minimizeTooltip).toBeTruthy();

        // Check close button tooltip
        const closeTooltip = wrapper
          .findAll(".v-tooltip")
          .find((t) => t.attributes("text") === translations.close);
        expect(closeTooltip).toBeTruthy();

        // Check data options menu items
        const dataOptions = [
          translations.options.memory,
          translations.options.network,
          translations.options.console,
          translations.options.station,
        ];

        const menuItems = wrapper.findAll(".v-checkbox");
        dataOptions.forEach((option, index) => {
          expect(menuItems[index].attributes("label")).toBe(option);
        });

        // Check tabs
        const tabTitles = [
          translations.tabs.memory.title,
          translations.tabs.network.title,
          translations.tabs.console.title,
          translations.tabs.station.title,
        ];
        const tabs = wrapper.findAll(".v-tab");
        tabTitles.forEach((title, index) => {
          expect(tabs[index].text()).toContain(title);
        });

        // Check dialog titles and buttons
        const closeDialogTitle = wrapper
          .findAll(".v-toolbar-title")
          .find((el) => el.text().includes(translations.closeDialog.title));
        expect(closeDialogTitle).toBeTruthy();
        const cancelButton = wrapper
          .findAll(".v-btn")
          .find((btn) => btn.text().includes(translations.closeDialog.cancel));
        expect(cancelButton).toBeTruthy();
        const confirmButton = wrapper
          .findAll(".v-btn")
          .find((btn) => btn.text().includes(translations.closeDialog.confirm));
        expect(confirmButton).toBeTruthy();
      }
    );
  });
});
