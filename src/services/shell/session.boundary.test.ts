/**
 * Boundary tests for SessionLayer using real Electron APIs.
 *
 * These tests verify the contract between DefaultSessionLayer and Electron's session API.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DefaultSessionLayer } from "./session";
import { ShellError, isShellErrorWithCode } from "./errors";
import { SILENT_LOGGER } from "../logging";
import type { SessionHandle } from "./types";

describe("SessionLayer (boundary)", () => {
  let sessionLayer: DefaultSessionLayer;
  let handles: SessionHandle[];

  beforeEach(() => {
    sessionLayer = new DefaultSessionLayer(SILENT_LOGGER);
    handles = [];
  });

  afterEach(async () => {
    // Clean up sessions by clearing storage
    for (const handle of handles) {
      try {
        await sessionLayer.clearStorageData(handle);
      } catch {
        // Ignore cleanup errors
      }
    }
    handles = [];
    await sessionLayer.dispose();
  });

  describe("fromPartition", () => {
    it("creates a session from a partition", () => {
      const handle = sessionLayer.fromPartition("persist:test-partition-1");
      handles.push(handle);

      expect(handle.id).toMatch(/^session-\d+$/);
      expect(handle.__brand).toBe("SessionHandle");
    });

    it("returns the same handle for the same partition", () => {
      const handle1 = sessionLayer.fromPartition("persist:test-partition-same");
      const handle2 = sessionLayer.fromPartition("persist:test-partition-same");
      handles.push(handle1);

      expect(handle1.id).toBe(handle2.id);
    });

    it("creates different handles for different partitions", () => {
      const handle1 = sessionLayer.fromPartition("persist:test-partition-a");
      const handle2 = sessionLayer.fromPartition("persist:test-partition-b");
      handles.push(handle1, handle2);

      expect(handle1.id).not.toBe(handle2.id);
    });

    it("supports non-persisted partitions", () => {
      const handle = sessionLayer.fromPartition("test-ephemeral-partition");
      handles.push(handle);

      expect(handle.id).toMatch(/^session-\d+$/);
    });
  });

  describe("clearStorageData", () => {
    it("clears storage without error", async () => {
      const handle = sessionLayer.fromPartition("persist:test-clear-storage");
      handles.push(handle);

      // Should not throw
      await expect(sessionLayer.clearStorageData(handle)).resolves.not.toThrow();
    });

    it("can be called multiple times", async () => {
      const handle = sessionLayer.fromPartition("persist:test-clear-multiple");
      handles.push(handle);

      // First clear
      await sessionLayer.clearStorageData(handle);
      // Second clear - should also succeed
      await expect(sessionLayer.clearStorageData(handle)).resolves.not.toThrow();
    });

    it("throws SESSION_NOT_FOUND for invalid handle", async () => {
      const fakeHandle = { id: "session-999", __brand: "SessionHandle" as const };

      await expect(sessionLayer.clearStorageData(fakeHandle)).rejects.toThrow(ShellError);
      try {
        await sessionLayer.clearStorageData(fakeHandle);
      } catch (error) {
        expect(isShellErrorWithCode(error, "SESSION_NOT_FOUND")).toBe(true);
      }
    });
  });

  describe("setPermissionRequestHandler", () => {
    it("sets a permission handler without error", () => {
      const handle = sessionLayer.fromPartition("persist:test-permission-req");
      handles.push(handle);

      expect(() => {
        sessionLayer.setPermissionRequestHandler(handle, (permission) => {
          return permission === "clipboard-read";
        });
      }).not.toThrow();
    });

    it("clears handler when passed null", () => {
      const handle = sessionLayer.fromPartition("persist:test-permission-req-null");
      handles.push(handle);

      // Set handler
      sessionLayer.setPermissionRequestHandler(handle, () => true);

      // Clear handler
      expect(() => {
        sessionLayer.setPermissionRequestHandler(handle, null);
      }).not.toThrow();
    });

    it("throws SESSION_NOT_FOUND for invalid handle", () => {
      const fakeHandle = { id: "session-999", __brand: "SessionHandle" as const };

      expect(() => {
        sessionLayer.setPermissionRequestHandler(fakeHandle, () => true);
      }).toThrow(ShellError);
    });
  });

  describe("setPermissionCheckHandler", () => {
    it("sets a permission check handler without error", () => {
      const handle = sessionLayer.fromPartition("persist:test-permission-check");
      handles.push(handle);

      expect(() => {
        sessionLayer.setPermissionCheckHandler(handle, (permission) => {
          return permission === "clipboard-read";
        });
      }).not.toThrow();
    });

    it("clears handler when passed null", () => {
      const handle = sessionLayer.fromPartition("persist:test-permission-check-null");
      handles.push(handle);

      // Set handler
      sessionLayer.setPermissionCheckHandler(handle, () => true);

      // Clear handler
      expect(() => {
        sessionLayer.setPermissionCheckHandler(handle, null);
      }).not.toThrow();
    });

    it("throws SESSION_NOT_FOUND for invalid handle", () => {
      const fakeHandle = { id: "session-999", __brand: "SessionHandle" as const };

      expect(() => {
        sessionLayer.setPermissionCheckHandler(fakeHandle, () => true);
      }).toThrow(ShellError);
    });
  });

  describe("dispose", () => {
    it("disposes without error", async () => {
      sessionLayer.fromPartition("persist:test-dispose-1");
      sessionLayer.fromPartition("persist:test-dispose-2");

      await expect(sessionLayer.dispose()).resolves.not.toThrow();
    });

    it("can be called on empty layer", async () => {
      await expect(sessionLayer.dispose()).resolves.not.toThrow();
    });
  });
});
