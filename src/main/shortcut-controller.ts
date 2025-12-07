/**
 * ShortcutController - Detects Alt+X shortcut activation in workspace views.
 *
 * Uses main-process `before-input-event` capture instead of the
 * previously-documented dual-capture strategy. This is simpler and
 * doesn't require injecting preload scripts into workspace content.
 */

import type { WebContents, Event as ElectronEvent, Input, BaseWindow } from "electron";
import { IpcChannels } from "../shared/ipc";

type ShortcutActivationState = "NORMAL" | "ALT_WAITING";

/** Key constants for maintainability */
const SHORTCUT_MODIFIER_KEY = "Alt";
const SHORTCUT_ACTIVATION_KEY = "x";

interface ShortcutControllerDeps {
  setDialogMode: (isOpen: boolean) => void;
  focusUI: () => void;
  getUIWebContents: () => WebContents | null;
}

/**
 * Detects Alt+X shortcut activation in workspace views.
 * ONE global instance manages ALL workspace views.
 *
 * Uses main-process `before-input-event` capture instead of the
 * previously-documented dual-capture strategy. This is simpler and
 * doesn't require injecting preload scripts into workspace content.
 */
export class ShortcutController {
  private state: ShortcutActivationState = "NORMAL";
  /** Whether shortcut mode is currently active (UI overlay is showing) */
  private shortcutModeActive = false;
  private readonly registeredViews = new Set<WebContents>();
  private readonly inputHandlers = new Map<
    WebContents,
    (event: ElectronEvent, input: Input) => void
  >();
  private readonly destroyedHandlers = new Map<WebContents, () => void>();
  private readonly deps: ShortcutControllerDeps;
  private readonly window: BaseWindow;
  private readonly boundHandleWindowBlur: () => void;

  constructor(window: BaseWindow, deps: ShortcutControllerDeps) {
    this.window = window;
    this.deps = deps;
    this.boundHandleWindowBlur = this.handleWindowBlur.bind(this);
    this.window.on("blur", this.boundHandleWindowBlur);
  }

  /**
   * Registers a workspace view to listen for Alt+X shortcut.
   * Also listens for 'destroyed' event to auto-cleanup stale references.
   * @param webContents - WebContents of the workspace view
   */
  registerView(webContents: WebContents): void {
    if (this.registeredViews.has(webContents)) return;

    const inputHandler = (event: ElectronEvent, input: Input) => {
      this.handleInput(event, input);
    };
    const destroyedHandler = () => {
      this.unregisterView(webContents);
    };

    webContents.on("before-input-event", inputHandler);
    webContents.on("destroyed", destroyedHandler);

    this.registeredViews.add(webContents);
    this.inputHandlers.set(webContents, inputHandler);
    this.destroyedHandlers.set(webContents, destroyedHandler);
  }

  /**
   * Unregisters a workspace view from shortcut detection.
   * @param webContents - WebContents of the workspace view
   */
  unregisterView(webContents: WebContents): void {
    const inputHandler = this.inputHandlers.get(webContents);
    const destroyedHandler = this.destroyedHandlers.get(webContents);

    if (inputHandler && !webContents.isDestroyed()) {
      webContents.off("before-input-event", inputHandler);
    }
    if (destroyedHandler && !webContents.isDestroyed()) {
      webContents.off("destroyed", destroyedHandler);
    }

    this.registeredViews.delete(webContents);
    this.inputHandlers.delete(webContents);
    this.destroyedHandlers.delete(webContents);
  }

  /**
   * Handles keyboard input from workspace views.
   *
   * Algorithm:
   * 1. Early exit for non-keyDown events (performance)
   * 2. Early exit for auto-repeat events
   * 3. Alt keyup: always suppress (any state) → NORMAL
   * 4. Alt keydown: NORMAL → ALT_WAITING, suppress
   * 5. In ALT_WAITING + X keydown: activate shortcut, suppress
   * 6. In ALT_WAITING + other key: exit to NORMAL, let through
   */
  private handleInput(event: ElectronEvent, input: Input): void {
    // Performance: only process keyDown for state machine, keyUp for Alt suppression
    if (input.type !== "keyDown" && input.type !== "keyUp") return;

    // Ignore auto-repeat events (fires dozens per second on key hold)
    if (input.isAutoRepeat) return;

    const isAltKey = input.key === SHORTCUT_MODIFIER_KEY;
    const isActivationKey = input.key.toLowerCase() === SHORTCUT_ACTIVATION_KEY;

    // Alt keyup: ALWAYS suppress to prevent VS Code menu activation
    // Also notify UI if shortcut mode was active. This handles a race condition:
    // 1. Alt+X activates shortcut mode, focusUI() is called
    // 2. User releases Alt very quickly (before focus actually switches)
    // 3. This handler catches the Alt keyup (workspace still has focus)
    // 4. Without SHORTCUT_DISABLE, UI would never know Alt was released
    // 5. shortcutModeActive would stay true, breaking subsequent Alt+X usage
    if (input.type === "keyUp" && isAltKey) {
      event.preventDefault();
      if (this.shortcutModeActive) {
        this.shortcutModeActive = false;
        this.emitDisable();
      }
      this.state = "NORMAL";
      return;
    }

    // Only process keyDown from here
    if (input.type !== "keyDown") return;

    // NORMAL state: Alt keydown starts waiting
    if (this.state === "NORMAL" && isAltKey) {
      this.state = "ALT_WAITING";
      event.preventDefault();
      return;
    }

    // ALT_WAITING state
    if (this.state === "ALT_WAITING") {
      if (isActivationKey) {
        // Alt+X detected: activate shortcut mode
        event.preventDefault();
        this.deps.setDialogMode(true);
        this.deps.focusUI();
        this.shortcutModeActive = true;
        this.emitEnable();
        this.state = "NORMAL";
      } else if (!isAltKey) {
        // Non-X key: exit waiting, let the key through to VS Code
        this.state = "NORMAL";
        // Do NOT preventDefault - let the keystroke pass through
      }
    }
  }

  private handleWindowBlur(): void {
    // Reset state when window loses OS focus (e.g., Alt+Tab)
    this.shortcutModeActive = false;
    this.state = "NORMAL";
  }

  private emitEnable(): void {
    const uiWebContents = this.deps.getUIWebContents();
    if (!uiWebContents || uiWebContents.isDestroyed()) {
      // Silently fail if UI not ready - this is a transient state
      return;
    }
    uiWebContents.send(IpcChannels.SHORTCUT_ENABLE);
  }

  private emitDisable(): void {
    const uiWebContents = this.deps.getUIWebContents();
    if (!uiWebContents || uiWebContents.isDestroyed()) {
      // Silently fail if UI not ready - this is a transient state
      return;
    }
    uiWebContents.send(IpcChannels.SHORTCUT_DISABLE);
  }

  /**
   * Cleans up event listeners and resets state.
   * Should be called from ViewManager.destroy() during shutdown.
   */
  dispose(): void {
    // Unregister all views (makes copies to avoid mutation during iteration)
    for (const webContents of [...this.registeredViews]) {
      this.unregisterView(webContents);
    }

    // Remove window blur listener
    this.window.off("blur", this.boundHandleWindowBlur);
    this.state = "NORMAL";
  }
}
