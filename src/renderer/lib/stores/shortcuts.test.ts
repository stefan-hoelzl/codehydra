/**
 * Tests for the shortcuts store.
 * Tests shortcut mode state and handlers.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Create mock API functions with vi.hoisted for proper hoisting
// Uses flat API namespace (no longer nested under v2)
const mockApi = vi.hoisted(() => ({
  ui: {
    setDialogMode: vi.fn().mockResolvedValue(undefined),
    focusActiveWorkspace: vi.fn().mockResolvedValue(undefined),
    switchWorkspace: vi.fn().mockResolvedValue(undefined),
    selectFolder: vi.fn().mockResolvedValue(null),
  },
  projects: {
    open: vi.fn().mockResolvedValue(undefined),
  },
}));

// Create mock dialog state with vi.hoisted
// Using Record<string, unknown> to allow flexible reassignment in tests
const mockDialogState = vi.hoisted(() => ({
  dialogState: {
    value: { type: "closed" } as Record<string, unknown>,
  },
  openCreateDialog: vi.fn(),
  openRemoveDialog: vi.fn(),
}));

// Create mock workspace type for testing
interface MockWorkspace {
  path: string;
  name: string;
  branch: string | null;
}

// WorkspaceRef type for mocking
interface MockWorkspaceRef {
  projectId: string;
  workspaceName: string;
  path: string;
}

// Create mock projects store functions
const mockProjectsStore = vi.hoisted(() => ({
  getAllWorkspaces: vi.fn((): MockWorkspace[] => []),
  getWorkspaceRefByIndex: vi.fn((index: number): MockWorkspaceRef | undefined => {
    void index;
    return undefined;
  }),
  findWorkspaceIndex: vi.fn((path: string | null): number => {
    void path;
    return -1;
  }),
  wrapIndex: vi.fn((i: number, l: number) => ((i % l) + l) % l),
  activeWorkspacePath: { value: null as string | null },
  // activeProject now has id (ProjectWithId)
  activeProject: { value: null as { id: string; path: string } | null },
  // activeWorkspace is now used for remove dialog
  activeWorkspace: { value: null as MockWorkspaceRef | null },
}));

// Mock the API module before any imports use it
vi.mock("$lib/api", () => mockApi);

// Mock the dialogs store
vi.mock("./dialogs.svelte", () => mockDialogState);

// Mock the projects store
vi.mock("./projects.svelte", () => mockProjectsStore);

// Import after mock setup
import {
  shortcutModeActive,
  handleShortcutEnable,
  handleShortcutDisable,
  handleKeyDown,
  handleKeyUp,
  handleWindowBlur,
  reset,
} from "./shortcuts.svelte";

describe("shortcuts store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reset(); // Reset store state between tests
    // Reset dialog state to closed
    mockDialogState.dialogState.value = { type: "closed" };
  });

  describe("initial state", () => {
    it("should-have-inactive-state-initially: shortcutModeActive.value is false initially", () => {
      expect(shortcutModeActive.value).toBe(false);
    });
  });

  describe("handleShortcutEnable", () => {
    it("should-enable-shortcut-mode-when-no-dialog-open: handleShortcutEnable sets active to true", () => {
      handleShortcutEnable();
      expect(shortcutModeActive.value).toBe(true);
    });

    it("should-ignore-enable-when-dialog-is-open: handleShortcutEnable ignored if dialog open", () => {
      // Set dialog state to open
      mockDialogState.dialogState.value = { type: "create", projectPath: "/test" };

      handleShortcutEnable();
      expect(shortcutModeActive.value).toBe(false);
    });
  });

  describe("handleShortcutDisable", () => {
    it("should-disable-shortcut-mode-and-restore-state: handleShortcutDisable resets state and calls APIs", () => {
      // First enable shortcut mode
      handleShortcutEnable();
      expect(shortcutModeActive.value).toBe(true);

      handleShortcutDisable();

      expect(shortcutModeActive.value).toBe(false);
      expect(mockApi.ui.setDialogMode).toHaveBeenCalledWith(false);
      expect(mockApi.ui.focusActiveWorkspace).toHaveBeenCalled();
    });

    it("should-ignore-disable-when-already-inactive: handleShortcutDisable when inactive is no-op", () => {
      handleShortcutDisable();

      expect(shortcutModeActive.value).toBe(false);
      expect(mockApi.ui.setDialogMode).not.toHaveBeenCalled();
      expect(mockApi.ui.focusActiveWorkspace).not.toHaveBeenCalled();
    });
  });

  describe("handleKeyUp", () => {
    it("should-exit-shortcut-mode-on-alt-keyup: handleKeyUp with Alt calls exitShortcutMode", () => {
      // First enable shortcut mode
      handleShortcutEnable();
      expect(shortcutModeActive.value).toBe(true);

      const event = new KeyboardEvent("keyup", { key: "Alt" });
      handleKeyUp(event);

      expect(shortcutModeActive.value).toBe(false);
      expect(mockApi.ui.setDialogMode).toHaveBeenCalledWith(false);
      expect(mockApi.ui.focusActiveWorkspace).toHaveBeenCalled();
    });

    it("should-ignore-keyup-for-non-alt-keys: handleKeyUp with other keys is ignored", () => {
      // First enable shortcut mode
      handleShortcutEnable();
      expect(shortcutModeActive.value).toBe(true);

      const event = new KeyboardEvent("keyup", { key: "x" });
      handleKeyUp(event);

      expect(shortcutModeActive.value).toBe(true);
      expect(mockApi.ui.setDialogMode).not.toHaveBeenCalled();
    });

    it("should-ignore-keyup-when-inactive: handleKeyUp when inactive is no-op", () => {
      const event = new KeyboardEvent("keyup", { key: "Alt" });
      handleKeyUp(event);

      expect(shortcutModeActive.value).toBe(false);
      expect(mockApi.ui.setDialogMode).not.toHaveBeenCalled();
      expect(mockApi.ui.focusActiveWorkspace).not.toHaveBeenCalled();
    });

    it("should-ignore-repeat-keyup-events: handleKeyUp with event.repeat=true is ignored", () => {
      // First enable shortcut mode
      handleShortcutEnable();
      expect(shortcutModeActive.value).toBe(true);

      const event = new KeyboardEvent("keyup", { key: "Alt", repeat: true });
      handleKeyUp(event);

      expect(shortcutModeActive.value).toBe(true);
      expect(mockApi.ui.setDialogMode).not.toHaveBeenCalled();
    });
  });

  describe("handleWindowBlur", () => {
    it("should-exit-shortcut-mode-on-window-blur: handleWindowBlur exits shortcut mode", () => {
      // First enable shortcut mode
      handleShortcutEnable();
      expect(shortcutModeActive.value).toBe(true);

      handleWindowBlur();

      expect(shortcutModeActive.value).toBe(false);
      expect(mockApi.ui.setDialogMode).toHaveBeenCalledWith(false);
      expect(mockApi.ui.focusActiveWorkspace).toHaveBeenCalled();
    });

    it("handleWindowBlur when inactive is no-op", () => {
      handleWindowBlur();

      expect(shortcutModeActive.value).toBe(false);
      expect(mockApi.ui.setDialogMode).not.toHaveBeenCalled();
      expect(mockApi.ui.focusActiveWorkspace).not.toHaveBeenCalled();
    });

    it("should-not-exit-shortcut-mode-on-blur-during-navigation", async () => {
      // Setup workspaces for navigation
      const workspaces = [
        { path: "/ws1", name: "ws1", branch: null },
        { path: "/ws2", name: "ws2", branch: null },
      ];
      const workspaceRefs: MockWorkspaceRef[] = [
        { projectId: "test-project-12345678", workspaceName: "ws1", path: "/ws1" },
        { projectId: "test-project-12345678", workspaceName: "ws2", path: "/ws2" },
      ];
      mockProjectsStore.getAllWorkspaces.mockReturnValue(workspaces);
      mockProjectsStore.getWorkspaceRefByIndex.mockImplementation((i: number) => workspaceRefs[i]);
      mockProjectsStore.findWorkspaceIndex.mockReturnValue(0);
      mockProjectsStore.activeWorkspacePath.value = "/ws1";

      // Make switchWorkspace slow so we can test blur during switch
      let resolveSwitch: () => void;
      mockApi.ui.switchWorkspace.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveSwitch = resolve;
          })
      );

      handleShortcutEnable();
      expect(shortcutModeActive.value).toBe(true);

      // Start navigation (this sets _switchingWorkspace = true)
      handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));

      // Simulate blur event during workspace switch (Electron triggers this)
      handleWindowBlur();

      // Should NOT exit shortcut mode because we're switching workspaces
      expect(shortcutModeActive.value).toBe(true);
      expect(mockApi.ui.setDialogMode).not.toHaveBeenCalled();
      expect(mockApi.ui.focusActiveWorkspace).not.toHaveBeenCalled();

      // Complete the switch
      resolveSwitch!();
      await Promise.resolve();
    });

    it("should-not-exit-shortcut-mode-on-blur-during-jump", async () => {
      // Setup workspaces for jump
      const workspaces = [
        { path: "/ws1", name: "ws1", branch: null },
        { path: "/ws2", name: "ws2", branch: null },
      ];
      const workspaceRefs: MockWorkspaceRef[] = [
        { projectId: "test-project-12345678", workspaceName: "ws1", path: "/ws1" },
        { projectId: "test-project-12345678", workspaceName: "ws2", path: "/ws2" },
      ];
      mockProjectsStore.getAllWorkspaces.mockReturnValue(workspaces);
      mockProjectsStore.getWorkspaceRefByIndex.mockImplementation((i: number) => workspaceRefs[i]);

      // Make switchWorkspace slow so we can test blur during switch
      let resolveSwitch: () => void;
      mockApi.ui.switchWorkspace.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveSwitch = resolve;
          })
      );

      handleShortcutEnable();
      expect(shortcutModeActive.value).toBe(true);

      // Start jump (this sets _switchingWorkspace = true)
      handleKeyDown(new KeyboardEvent("keydown", { key: "2" }));

      // Simulate blur event during workspace switch (Electron triggers this)
      handleWindowBlur();

      // Should NOT exit shortcut mode because we're switching workspaces
      expect(shortcutModeActive.value).toBe(true);
      expect(mockApi.ui.setDialogMode).not.toHaveBeenCalled();
      expect(mockApi.ui.focusActiveWorkspace).not.toHaveBeenCalled();

      // Complete the switch
      resolveSwitch!();
      await Promise.resolve();
    });

    it("should-exit-shortcut-mode-on-blur-when-not-switching", () => {
      handleShortcutEnable();
      expect(shortcutModeActive.value).toBe(true);

      // Blur without any navigation/jump in progress
      handleWindowBlur();

      // Should exit shortcut mode normally
      expect(shortcutModeActive.value).toBe(false);
      expect(mockApi.ui.setDialogMode).toHaveBeenCalledWith(false);
      expect(mockApi.ui.focusActiveWorkspace).toHaveBeenCalled();
    });
  });

  describe("exitShortcutMode API calls", () => {
    it("should-call-setDialogMode-false-on-exit: exitShortcutMode calls api.setDialogMode(false)", () => {
      handleShortcutEnable();
      handleWindowBlur(); // Uses exitShortcutMode internally

      expect(mockApi.ui.setDialogMode).toHaveBeenCalledWith(false);
    });

    it("should-call-focusActiveWorkspace-on-exit: exitShortcutMode calls api.focusActiveWorkspace()", () => {
      handleShortcutEnable();
      handleWindowBlur(); // Uses exitShortcutMode internally

      expect(mockApi.ui.focusActiveWorkspace).toHaveBeenCalled();
    });
  });

  describe("dialog state integration", () => {
    it("should-update-dialogOpen-when-dialogState-changes: $derived reactivity works", () => {
      // Dialog closed - enable should work
      mockDialogState.dialogState.value = { type: "closed" };
      handleShortcutEnable();
      expect(shortcutModeActive.value).toBe(true);

      reset();

      // Dialog open - enable should be ignored
      mockDialogState.dialogState.value = { type: "remove", workspacePath: "/test" };
      handleShortcutEnable();
      expect(shortcutModeActive.value).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should-handle-rapid-enable-disable-toggle: rapid state changes remain consistent", () => {
      handleShortcutEnable();
      expect(shortcutModeActive.value).toBe(true);

      handleShortcutDisable();
      expect(shortcutModeActive.value).toBe(false);

      handleShortcutEnable();
      expect(shortcutModeActive.value).toBe(true);

      handleShortcutDisable();
      expect(shortcutModeActive.value).toBe(false);

      // After all toggles, state should be consistent
      expect(mockApi.ui.setDialogMode).toHaveBeenCalledTimes(2); // Called on each disable
      expect(mockApi.ui.focusActiveWorkspace).toHaveBeenCalledTimes(2);
    });

    it("should-reset-state-for-testing: reset() sets state to false", () => {
      handleShortcutEnable();
      expect(shortcutModeActive.value).toBe(true);

      reset();
      expect(shortcutModeActive.value).toBe(false);
    });
  });

  describe("handleKeyDown", () => {
    beforeEach(() => {
      // Reset projects store mocks
      mockProjectsStore.getAllWorkspaces.mockReturnValue([]);
      mockProjectsStore.getWorkspaceRefByIndex.mockReturnValue(undefined);
      mockProjectsStore.findWorkspaceIndex.mockReturnValue(-1);
      mockProjectsStore.activeWorkspacePath.value = null;
      mockProjectsStore.activeProject.value = null;
    });

    it("should-ignore-keydown-when-shortcut-mode-inactive", () => {
      const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
      const preventDefaultSpy = vi.spyOn(event, "preventDefault");

      handleKeyDown(event);

      expect(preventDefaultSpy).not.toHaveBeenCalled();
      expect(mockApi.ui.switchWorkspace).not.toHaveBeenCalled();
    });

    it("should-ignore-non-action-keys", () => {
      handleShortcutEnable();
      const event = new KeyboardEvent("keydown", { key: "a" });
      const preventDefaultSpy = vi.spyOn(event, "preventDefault");

      handleKeyDown(event);

      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });

    describe("navigation actions", () => {
      const createWorkspaces = () => [
        { path: "/ws1", name: "ws1", branch: null },
        { path: "/ws2", name: "ws2", branch: null },
        { path: "/ws3", name: "ws3", branch: null },
      ];

      const createWorkspaceRefs = (): MockWorkspaceRef[] => [
        { projectId: "test-project-12345678", workspaceName: "ws1", path: "/ws1" },
        { projectId: "test-project-12345678", workspaceName: "ws2", path: "/ws2" },
        { projectId: "test-project-12345678", workspaceName: "ws3", path: "/ws3" },
      ];

      it("should-navigate-to-next-workspace-on-arrow-down", async () => {
        const workspaces = createWorkspaces();
        const workspaceRefs = createWorkspaceRefs();
        mockProjectsStore.getAllWorkspaces.mockReturnValue(workspaces);
        mockProjectsStore.getWorkspaceRefByIndex.mockImplementation(
          (i: number) => workspaceRefs[i]
        );
        mockProjectsStore.findWorkspaceIndex.mockReturnValue(0);
        mockProjectsStore.activeWorkspacePath.value = "/ws1";

        handleShortcutEnable();
        const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
        handleKeyDown(event);

        // Wait for async action to complete
        await vi.waitFor(() => {
          // Should pass projectId, workspaceName, false to keep shortcut mode active
          expect(mockApi.ui.switchWorkspace).toHaveBeenCalledWith(
            "test-project-12345678",
            "ws2",
            false
          );
        });
      });

      it("should-navigate-to-previous-workspace-on-arrow-up", async () => {
        const workspaces = createWorkspaces();
        const workspaceRefs = createWorkspaceRefs();
        mockProjectsStore.getAllWorkspaces.mockReturnValue(workspaces);
        mockProjectsStore.getWorkspaceRefByIndex.mockImplementation(
          (i: number) => workspaceRefs[i]
        );
        mockProjectsStore.findWorkspaceIndex.mockReturnValue(1);
        mockProjectsStore.activeWorkspacePath.value = "/ws2";

        handleShortcutEnable();
        const event = new KeyboardEvent("keydown", { key: "ArrowUp" });
        handleKeyDown(event);

        await vi.waitFor(() => {
          // Should pass projectId, workspaceName, false to keep shortcut mode active
          expect(mockApi.ui.switchWorkspace).toHaveBeenCalledWith(
            "test-project-12345678",
            "ws1",
            false
          );
        });
      });

      it("should-wrap-to-last-workspace-when-navigating-up-from-first", async () => {
        const workspaces = createWorkspaces();
        const workspaceRefs = createWorkspaceRefs();
        mockProjectsStore.getAllWorkspaces.mockReturnValue(workspaces);
        mockProjectsStore.getWorkspaceRefByIndex.mockImplementation(
          (i: number) => workspaceRefs[i]
        );
        mockProjectsStore.findWorkspaceIndex.mockReturnValue(0);
        mockProjectsStore.activeWorkspacePath.value = "/ws1";

        handleShortcutEnable();
        const event = new KeyboardEvent("keydown", { key: "ArrowUp" });
        handleKeyDown(event);

        await vi.waitFor(() => {
          // Should pass projectId, workspaceName, false to keep shortcut mode active
          expect(mockApi.ui.switchWorkspace).toHaveBeenCalledWith(
            "test-project-12345678",
            "ws3",
            false
          );
        });
      });

      it("should-wrap-to-first-workspace-when-navigating-down-from-last", async () => {
        const workspaces = createWorkspaces();
        const workspaceRefs = createWorkspaceRefs();
        mockProjectsStore.getAllWorkspaces.mockReturnValue(workspaces);
        mockProjectsStore.getWorkspaceRefByIndex.mockImplementation(
          (i: number) => workspaceRefs[i]
        );
        mockProjectsStore.findWorkspaceIndex.mockReturnValue(2);
        mockProjectsStore.activeWorkspacePath.value = "/ws3";

        handleShortcutEnable();
        const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
        handleKeyDown(event);

        await vi.waitFor(() => {
          // Should pass projectId, workspaceName, false to keep shortcut mode active
          expect(mockApi.ui.switchWorkspace).toHaveBeenCalledWith(
            "test-project-12345678",
            "ws1",
            false
          );
        });
      });

      it("should-not-navigate-when-no-workspaces", () => {
        mockProjectsStore.getAllWorkspaces.mockReturnValue([]);

        handleShortcutEnable();
        const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
        handleKeyDown(event);

        expect(mockApi.ui.switchWorkspace).not.toHaveBeenCalled();
      });

      it("should-not-navigate-when-single-workspace", () => {
        mockProjectsStore.getAllWorkspaces.mockReturnValue([
          { path: "/ws1", name: "ws1", branch: null },
        ]);

        handleShortcutEnable();
        const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
        handleKeyDown(event);

        expect(mockApi.ui.switchWorkspace).not.toHaveBeenCalled();
      });

      it("should-prevent-concurrent-navigation-during-rapid-keypresses", async () => {
        const workspaces = createWorkspaces();
        const workspaceRefs = createWorkspaceRefs();
        mockProjectsStore.getAllWorkspaces.mockReturnValue(workspaces);
        mockProjectsStore.getWorkspaceRefByIndex.mockImplementation(
          (i: number) => workspaceRefs[i]
        );
        mockProjectsStore.findWorkspaceIndex.mockReturnValue(0);
        mockProjectsStore.activeWorkspacePath.value = "/ws1";

        // Make switchWorkspace slow
        let resolveSwitch: () => void;
        mockApi.ui.switchWorkspace.mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              resolveSwitch = resolve;
            })
        );

        handleShortcutEnable();

        // Fire rapid keypresses
        handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
        handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
        handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));

        // Only first should have been called
        expect(mockApi.ui.switchWorkspace).toHaveBeenCalledTimes(1);

        // Complete the switch
        resolveSwitch!();
        await Promise.resolve();
      });
    });

    describe("jump actions", () => {
      const createWorkspaces = (count: number) =>
        Array.from({ length: count }, (_, i) => ({
          path: `/ws${i + 1}`,
          name: `ws${i + 1}`,
          branch: null,
        }));

      const createWorkspaceRefs = (count: number): MockWorkspaceRef[] =>
        Array.from({ length: count }, (_, i) => ({
          projectId: "test-project-12345678",
          workspaceName: `ws${i + 1}`,
          path: `/ws${i + 1}`,
        }));

      it("should-jump-to-workspace-1-through-9", async () => {
        const workspaces = createWorkspaces(9);
        const workspaceRefs = createWorkspaceRefs(9);
        mockProjectsStore.getAllWorkspaces.mockReturnValue(workspaces);
        mockProjectsStore.getWorkspaceRefByIndex.mockImplementation(
          (i: number) => workspaceRefs[i]
        );

        handleShortcutEnable();

        // Test key "5" -> index 4 -> workspace 5
        handleKeyDown(new KeyboardEvent("keydown", { key: "5" }));

        await vi.waitFor(() => {
          // Should pass projectId, workspaceName, false to keep shortcut mode active
          expect(mockApi.ui.switchWorkspace).toHaveBeenCalledWith(
            "test-project-12345678",
            "ws5",
            false
          );
        });
      });

      it("should-jump-to-workspace-10-on-key-0", async () => {
        const workspaces = createWorkspaces(10);
        const workspaceRefs = createWorkspaceRefs(10);
        mockProjectsStore.getAllWorkspaces.mockReturnValue(workspaces);
        mockProjectsStore.getWorkspaceRefByIndex.mockImplementation(
          (i: number) => workspaceRefs[i]
        );

        handleShortcutEnable();
        handleKeyDown(new KeyboardEvent("keydown", { key: "0" }));

        await vi.waitFor(() => {
          // Should pass projectId, workspaceName, false to keep shortcut mode active
          expect(mockApi.ui.switchWorkspace).toHaveBeenCalledWith(
            "test-project-12345678",
            "ws10",
            false
          );
        });
      });

      it("should-not-jump-when-index-out-of-range", () => {
        const workspaces = createWorkspaces(3);
        const workspaceRefs = createWorkspaceRefs(3);
        mockProjectsStore.getAllWorkspaces.mockReturnValue(workspaces);
        mockProjectsStore.getWorkspaceRefByIndex.mockImplementation(
          (i: number) => workspaceRefs[i]
        );

        handleShortcutEnable();
        // Try to jump to workspace 5 when only 3 exist
        handleKeyDown(new KeyboardEvent("keydown", { key: "5" }));

        expect(mockApi.ui.switchWorkspace).not.toHaveBeenCalled();
      });
    });

    describe("dialog actions", () => {
      it("should-open-create-dialog-on-enter", () => {
        // activeProject now has id (ProjectWithId)
        mockProjectsStore.activeProject.value = { id: "project-12345678", path: "/project" };

        handleShortcutEnable();
        expect(shortcutModeActive.value).toBe(true);

        handleKeyDown(new KeyboardEvent("keydown", { key: "Enter" }));

        // Now passes projectId instead of path
        expect(mockDialogState.openCreateDialog).toHaveBeenCalledWith("project-12345678");
        expect(shortcutModeActive.value).toBe(false);
      });

      it("should-not-open-create-dialog-when-no-active-project", () => {
        mockProjectsStore.activeProject.value = null;

        handleShortcutEnable();
        handleKeyDown(new KeyboardEvent("keydown", { key: "Enter" }));

        expect(mockDialogState.openCreateDialog).not.toHaveBeenCalled();
      });

      it("should-open-remove-dialog-on-delete", () => {
        // Now uses activeWorkspace (WorkspaceRef) instead of activeWorkspacePath
        const workspaceRef = {
          projectId: "project-12345678",
          workspaceName: "feature",
          path: "/workspace",
        };
        mockProjectsStore.activeWorkspace.value = workspaceRef;

        handleShortcutEnable();
        expect(shortcutModeActive.value).toBe(true);

        handleKeyDown(new KeyboardEvent("keydown", { key: "Delete" }));

        // Now passes WorkspaceRef instead of path
        expect(mockDialogState.openRemoveDialog).toHaveBeenCalledWith(workspaceRef);
        expect(shortcutModeActive.value).toBe(false);
      });

      it("should-open-remove-dialog-on-backspace", () => {
        const workspaceRef = {
          projectId: "project-12345678",
          workspaceName: "feature",
          path: "/workspace",
        };
        mockProjectsStore.activeWorkspace.value = workspaceRef;

        handleShortcutEnable();
        handleKeyDown(new KeyboardEvent("keydown", { key: "Backspace" }));

        expect(mockDialogState.openRemoveDialog).toHaveBeenCalledWith(workspaceRef);
      });

      it("should-not-open-remove-dialog-when-no-active-workspace", () => {
        mockProjectsStore.activeWorkspace.value = null;

        handleShortcutEnable();
        handleKeyDown(new KeyboardEvent("keydown", { key: "Delete" }));

        expect(mockDialogState.openRemoveDialog).not.toHaveBeenCalled();
      });

      it("should-deactivate-shortcut-mode-before-opening-dialog", () => {
        mockProjectsStore.activeProject.value = {
          id: "test-project-12345678",
          path: "/project",
        };

        handleShortcutEnable();
        expect(shortcutModeActive.value).toBe(true);

        handleKeyDown(new KeyboardEvent("keydown", { key: "Enter" }));

        expect(shortcutModeActive.value).toBe(false);
      });
    });

    describe("project actions", () => {
      it("should-trigger-folder-picker-on-o-key", async () => {
        handleShortcutEnable();
        handleKeyDown(new KeyboardEvent("keydown", { key: "o" }));

        await vi.waitFor(() => {
          expect(mockApi.ui.selectFolder).toHaveBeenCalled();
        });
      });

      it("should-trigger-folder-picker-on-O-key", async () => {
        handleShortcutEnable();
        handleKeyDown(new KeyboardEvent("keydown", { key: "O" }));

        await vi.waitFor(() => {
          expect(mockApi.ui.selectFolder).toHaveBeenCalled();
        });
      });

      it("should-deactivate-shortcut-mode-before-opening-folder-picker", async () => {
        handleShortcutEnable();
        expect(shortcutModeActive.value).toBe(true);

        handleKeyDown(new KeyboardEvent("keydown", { key: "o" }));

        // Mode should be deactivated immediately
        expect(shortcutModeActive.value).toBe(false);
      });

      it("should-open-project-when-folder-selected", async () => {
        mockApi.ui.selectFolder.mockResolvedValue("/selected/path");

        handleShortcutEnable();
        handleKeyDown(new KeyboardEvent("keydown", { key: "o" }));

        await vi.waitFor(() => {
          expect(mockApi.projects.open).toHaveBeenCalledWith("/selected/path");
        });
      });

      it("should-not-open-project-when-folder-selection-cancelled", async () => {
        mockApi.ui.selectFolder.mockResolvedValue(null);

        handleShortcutEnable();
        handleKeyDown(new KeyboardEvent("keydown", { key: "o" }));

        await vi.waitFor(() => {
          expect(mockApi.ui.selectFolder).toHaveBeenCalled();
        });

        expect(mockApi.projects.open).not.toHaveBeenCalled();
      });
    });

    describe("error handling", () => {
      it("should-log-error-when-workspace-switch-fails", async () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const workspaces = [
          { path: "/ws1", name: "ws1", branch: null },
          { path: "/ws2", name: "ws2", branch: null },
        ];
        const workspaceRefs: MockWorkspaceRef[] = [
          { projectId: "test-project-12345678", workspaceName: "ws1", path: "/ws1" },
          { projectId: "test-project-12345678", workspaceName: "ws2", path: "/ws2" },
        ];
        mockProjectsStore.getAllWorkspaces.mockReturnValue(workspaces);
        mockProjectsStore.getWorkspaceRefByIndex.mockImplementation(
          (i: number) => workspaceRefs[i]
        );
        mockProjectsStore.findWorkspaceIndex.mockReturnValue(0);
        mockProjectsStore.activeWorkspacePath.value = "/ws1";
        mockApi.ui.switchWorkspace.mockRejectedValue(new Error("Switch failed"));

        handleShortcutEnable();
        handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));

        await vi.waitFor(() => {
          expect(consoleSpy).toHaveBeenCalledWith("Failed to switch workspace:", expect.any(Error));
        });

        // Verify the call was made with projectId, workspaceName, false
        expect(mockApi.ui.switchWorkspace).toHaveBeenCalledWith(
          "test-project-12345678",
          "ws2",
          false
        );

        consoleSpy.mockRestore();
      });
    });
  });
});
