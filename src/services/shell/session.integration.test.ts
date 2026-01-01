/**
 * Integration tests for SessionLayer using behavioral mock.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createBehavioralSessionLayer, type BehavioralSessionLayer } from "./session.test-utils";
import { ShellError, isShellErrorWithCode } from "./errors";

describe("SessionLayer (integration)", () => {
  let sessionLayer: BehavioralSessionLayer;

  beforeEach(() => {
    sessionLayer = createBehavioralSessionLayer();
  });

  describe("fromPartition", () => {
    it("creates a session handle", () => {
      const handle = sessionLayer.fromPartition("persist:test-partition");

      expect(handle.id).toMatch(/^session-\d+$/);
      expect(handle.__brand).toBe("SessionHandle");

      const state = sessionLayer._getState();
      expect(state.sessions.has(handle.id)).toBe(true);
    });

    it("returns the same handle for the same partition", () => {
      const handle1 = sessionLayer.fromPartition("persist:same-partition");
      const handle2 = sessionLayer.fromPartition("persist:same-partition");

      expect(handle1.id).toBe(handle2.id);

      const state = sessionLayer._getState();
      expect(state.sessions.size).toBe(1);
    });

    it("creates different handles for different partitions", () => {
      const handle1 = sessionLayer.fromPartition("persist:partition-a");
      const handle2 = sessionLayer.fromPartition("persist:partition-b");

      expect(handle1.id).not.toBe(handle2.id);

      const state = sessionLayer._getState();
      expect(state.sessions.size).toBe(2);
    });

    it("tracks partition name correctly", () => {
      const partition = "persist:test-project/workspace";
      const handle = sessionLayer.fromPartition(partition);

      expect(sessionLayer._getPartition(handle)).toBe(partition);
    });
  });

  describe("clearStorageData", () => {
    it("marks session as cleared", async () => {
      const handle = sessionLayer.fromPartition("persist:clear-test");

      await sessionLayer.clearStorageData(handle);

      const state = sessionLayer._getState();
      expect(state.sessions.get(handle.id)?.cleared).toBe(true);
    });

    it("can be called multiple times", async () => {
      const handle = sessionLayer.fromPartition("persist:clear-multiple");

      await sessionLayer.clearStorageData(handle);
      await sessionLayer.clearStorageData(handle);

      const state = sessionLayer._getState();
      expect(state.sessions.get(handle.id)?.cleared).toBe(true);
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
    it("tracks handler state when set", () => {
      const handle = sessionLayer.fromPartition("persist:permission-req");

      sessionLayer.setPermissionRequestHandler(handle, () => true);

      const state = sessionLayer._getState();
      expect(state.sessions.get(handle.id)?.hasPermissionRequestHandler).toBe(true);
    });

    it("tracks handler state when cleared", () => {
      const handle = sessionLayer.fromPartition("persist:permission-req-clear");

      sessionLayer.setPermissionRequestHandler(handle, () => true);
      sessionLayer.setPermissionRequestHandler(handle, null);

      const state = sessionLayer._getState();
      expect(state.sessions.get(handle.id)?.hasPermissionRequestHandler).toBe(false);
    });

    it("throws SESSION_NOT_FOUND for invalid handle", () => {
      const fakeHandle = { id: "session-999", __brand: "SessionHandle" as const };

      expect(() => {
        sessionLayer.setPermissionRequestHandler(fakeHandle, () => true);
      }).toThrow(ShellError);
    });
  });

  describe("setPermissionCheckHandler", () => {
    it("tracks handler state when set", () => {
      const handle = sessionLayer.fromPartition("persist:permission-check");

      sessionLayer.setPermissionCheckHandler(handle, () => true);

      const state = sessionLayer._getState();
      expect(state.sessions.get(handle.id)?.hasPermissionCheckHandler).toBe(true);
    });

    it("tracks handler state when cleared", () => {
      const handle = sessionLayer.fromPartition("persist:permission-check-clear");

      sessionLayer.setPermissionCheckHandler(handle, () => true);
      sessionLayer.setPermissionCheckHandler(handle, null);

      const state = sessionLayer._getState();
      expect(state.sessions.get(handle.id)?.hasPermissionCheckHandler).toBe(false);
    });

    it("throws SESSION_NOT_FOUND for invalid handle", () => {
      const fakeHandle = { id: "session-999", __brand: "SessionHandle" as const };

      expect(() => {
        sessionLayer.setPermissionCheckHandler(fakeHandle, () => true);
      }).toThrow(ShellError);
    });
  });

  describe("dispose", () => {
    it("clears all sessions", async () => {
      sessionLayer.fromPartition("persist:dispose-1");
      sessionLayer.fromPartition("persist:dispose-2");

      await sessionLayer.dispose();

      const state = sessionLayer._getState();
      expect(state.sessions.size).toBe(0);
    });

    it("can be called on empty layer", async () => {
      await expect(sessionLayer.dispose()).resolves.not.toThrow();
    });
  });

  describe("_getState", () => {
    it("returns immutable copy of state", () => {
      const handle = sessionLayer.fromPartition("persist:state-test");

      const state1 = sessionLayer._getState();
      state1.sessions.delete(handle.id); // Attempt to modify

      const state2 = sessionLayer._getState();
      expect(state2.sessions.has(handle.id)).toBe(true);
    });
  });
});
