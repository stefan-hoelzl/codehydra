/**
 * Tests for the dialog state store.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Create mock functions for projects store
const { mockActiveProject, mockProjects } = vi.hoisted(() => ({
  mockActiveProject: vi.fn(),
  mockProjects: vi.fn(),
}));

// Mock $lib/stores/projects.svelte.js
vi.mock("./projects.svelte.js", () => ({
  activeProject: {
    get value() {
      return mockActiveProject();
    },
  },
  projects: {
    get value() {
      return mockProjects();
    },
  },
}));

// Import after mocks
import {
  dialogState,
  openCreateDialog,
  openRemoveDialog,
  closeDialog,
  reset,
} from "./dialogs.svelte.js";

describe("dialog state store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reset();
  });

  afterEach(() => {
    // Clean up any test elements
    document.body.innerHTML = "";
  });

  describe("initial state", () => {
    it("initializes with type 'closed'", () => {
      expect(dialogState.value).toEqual({ type: "closed" });
    });
  });

  describe("openCreateDialog", () => {
    it("sets type to 'create' with explicit projectPath", () => {
      openCreateDialog("/test/project");

      expect(dialogState.value).toEqual({
        type: "create",
        projectPath: "/test/project",
      });
    });

    it("uses provided defaultProjectPath when specified", () => {
      // Setup mocks to return different values
      mockActiveProject.mockReturnValue({ path: "/active/project", name: "active" });
      mockProjects.mockReturnValue([
        { path: "/first/project", name: "first" },
        { path: "/second/project", name: "second" },
      ]);

      // Open with explicit path - should use that, not active or first
      openCreateDialog("/explicit/project");

      expect(dialogState.value).toEqual({
        type: "create",
        projectPath: "/explicit/project",
      });
    });

    it("uses activeProject when no defaultProjectPath provided", () => {
      mockActiveProject.mockReturnValue({ path: "/active/project", name: "active" });
      mockProjects.mockReturnValue([
        { path: "/first/project", name: "first" },
        { path: "/second/project", name: "second" },
      ]);

      // Open without path - should use activeProject
      openCreateDialog();

      expect(dialogState.value).toEqual({
        type: "create",
        projectPath: "/active/project",
      });
    });

    it("uses first project when no active and no defaultProjectPath", () => {
      mockActiveProject.mockReturnValue(null);
      mockProjects.mockReturnValue([
        { path: "/first/project", name: "first" },
        { path: "/second/project", name: "second" },
      ]);

      // Open without path and no active - should use first project
      openCreateDialog();

      expect(dialogState.value).toEqual({
        type: "create",
        projectPath: "/first/project",
      });
    });

    it("uses empty string when no projects available", () => {
      mockActiveProject.mockReturnValue(null);
      mockProjects.mockReturnValue([]);

      // Open with no projects - should fallback to empty string
      openCreateDialog();

      expect(dialogState.value).toEqual({
        type: "create",
        projectPath: "",
      });
    });
  });

  describe("openRemoveDialog", () => {
    it("sets type to 'remove' with workspacePath", () => {
      openRemoveDialog("/test/project/.worktrees/ws1");

      expect(dialogState.value).toEqual({
        type: "remove",
        workspacePath: "/test/project/.worktrees/ws1",
      });
    });
  });

  describe("closeDialog", () => {
    it("sets type to 'closed'", () => {
      openCreateDialog("/test/project");
      closeDialog();

      expect(dialogState.value).toEqual({ type: "closed" });
    });
  });

  describe("opening new dialog closes previous (exclusive)", () => {
    it("opening create dialog after remove closes remove", () => {
      openRemoveDialog("/test/workspace");
      expect(dialogState.value.type).toBe("remove");

      openCreateDialog("/test/project");
      expect(dialogState.value.type).toBe("create");
    });

    it("opening remove dialog after create closes create", () => {
      openCreateDialog("/test/project");
      expect(dialogState.value.type).toBe("create");

      openRemoveDialog("/test/workspace");
      expect(dialogState.value.type).toBe("remove");
    });
  });
});
