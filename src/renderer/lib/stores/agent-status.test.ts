/**
 * Tests for the agent status store.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Api } from "@shared/electron-api";
import type { AggregatedAgentStatus } from "@shared/ipc";
import type { ProjectId, WorkspaceName, WorkspaceRef } from "@shared/api/types";
import { createMockApi } from "../test-utils";

// Create mock API (flat structure)
const mockApi: Api = createMockApi();

// Set up window.api before importing the store
window.api = mockApi;

// Import store after setting up mock
import { updateStatus, setAllStatuses, getStatus, reset } from "./agent-status.svelte.js";

describe("agent status store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reset();
  });

  describe("getStatus", () => {
    it("returns 'none' status with zero counts for unknown workspace", () => {
      const status = getStatus("/unknown/path");

      expect(status).toEqual({
        status: "none",
        counts: { idle: 0, busy: 0 },
      });
    });

    it("returns stored status for known workspace", () => {
      const path = "/test/.worktrees/feature";
      const expected: AggregatedAgentStatus = {
        status: "busy",
        counts: { idle: 0, busy: 2 },
      };

      updateStatus(path, expected);

      expect(getStatus(path)).toEqual(expected);
    });
  });

  describe("updateStatus", () => {
    it("sets status for a workspace", () => {
      const path = "/test/.worktrees/ws1";
      const status: AggregatedAgentStatus = {
        status: "idle",
        counts: { idle: 3, busy: 0 },
      };

      updateStatus(path, status);

      expect(getStatus(path)).toEqual(status);
    });

    it("updates existing status for a workspace", () => {
      const path = "/test/.worktrees/ws1";
      const initial: AggregatedAgentStatus = {
        status: "idle",
        counts: { idle: 1, busy: 0 },
      };
      const updated: AggregatedAgentStatus = {
        status: "busy",
        counts: { idle: 0, busy: 1 },
      };

      updateStatus(path, initial);
      updateStatus(path, updated);

      expect(getStatus(path)).toEqual(updated);
    });

    it("handles multiple workspaces independently", () => {
      const path1 = "/test/.worktrees/ws1";
      const path2 = "/test/.worktrees/ws2";
      const status1: AggregatedAgentStatus = {
        status: "idle",
        counts: { idle: 1, busy: 0 },
      };
      const status2: AggregatedAgentStatus = {
        status: "busy",
        counts: { idle: 0, busy: 2 },
      };

      updateStatus(path1, status1);
      updateStatus(path2, status2);

      expect(getStatus(path1)).toEqual(status1);
      expect(getStatus(path2)).toEqual(status2);
    });
  });

  describe("setAllStatuses", () => {
    it("sets multiple statuses at once from record", () => {
      const statuses: Record<string, AggregatedAgentStatus> = {
        "/test/.worktrees/ws1": { status: "idle", counts: { idle: 1, busy: 0 } },
        "/test/.worktrees/ws2": { status: "busy", counts: { idle: 0, busy: 1 } },
        "/test/.worktrees/ws3": { status: "mixed", counts: { idle: 1, busy: 1 } },
      };

      setAllStatuses(statuses);

      expect(getStatus("/test/.worktrees/ws1")).toEqual(statuses["/test/.worktrees/ws1"]);
      expect(getStatus("/test/.worktrees/ws2")).toEqual(statuses["/test/.worktrees/ws2"]);
      expect(getStatus("/test/.worktrees/ws3")).toEqual(statuses["/test/.worktrees/ws3"]);
    });

    it("clears existing statuses before setting new ones", () => {
      const initial: AggregatedAgentStatus = {
        status: "idle",
        counts: { idle: 1, busy: 0 },
      };
      updateStatus("/test/.worktrees/old", initial);

      const newStatuses: Record<string, AggregatedAgentStatus> = {
        "/test/.worktrees/new": { status: "busy", counts: { idle: 0, busy: 1 } },
      };

      setAllStatuses(newStatuses);

      // Old workspace should now return default 'none' status
      expect(getStatus("/test/.worktrees/old")).toEqual({
        status: "none",
        counts: { idle: 0, busy: 0 },
      });
      expect(getStatus("/test/.worktrees/new")).toEqual(newStatuses["/test/.worktrees/new"]);
    });

    it("handles empty record", () => {
      updateStatus("/test/.worktrees/ws1", { status: "idle", counts: { idle: 1, busy: 0 } });

      setAllStatuses({});

      expect(getStatus("/test/.worktrees/ws1")).toEqual({
        status: "none",
        counts: { idle: 0, busy: 0 },
      });
    });
  });

  describe("reset", () => {
    it("clears all stored statuses", () => {
      updateStatus("/test/.worktrees/ws1", { status: "idle", counts: { idle: 1, busy: 0 } });
      updateStatus("/test/.worktrees/ws2", { status: "busy", counts: { idle: 0, busy: 1 } });

      reset();

      expect(getStatus("/test/.worktrees/ws1")).toEqual({
        status: "none",
        counts: { idle: 0, busy: 0 },
      });
      expect(getStatus("/test/.worktrees/ws2")).toEqual({
        status: "none",
        counts: { idle: 0, busy: 0 },
      });
    });
  });

  // =============================================================================
  // New v2 API Tests (Step 5.5 - TDD RED)
  // These tests use type assertions to test not-yet-implemented features.
  // =============================================================================

  describe("getStatusByRef (v2)", () => {
    it("returns status for workspace by WorkspaceRef", async () => {
      // Dynamic import with type assertion for not-yet-implemented feature
      const store = (await import("./agent-status.svelte.js")) as unknown as {
        reset: () => void;
        updateStatusByRef: (ref: WorkspaceRef, status: AggregatedAgentStatus) => void;
        getStatusByRef: (ref: {
          projectId: ProjectId;
          workspaceName: WorkspaceName;
        }) => AggregatedAgentStatus;
      };
      store.reset();

      const ref: WorkspaceRef = {
        projectId: "my-app-12345678" as ProjectId,
        workspaceName: "feature" as WorkspaceName,
        path: "/test/.worktrees/feature",
      };

      const status: AggregatedAgentStatus = { status: "busy", counts: { idle: 0, busy: 2 } };
      store.updateStatusByRef(ref, status);

      const result = store.getStatusByRef({
        projectId: "my-app-12345678" as ProjectId,
        workspaceName: "feature" as WorkspaceName,
      });
      expect(result).toEqual(status);
    });

    it("returns 'none' status for unknown WorkspaceRef", async () => {
      const store = (await import("./agent-status.svelte.js")) as unknown as {
        reset: () => void;
        getStatusByRef: (ref: {
          projectId: ProjectId;
          workspaceName: WorkspaceName;
        }) => AggregatedAgentStatus;
      };
      store.reset();

      const result = store.getStatusByRef({
        projectId: "unknown-12345678" as ProjectId,
        workspaceName: "unknown" as WorkspaceName,
      });

      expect(result).toEqual({
        status: "none",
        counts: { idle: 0, busy: 0 },
      });
    });
  });

  describe("updateStatusByRef (v2)", () => {
    it("stores status using composite key", async () => {
      const store = (await import("./agent-status.svelte.js")) as unknown as {
        reset: () => void;
        updateStatusByRef: (ref: WorkspaceRef, status: AggregatedAgentStatus) => void;
        getStatusByRef: (ref: {
          projectId: ProjectId;
          workspaceName: WorkspaceName;
        }) => AggregatedAgentStatus;
      };
      store.reset();

      const ref1: WorkspaceRef = {
        projectId: "app-a-12345678" as ProjectId,
        workspaceName: "feature" as WorkspaceName,
        path: "/app-a/feature",
      };
      const ref2: WorkspaceRef = {
        projectId: "app-b-87654321" as ProjectId,
        workspaceName: "feature" as WorkspaceName, // Same workspace name, different project
        path: "/app-b/feature",
      };

      store.updateStatusByRef(ref1, { status: "idle", counts: { idle: 1, busy: 0 } });
      store.updateStatusByRef(ref2, { status: "busy", counts: { idle: 0, busy: 1 } });

      // Should be stored separately even with same workspace name
      expect(
        store.getStatusByRef({ projectId: ref1.projectId, workspaceName: ref1.workspaceName })
      ).toEqual({
        status: "idle",
        counts: { idle: 1, busy: 0 },
      });
      expect(
        store.getStatusByRef({ projectId: ref2.projectId, workspaceName: ref2.workspaceName })
      ).toEqual({
        status: "busy",
        counts: { idle: 0, busy: 1 },
      });
    });
  });

  describe("setAllStatusesByRef (v2)", () => {
    it("sets multiple statuses using composite keys", async () => {
      const store = (await import("./agent-status.svelte.js")) as unknown as {
        reset: () => void;
        setAllStatusesByRef: (statuses: Map<string, AggregatedAgentStatus>) => void;
        getStatusByRef: (ref: {
          projectId: ProjectId;
          workspaceName: WorkspaceName;
        }) => AggregatedAgentStatus;
      };
      store.reset();

      // Map uses composite key format: "projectId/workspaceName"
      const statuses = new Map<string, AggregatedAgentStatus>([
        ["app-12345678/feature", { status: "idle", counts: { idle: 1, busy: 0 } }],
        ["app-12345678/bugfix", { status: "busy", counts: { idle: 0, busy: 2 } }],
      ]);

      store.setAllStatusesByRef(statuses);

      expect(
        store.getStatusByRef({
          projectId: "app-12345678" as ProjectId,
          workspaceName: "feature" as WorkspaceName,
        })
      ).toEqual({ status: "idle", counts: { idle: 1, busy: 0 } });

      expect(
        store.getStatusByRef({
          projectId: "app-12345678" as ProjectId,
          workspaceName: "bugfix" as WorkspaceName,
        })
      ).toEqual({ status: "busy", counts: { idle: 0, busy: 2 } });
    });
  });
});
