// @vitest-environment node
/**
 * Tests for IPC handler registration and error handling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// Mock functions at top level
const mockHandle = vi.fn();
const mockSend = vi.fn();
const mockGetAllWindows = vi.fn(() => [
  {
    webContents: {
      send: mockSend,
    },
  },
]);

// Mock Electron - must be at module scope, no top level variable references in factory
vi.mock("electron", () => {
  return {
    ipcMain: {
      handle: (...args: unknown[]) => mockHandle(...args),
    },
    BrowserWindow: {
      getAllWindows: () => mockGetAllWindows(),
    },
  };
});

// Import after mock
import { registerHandler, emitEvent, serializeError } from "./handlers";
import { ValidationError } from "./validation";
import { WorkspaceError } from "../../services/errors";

describe("registerHandler", () => {
  beforeEach(() => {
    mockHandle.mockClear();
    mockSend.mockClear();
  });

  it("registers a handler for a channel", () => {
    const schema = z.object({ path: z.string() });
    const handler = vi.fn().mockResolvedValue({ success: true });

    registerHandler("project:open", schema, handler);

    expect(mockHandle).toHaveBeenCalledWith("project:open", expect.any(Function));
  });

  it("validates payload before calling handler", async () => {
    const schema = z.object({ path: z.string() });
    const handler = vi.fn().mockResolvedValue({ success: true });

    registerHandler("project:open", schema, handler);

    // Get the registered wrapper
    const registeredWrapper = mockHandle.mock.calls[0]?.[1] as (
      event: unknown,
      payload: unknown
    ) => Promise<unknown>;

    // Call with valid payload
    await registeredWrapper({}, { path: "/valid/path" });

    expect(handler).toHaveBeenCalledWith(expect.anything(), { path: "/valid/path" });
  });

  it("throws ValidationError for invalid payload", async () => {
    const schema = z.object({ path: z.string() });
    const handler = vi.fn();

    registerHandler("project:open", schema, handler);

    const registeredWrapper = mockHandle.mock.calls[0]?.[1] as (
      event: unknown,
      payload: unknown
    ) => Promise<unknown>;

    // Call with invalid payload
    await expect(registeredWrapper({}, { path: 123 })).rejects.toThrow();

    // Handler should not be called
    expect(handler).not.toHaveBeenCalled();
  });

  it("allows void schema for handlers without payload", async () => {
    const handler = vi.fn().mockResolvedValue([]);

    registerHandler("project:list", null, handler);

    const registeredWrapper = mockHandle.mock.calls[0]?.[1] as (
      event: unknown,
      payload: unknown
    ) => Promise<unknown>;

    await registeredWrapper({}, undefined);

    expect(handler).toHaveBeenCalled();
  });
});

describe("serializeError", () => {
  it("serializes ServiceError subclasses via toJSON", () => {
    const error = new WorkspaceError("Workspace not found", "WORKSPACE_NOT_FOUND");

    const serialized = serializeError(error);

    expect(serialized).toEqual({
      type: "workspace",
      message: "Workspace not found",
      code: "WORKSPACE_NOT_FOUND",
    });
  });

  it("serializes ValidationError", () => {
    const error = new ValidationError([{ path: ["path"], message: "Required" }]);

    const serialized = serializeError(error);

    expect(serialized).toEqual({
      type: "validation",
      message: "path: Required",
    });
  });

  it("wraps unknown errors with type 'unknown'", () => {
    const error = new Error("Something went wrong");

    const serialized = serializeError(error);

    expect(serialized).toEqual({
      type: "unknown",
      message: "Something went wrong",
    });
  });

  it("handles non-Error objects", () => {
    const serialized = serializeError("string error");

    expect(serialized).toEqual({
      type: "unknown",
      message: "Unknown error",
    });
  });
});

describe("emitEvent", () => {
  beforeEach(() => {
    mockSend.mockClear();
  });

  it("sends event to all windows", () => {
    const payload = { project: { path: "/test", name: "test", workspaces: [] } };

    emitEvent("project:opened", payload);

    expect(mockSend).toHaveBeenCalledWith("project:opened", payload);
  });

  it("handles no windows gracefully", () => {
    mockGetAllWindows.mockReturnValueOnce([]);

    // Should not throw
    expect(() => emitEvent("project:opened", {} as never)).not.toThrow();
  });
});
