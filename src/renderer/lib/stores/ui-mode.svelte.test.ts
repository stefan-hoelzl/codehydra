/**
 * Tests for the ui-mode store.
 * Central store that manages UI mode state and syncs with main process.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync } from "svelte";

// Create mock API with vi.hoisted for proper hoisting
const mockApi = vi.hoisted(() => ({
  ui: {
    setMode: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock the API module before any imports use it
vi.mock("$lib/api", () => mockApi);

// Import after mock setup
import {
  uiMode,
  desiredMode,
  shortcutModeActive,
  setModeFromMain,
  setDialogOpen,
  setSidebarExpanded,
  computeDesiredMode,
  syncMode,
  reset,
} from "./ui-mode.svelte";

describe("ui-mode store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reset();
  });

  afterEach(() => {
    reset();
  });

  describe("initial state", () => {
    it("initial state is workspace mode", () => {
      expect(uiMode.value).toBe("workspace");
      expect(desiredMode.value).toBe("workspace");
      expect(shortcutModeActive.value).toBe(false);
    });
  });

  describe("computeDesiredMode pure function", () => {
    it("modeFromMain='shortcut' takes priority even when dialogOpen=true and sidebarExpanded=true", () => {
      expect(computeDesiredMode("shortcut", true, true)).toBe("shortcut");
    });

    it("dialogOpen=true results in desiredMode='dialog'", () => {
      expect(computeDesiredMode("workspace", true, false)).toBe("dialog");
    });

    it("sidebarExpanded=true results in desiredMode='dialog'", () => {
      expect(computeDesiredMode("workspace", false, true)).toBe("dialog");
    });

    it("both dialogOpen=true and sidebarExpanded=true results in desiredMode='dialog'", () => {
      expect(computeDesiredMode("workspace", true, true)).toBe("dialog");
    });

    it("all inputs false/workspace results in desiredMode='workspace'", () => {
      expect(computeDesiredMode("workspace", false, false)).toBe("workspace");
    });

    it("modeFromMain='dialog' with dialogOpen=false still results in 'workspace'", () => {
      // When main process says dialog mode (e.g., from another source),
      // but our dialogOpen is false, we use the dialogOpen/sidebarExpanded logic
      // which results in workspace. The modeFromMain is just for shortcut priority.
      expect(computeDesiredMode("dialog", false, false)).toBe("workspace");
    });
  });

  describe("derived state from setters", () => {
    it("setModeFromMain updates uiMode and shortcutModeActive", () => {
      setModeFromMain("shortcut");
      flushSync();

      expect(uiMode.value).toBe("shortcut");
      expect(shortcutModeActive.value).toBe(true);
    });

    it("setDialogOpen(true) changes desiredMode to 'dialog'", () => {
      setDialogOpen(true);
      flushSync();

      expect(desiredMode.value).toBe("dialog");
    });

    it("setSidebarExpanded(true) changes desiredMode to 'dialog'", () => {
      setSidebarExpanded(true);
      flushSync();

      expect(desiredMode.value).toBe("dialog");
    });

    it("modeFromMain transition from shortcut to workspace respects dialogOpen", () => {
      // Start in shortcut mode with dialog open
      setModeFromMain("shortcut");
      setDialogOpen(true);
      flushSync();

      // desiredMode is shortcut (shortcut takes priority)
      expect(desiredMode.value).toBe("shortcut");

      // Transition to workspace from main
      setModeFromMain("workspace");
      flushSync();

      // desiredMode should be dialog since dialogOpen is still true
      expect(desiredMode.value).toBe("dialog");
    });
  });

  describe("syncMode IPC calls", () => {
    it("syncMode calls api.ui.setMode when desiredMode changes", () => {
      // Initial sync with workspace
      syncMode();
      expect(mockApi.ui.setMode).toHaveBeenCalledWith("workspace");
      mockApi.ui.setMode.mockClear();

      // Change to dialog
      setDialogOpen(true);
      flushSync();
      syncMode();

      expect(mockApi.ui.setMode).toHaveBeenCalledWith("dialog");
    });

    it("syncMode does NOT call api.ui.setMode when inputs change but desiredMode stays same", () => {
      // Set dialog open - desiredMode is "dialog"
      setDialogOpen(true);
      flushSync();
      syncMode();

      expect(mockApi.ui.setMode).toHaveBeenCalledWith("dialog");
      mockApi.ui.setMode.mockClear();

      // Change sidebarExpanded - desiredMode still "dialog"
      setSidebarExpanded(true);
      flushSync();
      syncMode();

      // Should NOT have called setMode again (deduplication)
      expect(mockApi.ui.setMode).not.toHaveBeenCalled();
    });

    it("syncMode passes correct mode value to api.ui.setMode", () => {
      // Initial workspace
      syncMode();
      expect(mockApi.ui.setMode).toHaveBeenCalledWith("workspace");
      mockApi.ui.setMode.mockClear();

      // Test workspace -> dialog
      setDialogOpen(true);
      flushSync();
      syncMode();
      expect(mockApi.ui.setMode).toHaveBeenCalledWith("dialog");
      mockApi.ui.setMode.mockClear();

      // Test dialog -> workspace
      setDialogOpen(false);
      flushSync();
      syncMode();
      expect(mockApi.ui.setMode).toHaveBeenCalledWith("workspace");
    });
  });

  describe("reset function", () => {
    it("reset() restores initial state", () => {
      // Change state
      setModeFromMain("shortcut");
      setDialogOpen(true);
      setSidebarExpanded(true);
      flushSync();

      // Verify changed
      expect(uiMode.value).toBe("shortcut");

      // Reset
      reset();
      flushSync();

      // Verify restored to initial
      expect(uiMode.value).toBe("workspace");
      expect(desiredMode.value).toBe("workspace");
      expect(shortcutModeActive.value).toBe(false);
    });
  });
});
