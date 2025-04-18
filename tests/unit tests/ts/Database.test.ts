import { Database, DatabaseItem } from "../../../src/ts/Database";
import { hashJsonObject } from "../../../src/ts/Utils";
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import { Dexie, liveQuery } from "dexie";

// Mock localStorage
const localStorageMock = (() => {
  let store: { [key: string]: string } = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

// Create mock implementation
const mockData = {
  orderBy: vi.fn().mockReturnThis(),
  desc: vi.fn().mockReturnThis(),
  toArray: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

const mockLogs = {
  toArray: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

// Mocking external dependencies
vi.mock("dexie", () => {
  return {
    Dexie: vi.fn().mockImplementation(() => ({
      version: vi.fn().mockReturnThis(),
      stores: vi.fn().mockReturnThis(),
      open: vi.fn().mockResolvedValue(true),
      table: vi.fn().mockReturnThis(),
      data: mockData,
      logs: mockLogs,
    })),
    liveQuery: vi.fn().mockImplementation((queryFn) => ({
      subscribe: vi.fn().mockReturnValue({
        unsubscribe: vi.fn(),
      }),
    })),
  };
});

vi.mock("../../../src/ts/Utils", () => ({
  hashJsonObject: vi
    .fn()
    .mockImplementation(() => Promise.resolve("hashedData")),
}));

describe("Database", () => {
  let db: Database;
  let dexieInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    db = new Database();
    dexieInstance = new Dexie("EdrysLite");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should instantiate the database and open connection", () => {
    expect(db).toBeTruthy();
    expect(Dexie).toHaveBeenCalledWith("EdrysLite");
  });

  it("should get all data", async () => {
    const mockItems = [
      { id: "1", timestamp: 123, data: {}, hash: null },
      { id: "2", timestamp: 456, data: {}, hash: null },
    ];
    mockData.toArray.mockResolvedValue(mockItems);

    const result = await db.getAll();
    expect(result).toEqual(mockItems);
    expect(mockData.toArray).toHaveBeenCalled();
  });

  it("should check if an item exists", async () => {
    mockData.get.mockResolvedValue({
      id: "1",
      timestamp: 123,
      data: {},
      hash: null,
    });

    const exists = await db.exists("1");
    expect(exists).toBe(true);

    mockData.get.mockResolvedValue(null);
    const notExists = await db.exists("2");
    expect(notExists).toBe(false);
  });

  it("should get an item by id", async () => {
    const mockItem = { id: "1", timestamp: 123, data: {}, hash: null };
    mockData.get.mockResolvedValue(mockItem);

    const result = await db.get("1");
    expect(result).toEqual(mockItem);
    expect(mockData.get).toHaveBeenCalledWith("1");
  });

  it("should put an item into the database", async () => {
    const mockItem = { id: "1", timestamp: 123, data: {}, hash: null };
    mockData.put.mockResolvedValue(undefined);

    await db.put(mockItem);
    expect(mockData.put).toHaveBeenCalledWith(mockItem);
  });

  it("should update an item in the database with a timestamp", async () => {
    const mockItem = { id: "1", timestamp: 123, data: {}, hash: null };
    const newTimestamp = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(newTimestamp);

    mockData.put.mockResolvedValue(undefined);

    await db.update(mockItem);

    expect(mockItem.timestamp).toBe(newTimestamp);
    expect(mockData.put).toHaveBeenCalledWith(mockItem);
  });

  it("should delete an item by id", () => {
    mockData.delete.mockResolvedValue(undefined);

    db.drop("1");
    expect(mockData.delete).toHaveBeenCalledWith("1");
  });

  it("should set protection (hash) for an item", async () => {
    const mockItem = { id: "1", timestamp: 123, data: {}, hash: null };
    mockData.get.mockResolvedValue(mockItem);

    await db.setProtection("1", true);

    expect(vi.mocked(hashJsonObject)).toHaveBeenCalledWith(mockItem.data);
    expect(mockItem.hash).toBe("hashedData");
    expect(mockData.put).toHaveBeenCalledWith(mockItem);
  });

  it("should add an observable for an item", () => {
    const mockCallback = vi.fn();
    const mockSubscription = { unsubscribe: vi.fn() };

    vi.mocked(liveQuery).mockImplementation(() => ({
      subscribe: vi.fn().mockReturnValue(mockSubscription),
      [Symbol.observable](): any {
        return this;
      },
    }));

    db.setObservable("1", mockCallback);

    expect(liveQuery).toHaveBeenCalled();
    expect(db["observables"]["1"]).toBeDefined();
  });

  it("should delete an observable", () => {
    const mockCallback = vi.fn();
    const mockUnsubscribe = vi.fn();

    // Set up the observable
    vi.mocked(liveQuery).mockImplementation(() => ({
      subscribe: vi.fn().mockReturnValue({
        unsubscribe: mockUnsubscribe,
      }),
      [Symbol.observable](): any {
        return this;
      },
    }));

    // Create the observable
    db.setObservable("1", mockCallback);

    db.deleteObservable("1");

    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it("should get all logs", async () => {
    const mockLogItems = [
      { memoryData: [], consoleData: [], networkData: [], usersInStations: [] },
    ];
    mockLogs.toArray.mockResolvedValue(mockLogItems);

    const result = await db.getAllLogs();
    expect(result).toEqual(mockLogItems);
    expect(mockLogs.toArray).toHaveBeenCalled();
  });
});
