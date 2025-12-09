/**
 * Tests for domain event subscription helper.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Project, ProjectPath } from "@shared/ipc";
import { setupDomainEvents, type DomainEventApi, type DomainStores } from "./domain-events";

// Helper to create typed ProjectPath
function asProjectPath(path: string): ProjectPath {
  return path as ProjectPath;
}

describe("setupDomainEvents", () => {
  let mockApi: DomainEventApi;
  let mockStores: DomainStores;
  let projectOpenedCallback: ((event: { project: Project }) => void) | null = null;

  beforeEach(() => {
    projectOpenedCallback = null;

    // Create mock API with captured callbacks
    mockApi = {
      onProjectOpened: vi.fn((cb) => {
        projectOpenedCallback = cb;
        return vi.fn();
      }),
      onProjectClosed: vi.fn(() => vi.fn()),
      onWorkspaceCreated: vi.fn(() => vi.fn()),
      onWorkspaceRemoved: vi.fn(() => vi.fn()),
      onWorkspaceSwitched: vi.fn(() => vi.fn()),
      onAgentStatusChanged: vi.fn(() => vi.fn()),
    };

    // Create mock stores
    mockStores = {
      addProject: vi.fn(),
      removeProject: vi.fn(),
      addWorkspace: vi.fn(),
      removeWorkspace: vi.fn(),
      setActiveWorkspace: vi.fn(),
      updateAgentStatus: vi.fn(),
    };
  });

  describe("hooks", () => {
    it("calls onProjectOpenedHook after addProject when provided", () => {
      const hookSpy = vi.fn();

      setupDomainEvents(mockApi, mockStores, {
        onProjectOpenedHook: hookSpy,
      });

      // Simulate project opened event
      const newProject: Project = {
        path: asProjectPath("/test/project"),
        name: "test-project",
        workspaces: [],
      };
      projectOpenedCallback!({ project: newProject });

      // Verify addProject was called first
      expect(mockStores.addProject).toHaveBeenCalledWith(newProject);
      // Verify hook was called with the project
      expect(hookSpy).toHaveBeenCalledWith(newProject);
    });

    it("works without hooks (backward compatible)", () => {
      // Should not throw when no hooks provided
      expect(() => {
        setupDomainEvents(mockApi, mockStores);
      }).not.toThrow();

      // Simulate project opened event
      const newProject: Project = {
        path: asProjectPath("/test/project"),
        name: "test-project",
        workspaces: [],
      };
      projectOpenedCallback!({ project: newProject });

      // Verify addProject was still called
      expect(mockStores.addProject).toHaveBeenCalledWith(newProject);
    });

    it("does not call hook when not provided", () => {
      setupDomainEvents(mockApi, mockStores);

      // Simulate project opened event
      const newProject: Project = {
        path: asProjectPath("/test/project"),
        name: "test-project",
        workspaces: [],
      };

      // This should not throw even though no hook is provided
      expect(() => {
        projectOpenedCallback!({ project: newProject });
      }).not.toThrow();
    });
  });

  describe("cleanup", () => {
    it("returns cleanup function that unsubscribes all events", () => {
      const unsubFns = {
        projectOpened: vi.fn(),
        projectClosed: vi.fn(),
        workspaceCreated: vi.fn(),
        workspaceRemoved: vi.fn(),
        workspaceSwitched: vi.fn(),
        agentStatusChanged: vi.fn(),
      };

      mockApi.onProjectOpened = vi.fn(() => unsubFns.projectOpened);
      mockApi.onProjectClosed = vi.fn(() => unsubFns.projectClosed);
      mockApi.onWorkspaceCreated = vi.fn(() => unsubFns.workspaceCreated);
      mockApi.onWorkspaceRemoved = vi.fn(() => unsubFns.workspaceRemoved);
      mockApi.onWorkspaceSwitched = vi.fn(() => unsubFns.workspaceSwitched);
      mockApi.onAgentStatusChanged = vi.fn(() => unsubFns.agentStatusChanged);

      const cleanup = setupDomainEvents(mockApi, mockStores);

      // Call cleanup
      cleanup();

      // Verify all unsubscribe functions were called
      expect(unsubFns.projectOpened).toHaveBeenCalled();
      expect(unsubFns.projectClosed).toHaveBeenCalled();
      expect(unsubFns.workspaceCreated).toHaveBeenCalled();
      expect(unsubFns.workspaceRemoved).toHaveBeenCalled();
      expect(unsubFns.workspaceSwitched).toHaveBeenCalled();
      expect(unsubFns.agentStatusChanged).toHaveBeenCalled();
    });
  });
});
