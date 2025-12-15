/**
 * Tests for lifecycle IPC handlers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ipcMain } from "electron";
import { registerLifecycleHandlers } from "./lifecycle-handlers";
import type { ILifecycleApi } from "../../shared/api/interfaces";
import { ApiIpcChannels } from "../../shared/ipc";

// Mock electron's ipcMain
vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}));

// =============================================================================
// Test Utilities
// =============================================================================

function createMockLifecycleApi(): ILifecycleApi {
  return {
    getState: vi.fn().mockResolvedValue("ready"),
    setup: vi.fn().mockResolvedValue({ success: true }),
    quit: vi.fn().mockResolvedValue(undefined),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("registerLifecycleHandlers", () => {
  let mockApi: ILifecycleApi;
  let registeredHandlers: Map<string, (event: unknown, payload: unknown) => Promise<unknown>>;

  beforeEach(() => {
    mockApi = createMockLifecycleApi();
    registeredHandlers = new Map();

    // Capture registered handlers
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      registeredHandlers.set(
        channel,
        handler as (event: unknown, payload: unknown) => Promise<unknown>
      );
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("registers api:lifecycle:get-state handler", () => {
    registerLifecycleHandlers(mockApi);

    expect(ipcMain.handle).toHaveBeenCalledWith(
      ApiIpcChannels.LIFECYCLE_GET_STATE,
      expect.any(Function)
    );
  });

  it("registers api:lifecycle:setup handler", () => {
    registerLifecycleHandlers(mockApi);

    expect(ipcMain.handle).toHaveBeenCalledWith(
      ApiIpcChannels.LIFECYCLE_SETUP,
      expect.any(Function)
    );
  });

  it("registers api:lifecycle:quit handler", () => {
    registerLifecycleHandlers(mockApi);

    expect(ipcMain.handle).toHaveBeenCalledWith(
      ApiIpcChannels.LIFECYCLE_QUIT,
      expect.any(Function)
    );
  });

  describe("get-state handler", () => {
    it("delegates to lifecycleApi.getState()", async () => {
      registerLifecycleHandlers(mockApi);
      const handler = registeredHandlers.get(ApiIpcChannels.LIFECYCLE_GET_STATE)!;

      const result = await handler(null, undefined);

      expect(mockApi.getState).toHaveBeenCalledTimes(1);
      expect(result).toBe("ready");
    });
  });

  describe("setup handler", () => {
    it("delegates to lifecycleApi.setup()", async () => {
      registerLifecycleHandlers(mockApi);
      const handler = registeredHandlers.get(ApiIpcChannels.LIFECYCLE_SETUP)!;

      const result = await handler(null, undefined);

      expect(mockApi.setup).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true });
    });

    it("returns failure result from api", async () => {
      (mockApi.setup as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        message: "Setup failed",
        code: "UNKNOWN",
      });
      registerLifecycleHandlers(mockApi);
      const handler = registeredHandlers.get(ApiIpcChannels.LIFECYCLE_SETUP)!;

      const result = await handler(null, undefined);

      expect(result).toEqual({
        success: false,
        message: "Setup failed",
        code: "UNKNOWN",
      });
    });
  });

  describe("quit handler", () => {
    it("delegates to lifecycleApi.quit()", async () => {
      registerLifecycleHandlers(mockApi);
      const handler = registeredHandlers.get(ApiIpcChannels.LIFECYCLE_QUIT)!;

      await handler(null, undefined);

      expect(mockApi.quit).toHaveBeenCalledTimes(1);
    });
  });
});
