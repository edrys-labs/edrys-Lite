import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { createApp } from "vue";
import { navigateTo } from "../../src/index";
import Index from "../../src/views/Index.vue";
import Classroom from "../../src/views/Classroom.vue";
import Deploy from "../../src/views/Deploy.vue";

// Mock Vue and Vuetify 
vi.mock("vue", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    createApp: vi.fn().mockImplementation((...args) => {
      const app = actual.createApp(...args);
      app.use = vi.fn().mockReturnThis();
      app.mount = vi.fn();
      return app;
    })
  };
});

vi.mock("vuetify", () => ({
  createVuetify: vi.fn()
}));

describe("Router", () => {
  let mockApp;

  beforeEach(() => {
    // Reset mocks and DOM
    vi.clearAllMocks();
    document.body.innerHTML = "";

    // Create fresh mock app instance for each test
    mockApp = {
      use: vi.fn().mockReturnThis(),
      provide: vi.fn().mockReturnThis(),
      mount: vi.fn(),
      unmount: vi.fn()
    };
    vi.mocked(createApp).mockReturnValue(mockApp);

    // Mock history and location
    Object.defineProperty(window, "location", {
      value: {
        search: "",
        pathname: "/"
      },
      writable: true
    });

    vi.spyOn(history, "pushState");
    vi.spyOn(history, "replaceState");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("navigates to correct routes", () => {
    // Test index route
    window.location.search = "";
    window.dispatchEvent(new Event("popstate"));
    expect(createApp).toHaveBeenCalledWith(Index, expect.any(Object));

    // Test classroom route
    window.location.search = "?/classroom/test-id";
    window.dispatchEvent(new Event("popstate"));
    expect(createApp).toHaveBeenCalledWith(
      Classroom,
      expect.objectContaining({
        id: "test-id",
        station: false,
      })
    );

    // Test station route
    window.location.search = "?/station/test-id";
    window.dispatchEvent(new Event("popstate"));
    expect(createApp).toHaveBeenCalledWith(
      Classroom,
      expect.objectContaining({
        id: "test-id",
        station: true,
      })
    );

    // Test deploy route
    window.location.search = "?/deploy/test-url";
    window.dispatchEvent(new Event("popstate"));
    expect(createApp).toHaveBeenCalledWith(
      Deploy,
      expect.objectContaining({
        url: "test-url",
      })
    );
  });

  test("handles data-link clicks", () => {
    const link = document.createElement("a");
    link.setAttribute("data-link", "");
    link.href = "/?/classroom/test";
    document.body.appendChild(link);

    // Simulate DOMContentLoaded
    document.dispatchEvent(new Event("DOMContentLoaded"));

    link.click();

    expect(history.pushState).toHaveBeenCalled();
    expect(createApp).toHaveBeenCalled();
  });

  test("navigateTo function works correctly", () => {
    // Test normal navigation
    navigateTo("/?/classroom/test");
    expect(history.pushState).toHaveBeenCalled();

    // Test replace navigation
    navigateTo("/?/classroom/test", true);
    expect(history.replaceState).toHaveBeenCalled();
  });

  test("provides Prism functionality", () => {
    window.location.search = "";
    window.dispatchEvent(new Event("popstate"));

    expect(mockApp.provide).toHaveBeenCalledWith(
      "prismHighlight",
      expect.any(Function)
    );
    expect(mockApp.provide).toHaveBeenCalledWith(
      "prismLanguages",
      expect.any(Object)
    );
  });

  test("handles invalid routes", () => {
    window.location.search = "?/invalid/route";
    window.dispatchEvent(new Event("popstate"));

    // Should default to Index view
    expect(createApp).toHaveBeenCalledWith(Index, expect.any(Object));
  });

  test("unmounts previous app before mounting new one", () => {
    // Trigger two route changes
    window.location.search = "?/classroom/test1";
    window.dispatchEvent(new Event("popstate"));

    window.location.search = "?/classroom/test2";
    window.dispatchEvent(new Event("popstate"));

    expect(mockApp.unmount).toHaveBeenCalled();
  });
});
