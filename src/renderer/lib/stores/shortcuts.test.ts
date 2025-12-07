/**
 * Tests for the shortcuts store.
 * Tests shortcut mode state and handlers.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Create mock API functions with vi.hoisted for proper hoisting
const mockApi = vi.hoisted(() => ({
  setDialogMode: vi.fn(),
  focusActiveWorkspace: vi.fn(),
}));

// Create mock dialog state with vi.hoisted
// Using Record<string, unknown> to allow flexible reassignment in tests
const mockDialogState = vi.hoisted(() => ({
  dialogState: {
    value: { type: "closed" } as Record<string, unknown>,
  },
}));

// Mock the API module before any imports use it
vi.mock("$lib/api", () => mockApi);

// Mock the dialogs store
vi.mock("./dialogs.svelte", () => mockDialogState);

// Import after mock setup
import {
  shortcutModeActive,
  handleShortcutEnable,
  handleShortcutDisable,
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
      expect(mockApi.setDialogMode).toHaveBeenCalledWith(false);
      expect(mockApi.focusActiveWorkspace).toHaveBeenCalled();
    });

    it("should-ignore-disable-when-already-inactive: handleShortcutDisable when inactive is no-op", () => {
      handleShortcutDisable();

      expect(shortcutModeActive.value).toBe(false);
      expect(mockApi.setDialogMode).not.toHaveBeenCalled();
      expect(mockApi.focusActiveWorkspace).not.toHaveBeenCalled();
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
      expect(mockApi.setDialogMode).toHaveBeenCalledWith(false);
      expect(mockApi.focusActiveWorkspace).toHaveBeenCalled();
    });

    it("should-ignore-keyup-for-non-alt-keys: handleKeyUp with other keys is ignored", () => {
      // First enable shortcut mode
      handleShortcutEnable();
      expect(shortcutModeActive.value).toBe(true);

      const event = new KeyboardEvent("keyup", { key: "x" });
      handleKeyUp(event);

      expect(shortcutModeActive.value).toBe(true);
      expect(mockApi.setDialogMode).not.toHaveBeenCalled();
    });

    it("should-ignore-keyup-when-inactive: handleKeyUp when inactive is no-op", () => {
      const event = new KeyboardEvent("keyup", { key: "Alt" });
      handleKeyUp(event);

      expect(shortcutModeActive.value).toBe(false);
      expect(mockApi.setDialogMode).not.toHaveBeenCalled();
      expect(mockApi.focusActiveWorkspace).not.toHaveBeenCalled();
    });

    it("should-ignore-repeat-keyup-events: handleKeyUp with event.repeat=true is ignored", () => {
      // First enable shortcut mode
      handleShortcutEnable();
      expect(shortcutModeActive.value).toBe(true);

      const event = new KeyboardEvent("keyup", { key: "Alt", repeat: true });
      handleKeyUp(event);

      expect(shortcutModeActive.value).toBe(true);
      expect(mockApi.setDialogMode).not.toHaveBeenCalled();
    });
  });

  describe("handleWindowBlur", () => {
    it("should-exit-shortcut-mode-on-window-blur: handleWindowBlur exits shortcut mode", () => {
      // First enable shortcut mode
      handleShortcutEnable();
      expect(shortcutModeActive.value).toBe(true);

      handleWindowBlur();

      expect(shortcutModeActive.value).toBe(false);
      expect(mockApi.setDialogMode).toHaveBeenCalledWith(false);
      expect(mockApi.focusActiveWorkspace).toHaveBeenCalled();
    });

    it("handleWindowBlur when inactive is no-op", () => {
      handleWindowBlur();

      expect(shortcutModeActive.value).toBe(false);
      expect(mockApi.setDialogMode).not.toHaveBeenCalled();
      expect(mockApi.focusActiveWorkspace).not.toHaveBeenCalled();
    });
  });

  describe("exitShortcutMode API calls", () => {
    it("should-call-setDialogMode-false-on-exit: exitShortcutMode calls api.setDialogMode(false)", () => {
      handleShortcutEnable();
      handleWindowBlur(); // Uses exitShortcutMode internally

      expect(mockApi.setDialogMode).toHaveBeenCalledWith(false);
    });

    it("should-call-focusActiveWorkspace-on-exit: exitShortcutMode calls api.focusActiveWorkspace()", () => {
      handleShortcutEnable();
      handleWindowBlur(); // Uses exitShortcutMode internally

      expect(mockApi.focusActiveWorkspace).toHaveBeenCalled();
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
      expect(mockApi.setDialogMode).toHaveBeenCalledTimes(2); // Called on each disable
      expect(mockApi.focusActiveWorkspace).toHaveBeenCalledTimes(2);
    });

    it("should-reset-state-for-testing: reset() sets state to false", () => {
      handleShortcutEnable();
      expect(shortcutModeActive.value).toBe(true);

      reset();
      expect(shortcutModeActive.value).toBe(false);
    });
  });
});
