/**
 * Shortcut mode state store using Svelte 5 runes.
 * Manages keyboard shortcut overlay visibility and handlers.
 */

import * as api from "$lib/api";
import { dialogState } from "./dialogs.svelte";

// ============ Constants ============

const ALT_KEY = "Alt";

// ============ State ============

let _shortcutModeActive = $state(false);

// ============ Getters ============

export const shortcutModeActive = {
  get value() {
    return _shortcutModeActive;
  },
};

// ============ Actions ============

/**
 * Enables shortcut mode when Alt+X is pressed.
 * Ignored if a dialog is currently open.
 */
export function handleShortcutEnable(): void {
  // Check dialog state directly to support testing with mocks
  if (dialogState.value.type !== "closed") return;
  _shortcutModeActive = true;
}

/**
 * Handles SHORTCUT_DISABLE from main process.
 * This covers the race condition where Alt is released before focus switches to UI.
 * Must restore z-order and focus since main process only sent the IPC message.
 */
export function handleShortcutDisable(): void {
  if (!_shortcutModeActive) return;
  _shortcutModeActive = false;
  // Fire-and-forget pattern - see AGENTS.md IPC Patterns
  void api.setDialogMode(false);
  void api.focusActiveWorkspace();
}

/**
 * Handles keyup events. Exits shortcut mode when Alt is released.
 * @param event - The keyboard event
 */
export function handleKeyUp(event: KeyboardEvent): void {
  if (event.repeat) return;
  if (event.key === ALT_KEY && _shortcutModeActive) {
    exitShortcutMode();
  }
}

/**
 * Handles window blur events. Exits shortcut mode when window loses focus.
 */
export function handleWindowBlur(): void {
  if (_shortcutModeActive) {
    exitShortcutMode();
  }
}

/**
 * Exits shortcut mode and restores normal state.
 * Calls IPC to restore z-order and focus.
 */
function exitShortcutMode(): void {
  _shortcutModeActive = false;
  // Fire-and-forget pattern - see AGENTS.md IPC Patterns
  void api.setDialogMode(false);
  void api.focusActiveWorkspace();
}

/**
 * Reset store to initial state. Used for testing.
 */
export function reset(): void {
  _shortcutModeActive = false;
}
