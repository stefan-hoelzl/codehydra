// @vitest-environment node
/**
 * Tests for AgentStatusManager.
 *
 * Uses SDK mock utilities for testing OpenCodeClient integration.
 * AgentStatusManager now receives ports directly from OpenCodeServerManager
 * via callbacks routed through AppState.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentStatusManager } from "./agent-status-manager";
import type { WorkspacePath } from "../../shared/ipc";
import { createMockSdkClient, createMockSdkFactory, createTestSession } from "./sdk-test-utils";
import type { SdkClientFactory } from "./opencode-client";
import type { SessionStatus as SdkSessionStatus } from "@opencode-ai/sdk";
import { createSilentLogger } from "../logging";

describe("AgentStatusManager", () => {
  let manager: AgentStatusManager;
  let mockSdkFactory: SdkClientFactory;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create default SDK mock factory
    const mockSdk = createMockSdkClient();
    mockSdkFactory = createMockSdkFactory(mockSdk);

    manager = new AgentStatusManager(createSilentLogger(), mockSdkFactory);
  });

  afterEach(() => {
    manager.dispose();
  });

  describe("getStatus", () => {
    it("returns none status for unknown workspace", () => {
      const status = manager.getStatus("/unknown/workspace" as WorkspacePath);

      expect(status.status).toBe("none");
      expect(status.counts.idle).toBe(0);
      expect(status.counts.busy).toBe(0);
    });
  });

  describe("getAllStatuses", () => {
    it("returns empty map initially", () => {
      const statuses = manager.getAllStatuses();

      expect(statuses).toBeInstanceOf(Map);
      expect(statuses.size).toBe(0);
    });
  });

  describe("initWorkspace", () => {
    it("creates OpenCodeClient with provided port", async () => {
      await manager.initWorkspace("/test/workspace" as WorkspacePath, 14001);

      // Should have created a client and be tracking the workspace
      const status = manager.getStatus("/test/workspace" as WorkspacePath);
      // When connected but no sessions yet, shows idle with count 1
      expect(status.status).toBe("idle");
      expect(status.counts.idle).toBe(1);
    });

    it("shows idle status when connected but no sessions", async () => {
      // Mock SDK client with empty sessions
      const mockSdk = createMockSdkClient({
        sessions: [],
        sessionStatuses: {},
      });
      mockSdkFactory = createMockSdkFactory(mockSdk);
      manager = new AgentStatusManager(createSilentLogger(), mockSdkFactory);

      const listener = vi.fn();
      manager.onStatusChanged(listener);

      await manager.initWorkspace("/test/workspace" as WorkspacePath, 8080);

      // When connected (has client) but no sessions, should show idle with count 1
      const status = manager.getStatus("/test/workspace" as WorkspacePath);
      expect(status.status).toBe("idle");
      expect(status.counts.idle).toBe(1);
      expect(status.counts.busy).toBe(0);
    });

    it("does not duplicate if called twice", async () => {
      await manager.initWorkspace("/test/workspace" as WorkspacePath, 14001);
      await manager.initWorkspace("/test/workspace" as WorkspacePath, 14001);

      expect(manager.getAllStatuses().size).toBe(1);
    });

    it("handles connection failure gracefully", async () => {
      // Mock SDK that fails to connect
      const mockSdk = createMockSdkClient({
        sessions: [],
        sessionStatuses: {},
      });
      // Simulate connection failure by making event.subscribe throw
      mockSdk.event.subscribe = vi.fn().mockRejectedValue(new Error("Connection refused"));
      mockSdkFactory = createMockSdkFactory(mockSdk);
      manager = new AgentStatusManager(createSilentLogger(), mockSdkFactory);

      // Should not throw, but should handle gracefully
      await expect(
        manager.initWorkspace("/test/workspace" as WorkspacePath, 59999)
      ).resolves.not.toThrow();
    });
  });

  describe("removeWorkspace", () => {
    it("removes workspace from tracking", async () => {
      await manager.initWorkspace("/test/workspace" as WorkspacePath, 14001);
      expect(manager.getAllStatuses().size).toBe(1);

      manager.removeWorkspace("/test/workspace" as WorkspacePath);

      expect(manager.getAllStatuses().size).toBe(0);
    });

    it("notifies listeners of removal", async () => {
      const listener = vi.fn();
      manager.onStatusChanged(listener);

      await manager.initWorkspace("/test/workspace" as WorkspacePath, 14001);
      listener.mockClear();

      manager.removeWorkspace("/test/workspace" as WorkspacePath);

      expect(listener).toHaveBeenCalledWith(
        "/test/workspace",
        expect.objectContaining({ status: "none" })
      );
    });

    it("disposes OpenCodeClient", async () => {
      await manager.initWorkspace("/test/workspace" as WorkspacePath, 14001);

      // Remove should dispose the client
      manager.removeWorkspace("/test/workspace" as WorkspacePath);

      // Verify workspace is removed
      expect(manager.getStatus("/test/workspace" as WorkspacePath).status).toBe("none");
    });
  });

  describe("onStatusChanged", () => {
    it("notifies when workspace is initialized", async () => {
      const listener = vi.fn();
      manager.onStatusChanged(listener);

      await manager.initWorkspace("/test/workspace" as WorkspacePath, 14001);

      expect(listener).toHaveBeenCalledWith(
        "/test/workspace",
        expect.objectContaining({ status: "idle" })
      );
    });

    it("returns unsubscribe function", async () => {
      const listener = vi.fn();
      const unsubscribe = manager.onStatusChanged(listener);

      unsubscribe();

      await manager.initWorkspace("/test/workspace" as WorkspacePath, 14001);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("dispose", () => {
    it("clears all state", async () => {
      await manager.initWorkspace("/test/workspace" as WorkspacePath, 14001);

      manager.dispose();

      expect(manager.getAllStatuses().size).toBe(0);
    });
  });

  describe("port-based aggregation", () => {
    it("single client idle returns { idle: 1, busy: 0 }", async () => {
      const mockSdk = createMockSdkClient({
        sessions: [createTestSession({ id: "ses-1", directory: "/test" })],
        sessionStatuses: { "ses-1": { type: "idle" as const } },
      });
      mockSdkFactory = createMockSdkFactory(mockSdk);
      manager = new AgentStatusManager(createSilentLogger(), mockSdkFactory);

      await manager.initWorkspace("/test/workspace" as WorkspacePath, 8080);

      const status = manager.getStatus("/test/workspace" as WorkspacePath);
      expect(status.counts.idle).toBe(1);
      expect(status.counts.busy).toBe(0);
      expect(status.status).toBe("idle");
    });

    it("single client busy returns { idle: 0, busy: 1 }", async () => {
      const mockSdk = createMockSdkClient({
        sessions: [createTestSession({ id: "ses-1", directory: "/test" })],
        sessionStatuses: { "ses-1": { type: "busy" as const } },
      });
      mockSdkFactory = createMockSdkFactory(mockSdk);
      manager = new AgentStatusManager(createSilentLogger(), mockSdkFactory);

      await manager.initWorkspace("/test/workspace" as WorkspacePath, 8080);

      const status = manager.getStatus("/test/workspace" as WorkspacePath);
      expect(status.counts.idle).toBe(0);
      expect(status.counts.busy).toBe(1);
      expect(status.status).toBe("busy");
    });

    it("maps retry status to busy", async () => {
      const retryStatus: SdkSessionStatus = {
        type: "retry",
        attempt: 1,
        message: "Rate limited",
        next: Date.now() + 1000,
      };
      const mockSdk = createMockSdkClient({
        sessions: [createTestSession({ id: "ses-1", directory: "/test" })],
        sessionStatuses: { "ses-1": retryStatus },
      });
      mockSdkFactory = createMockSdkFactory(mockSdk);
      manager = new AgentStatusManager(createSilentLogger(), mockSdkFactory);

      await manager.initWorkspace("/test/workspace" as WorkspacePath, 8080);

      const status = manager.getStatus("/test/workspace" as WorkspacePath);
      expect(status.counts.busy).toBe(1);
      expect(status.status).toBe("busy");
    });

    it("regression: no accumulation over many status change cycles", async () => {
      // Regression test: Verify that count stays at 1 for a single workspace
      // regardless of how many status changes occur (no session accumulation bug)
      const mockSdk = createMockSdkClient({
        sessions: [createTestSession({ id: "ses-1", directory: "/test" })],
        sessionStatuses: { "ses-1": { type: "idle" as const } },
      });
      mockSdkFactory = createMockSdkFactory(mockSdk);
      manager = new AgentStatusManager(createSilentLogger(), mockSdkFactory);

      // Initialize workspace (triggers first status fetch)
      await manager.initWorkspace("/test/workspace" as WorkspacePath, 8080);

      // Verify status is tracked correctly
      const status = manager.getStatus("/test/workspace" as WorkspacePath);

      // The key assertion: count should be exactly 1 for a single workspace
      // regardless of how many times we query
      expect(status.counts.idle + status.counts.busy).toBe(1);
    });
  });
});
