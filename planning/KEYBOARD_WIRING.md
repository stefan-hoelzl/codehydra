---
status: COMPLETED
last_updated: 2025-12-07
reviewers:
  [
    review-ui,
    review-typescript,
    review-electron,
    review-arch,
    review-senior,
    review-testing,
    review-docs,
  ]
---

# KEYBOARD_WIRING

## Overview

- **Problem**: Need to verify the keyboard capture round-trip works before building UI features. Alt+X should activate shortcut mode, Alt release should deactivate it.
- **Solution**: Implement the full main process → UI → main process wiring with console.log verification only (no UI changes).
- **Risks**:
  - `before-input-event` behavior may differ across platforms
  - Alt keyup detection requires UI to have focus
- **Alternatives Considered**:
  - Build full UI first - rejected because harder to debug wiring issues
  - **Dual-capture strategy (webview-preload + main process)** - ARCHITECTURE.md documents this approach, but we are **intentionally replacing it** with main-process-only `before-input-event` capture. Rationale:
    - `before-input-event` fires before the page receives input, making preload redundant
    - Simpler architecture with single capture point
    - No need to inject scripts into potentially untrusted content
    - ARCHITECTURE.md will be updated in KEYBOARD_ACTIVATION plan to reflect this change

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         KEYBOARD WIRING VERIFICATION                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. User presses Alt+X (in workspace view)                                  │
│     │                                                                       │
│     ▼                                                                       │
│  2. ShortcutController (main process)                                       │
│     • before-input-event detects Alt+X                                      │
│     • Calls setDialogMode(true) to bring UI to front                        │
│     • Calls focusUI() to give UI keyboard focus                             │
│     • Emits SHORTCUT_ENABLE to UI                                           │
│     │                                                                       │
│     ▼                                                                       │
│  3. UI Layer receives ENABLE                                                │
│     • console.log("shortcut mode enabled")                                  │
│     │                                                                       │
│     ▼                                                                       │
│  4. User releases Alt                                                       │
│     │                                                                       │
│     ▼                                                                       │
│  5. UI Layer detects keyup (has focus from step 2)                          │
│     • console.log("shortcut mode disabled")                                 │
│     • Calls setDialogMode(false) to send UI to back                         │
│     • Workspace regains focus naturally (active view)                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

Note: <svelte:window on:keyup> listens to the browser window's keyup events,
which only fire when the UI view has been focused by step 2.
```

### Race Condition: Alt Released Before Focus Switch

There is a race condition where the user can release Alt faster than focus switches to the UI:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RACE CONDITION SCENARIO                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. User presses Alt+X (in workspace view)                                  │
│     • ShortcutController calls focusUI()                                    │
│     • ShortcutController sets shortcutModeActive = true                     │
│     • SHORTCUT_ENABLE sent to UI                                            │
│                                                                             │
│  2. User releases Alt VERY QUICKLY (before focus actually switches)         │
│     • Workspace view still has focus                                        │
│     • Workspace's before-input-event catches the Alt keyup                  │
│                                                                             │
│  PROBLEM: Without SHORTCUT_DISABLE...                                       │
│     • UI thinks shortcut mode is still active                               │
│     • Workspace view suppresses Alt keyup (to prevent VS Code menu)         │
│     • UI's keyup handler never fires (doesn't have focus yet)               │
│     • shortcutModeActive stays true forever                                 │
│     • Subsequent Alt+X activations break                                    │
│                                                                             │
│  SOLUTION: Main process tracks shortcutModeActive flag                      │
│     • On Alt keyup, if shortcutModeActive was true:                         │
│       → Reset flag to false                                                 │
│       → Send SHORTCUT_DISABLE to UI                                         │
│     • UI receives SHORTCUT_DISABLE and resets its state                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Dual-Path Blur Handling

Both the main process and UI layer handle blur events independently:

| Layer        | Event Source      | Handler                          | Purpose                        |
| ------------ | ----------------- | -------------------------------- | ------------------------------ |
| Main Process | BaseWindow 'blur' | ShortcutController.handleBlur()  | Resets shortcutModeActive flag |
| UI Layer     | window 'blur'     | `<svelte:window onblur>` handler | Resets UI shortcutModeActive   |

**Why both are needed:**

- Window blur (Alt+Tab) triggers BaseWindow blur handler in main process
- UI layer blur can happen when focus moves within the app (e.g., to DevTools)
- Both paths work correctly due to redundant handling - each resets its own state
- This is intentional: blur can happen in either process's context, and neither depends on the other

## Main Process State Machine

```
                              ┌──────────┐
              ┌───────────────│  NORMAL  │◄────────────────────────────────┐
              │               └────┬─────┘                                 │
              │                    │                                       │
              │ Alt up             │ Alt down                              │
              │ (suppress)         │ (preventDefault)                      │
              │                    ▼                                       │
              │            ┌─────────────┐                                 │
              │            │ ALT_WAITING │                                 │
              │            └──────┬──────┘                                 │
              │                   │                                        │
              │     ┌─────────────┼─────────────┐                          │
              │     │             │             │                          │
              │  Alt up      non-X key       X down                        │
              │  (suppress)  (let through)      │                          │
              │     │             │             ▼                          │
              │     │             │      • preventDefault                  │
              │     │             │      • setDialogMode(true)             │
              │     │             │      • focusUI()                       │
              │     │             │      • Emit ENABLE to UI               │
              │     │             │             │                          │
              └─────┴─────────────┴─────────────┘                          │
                                                                           │
              Main process returns to NORMAL immediately ──────────────────┘
```

**Note**: Alt keyup is ALWAYS suppressed (in both states) so VS Code never sees Alt-only key events.

## Implementation Steps

> **TDD Approach**: Each step follows test-driven development.

- [x] **Step 1: IPC Channel**
  - **Tests first**:
    - `ipc-channel-exists`: SHORTCUT_ENABLE exists in IpcChannels
  - Add `SHORTCUT_ENABLE: "shortcut:enable"` to `src/shared/ipc.ts`
  - Files affected: `src/shared/ipc.ts`

- [x] **Step 2: ShortcutController**
  - **Tests first**:
    - `controller-normal-to-waiting`: Alt keydown → ALT_WAITING, preventDefault called
    - `controller-waiting-to-activate`: X keydown → calls setDialogMode, focusUI, emits ENABLE, preventDefault called
    - `controller-waiting-non-x`: Non-X keydown (e.g., Alt+J) → NORMAL, event NOT prevented
    - `controller-waiting-alt-up`: Alt keyup in ALT_WAITING → suppressed (preventDefault), NORMAL
    - `controller-normal-alt-up`: Alt keyup in NORMAL → suppressed (preventDefault)
    - `controller-ignore-repeat`: Auto-repeat events (`input.isAutoRepeat`) ignored
    - `controller-window-blur`: Window blur resets ALT_WAITING → NORMAL
    - `controller-emit-null-webcontents`: emitEnable() handles null WebContents gracefully (no throw)
    - `controller-dispose-cleanup`: dispose() unregisters all view listeners and window blur handler
    - `controller-multiple-views`: Alt+X with multiple registered views → only one ENABLE event emitted
    - `controller-destroyed-webcontents`: Destroyed WebContents auto-unregistered (no stale references)
    - `controller-uses-ipc-channel`: webContents.send called with IpcChannels.SHORTCUT_ENABLE (not hardcoded)
  - Create `src/main/shortcut-controller.ts`:

  ```typescript
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
      if (input.type === "keyUp" && isAltKey) {
        event.preventDefault();
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
  ```

  - Files affected: `src/main/shortcut-controller.ts` (new), `src/main/shortcut-controller.test.ts` (new)

- [x] **Step 3: ViewManager Integration**
  - **Depends on**: Step 2
  - **Tests first**:
    - `viewmanager-creates-controller`: ViewManager creates ShortcutController in constructor
    - `viewmanager-registers-controller`: createWorkspaceView registers with controller
    - `viewmanager-unregisters-controller`: destroyWorkspaceView unregisters
    - `viewmanager-disposes-controller`: destroy() calls controller.dispose()
    - `viewmanager-no-preload`: Workspace views created without preload script
  - **Changes to ViewManager**:
    1. Add `shortcutController: ShortcutController` as private member
    2. Create ShortcutController in `ViewManager.create()` factory, passing deps:
       ```typescript
       const controller = new ShortcutController(window, {
         setDialogMode: (isOpen) => viewManager.setDialogMode(isOpen),
         focusUI: () => viewManager.focusUI(),
         getUIWebContents: () => viewManager.getUIWebContents(),
       });
       ```
    3. Register in `createWorkspaceView()`: `this.shortcutController.registerView(view.webContents)`
    4. Unregister in `destroyWorkspaceView()`: `this.shortcutController.unregisterView(view.webContents)`
    5. Dispose in `destroy()`: `this.shortcutController.dispose()`
  - **Remove webview-preload** (intentionally replacing dual-capture strategy):
    - Remove `webviewPreloadPath` field from `ViewManagerConfig` interface
    - Update all call sites that construct ViewManagerConfig (remove the field)
    - Remove `preload` from webPreferences in `createWorkspaceView()`
    - Delete `src/preload/webview-preload.ts`
    - Update `electron.vite.config.ts`: Remove `"webview-preload": resolve(__dirname, "src/preload/webview-preload.ts")` from rollupOptions.input (around line 20)
  - Files affected: `src/main/managers/view-manager.ts`, `src/main/managers/view-manager.test.ts`, `src/main/managers/view-manager.interface.ts`, `src/preload/webview-preload.ts` (delete), `electron.vite.config.ts`

- [x] **Step 4: UI Preload Subscription**
  - **Tests first**:
    - `preload-subscription-exists`: api.onShortcutEnable exists
    - `preload-subscription-cleanup`: Returns cleanup function
    - `preload-subscription-callback`: Callback invoked on event with no arguments
  - Add `onShortcutEnable` using existing `createEventSubscription<T>()` pattern (line 24 of src/preload/index.ts):
    ```typescript
    onShortcutEnable: createEventSubscription<void>(IpcChannels.SHORTCUT_ENABLE),
    ```
  - Files affected: `src/preload/index.ts`, `src/preload/index.test.ts`

- [x] **Step 5: electron-api.d.ts**
  - Add `onShortcutEnable(callback: () => void): () => void` to window.api type
  - Files affected: `src/shared/electron-api.d.ts`

- [x] **Step 6: App.svelte Console Verification**
  - **Tests first**:
    - `app-subscribes-on-mount`: Subscribes to onShortcutEnable via $effect
    - `app-unsubscribe-on-cleanup`: Unsubscribe called when effect re-runs/component unmounts
    - `app-logs-on-shortcut-enable`: Logs "shortcut mode enabled" on ENABLE received
    - `app-logs-on-alt-keyup`: Logs "shortcut mode disabled" on Alt keyup
    - `app-logs-on-window-blur`: Logs "shortcut mode disabled (blur)" on window blur
    - `app-keyup-calls-dialog-mode-false`: Alt keyup calls setDialogMode(false)
    - `app-blur-calls-dialog-mode-false`: Window blur calls setDialogMode(false)
  - Add minimal wiring to App.svelte:

  ```svelte
  <script lang="ts">
    import { api } from "$lib/api";

    let shortcutModeActive = $state(false);

    // Subscribe to shortcut enable events from main process
    $effect(() => {
      const unsubscribe = api.onShortcutEnable(() => {
        shortcutModeActive = true;
        console.log("KEYBOARD_WIRING: shortcut mode enabled");
      });
      return unsubscribe;
    });

    /**
     * Deactivates shortcut mode and returns focus to workspace.
     * Used by both keyup and blur handlers for consistent cleanup.
     */
    function deactivateShortcutMode(reason: string): void {
      if (!shortcutModeActive) return;
      shortcutModeActive = false;
      console.log(`KEYBOARD_WIRING: shortcut mode disabled (${reason})`);
      // Fire-and-forget pattern - see AGENTS.md IPC Patterns
      void api.setDialogMode(false);
    }

    function handleKeyUp(event: KeyboardEvent): void {
      // Ignore auto-repeat events at UI layer as well
      if (event.repeat) return;
      if (event.key === "Alt" && shortcutModeActive) {
        deactivateShortcutMode("alt-release");
      }
    }

    function handleWindowBlur(): void {
      deactivateShortcutMode("blur");
    }
  </script>

  <svelte:window on:keyup={handleKeyUp} on:blur={handleWindowBlur} />
  ```

  - **Note**: Console logs prefixed with "KEYBOARD_WIRING:" for easy identification. These are temporary verification logs that will be replaced with actual UI updates in KEYBOARD_ACTIVATION plan.
  - **Note on blur handlers**: ShortcutController handles blur on the BaseWindow (loses OS focus), while App.svelte handles blur on the window object (UI layer loses focus within the app). Both are needed for complete coverage - defense in depth.
  - Files affected: `src/renderer/App.svelte`, `src/renderer/App.test.ts`

## Testing Strategy

### Mocking Strategy

| Component            | Mock Approach                                            |
| -------------------- | -------------------------------------------------------- |
| `WebContents.send`   | Mock via `vi.fn()` on fake WebContents                   |
| `before-input-event` | Create mock Electron.Event with `preventDefault` spy     |
| `BaseWindow`         | Partial mock with `on`/`off` methods                     |
| `api` object         | Mock via `vi.mock('$lib/api')`                           |
| `Electron.Input`     | Use `createMockElectronInput()` test utility (see below) |

### Test Utilities

Create helper in `src/main/shortcut-controller.test.ts`:

```typescript
function createMockElectronInput(
  key: string,
  type: "keyDown" | "keyUp" = "keyDown",
  options: { alt?: boolean; isAutoRepeat?: boolean } = {}
): Input {
  return {
    type,
    key,
    code: `Key${key.toUpperCase()}`,
    alt: options.alt ?? false,
    control: false,
    shift: false,
    meta: false,
    isAutoRepeat: options.isAutoRepeat ?? false,
  };
}
```

### Unit Tests

| Test Case                          | State Transition     | Description                         | File                                     |
| ---------------------------------- | -------------------- | ----------------------------------- | ---------------------------------------- |
| ipc-channel-exists                 | -                    | SHORTCUT_ENABLE in IpcChannels      | `src/shared/ipc.test.ts`                 |
| controller-normal-to-waiting       | NORMAL → ALT_WAITING | Alt keydown, preventDefault called  | `src/main/shortcut-controller.test.ts`   |
| controller-waiting-to-activate     | ALT_WAITING → NORMAL | X keydown activates, preventDefault | `src/main/shortcut-controller.test.ts`   |
| controller-waiting-non-x           | ALT_WAITING → NORMAL | Non-X returns to NORMAL, no prevent | `src/main/shortcut-controller.test.ts`   |
| controller-waiting-alt-up          | ALT_WAITING → NORMAL | Alt keyup suppressed                | `src/main/shortcut-controller.test.ts`   |
| controller-normal-alt-up           | NORMAL → NORMAL      | Alt keyup in NORMAL suppressed      | `src/main/shortcut-controller.test.ts`   |
| controller-ignore-repeat           | -                    | Auto-repeat ignored                 | `src/main/shortcut-controller.test.ts`   |
| controller-window-blur             | ALT_WAITING → NORMAL | Window blur resets state            | `src/main/shortcut-controller.test.ts`   |
| controller-emit-null-webcontents   | -                    | Null UI WebContents doesn't throw   | `src/main/shortcut-controller.test.ts`   |
| controller-dispose-cleanup         | -                    | Dispose removes all listeners       | `src/main/shortcut-controller.test.ts`   |
| controller-multiple-views          | -                    | Multiple views, one ENABLE event    | `src/main/shortcut-controller.test.ts`   |
| controller-destroyed-webcontents   | -                    | Auto-unregister on destroyed        | `src/main/shortcut-controller.test.ts`   |
| controller-uses-ipc-channel        | -                    | Uses IpcChannels constant           | `src/main/shortcut-controller.test.ts`   |
| viewmanager-creates-controller     | -                    | Controller created in factory       | `src/main/managers/view-manager.test.ts` |
| viewmanager-registers-controller   | -                    | Registration on create              | `src/main/managers/view-manager.test.ts` |
| viewmanager-unregisters-controller | -                    | Unregistration on destroy           | `src/main/managers/view-manager.test.ts` |
| viewmanager-disposes-controller    | -                    | Controller disposed on destroy      | `src/main/managers/view-manager.test.ts` |
| viewmanager-no-preload             | -                    | No preload in webPreferences        | `src/main/managers/view-manager.test.ts` |
| preload-subscription-exists        | -                    | onShortcutEnable exists             | `src/preload/index.test.ts`              |
| preload-subscription-cleanup       | -                    | Cleanup function works              | `src/preload/index.test.ts`              |
| preload-subscription-callback      | -                    | Callback invoked with no args       | `src/preload/index.test.ts`              |
| app-subscribes-on-mount            | -                    | Subscribes via $effect              | `src/renderer/App.test.ts`               |
| app-unsubscribe-on-cleanup         | -                    | Unsubscribe on cleanup              | `src/renderer/App.test.ts`               |
| app-logs-on-shortcut-enable        | -                    | Console.log on enable               | `src/renderer/App.test.ts`               |
| app-logs-on-alt-keyup              | -                    | Console.log on Alt keyup            | `src/renderer/App.test.ts`               |
| app-logs-on-window-blur            | -                    | Console.log on window blur          | `src/renderer/App.test.ts`               |
| app-keyup-calls-dialog-mode-false  | -                    | setDialogMode(false) on keyup       | `src/renderer/App.test.ts`               |
| app-blur-calls-dialog-mode-false   | -                    | setDialogMode(false) on blur        | `src/renderer/App.test.ts`               |

### Integration Tests

| Test Case                 | Description                                                    | File                                               |
| ------------------------- | -------------------------------------------------------------- | -------------------------------------------------- |
| keyboard-wiring-roundtrip | Full path: input event → IPC → callback → setDialogMode called | `src/main/shortcut-controller.integration.test.ts` |

### Manual Testing Checklist

- [ ] Run app with DevTools console open
- [ ] **Close DevTools during keyboard testing** - DevTools intercepts some keyboard events
- [ ] Press Alt+X → console shows "KEYBOARD_WIRING: shortcut mode enabled"
- [ ] Release Alt → console shows "KEYBOARD_WIRING: shortcut mode disabled (alt-release)"
- [ ] Press Alt+X, then Alt+Tab away → console shows "KEYBOARD_WIRING: shortcut mode disabled (blur)"
- [ ] Press Alt+J (not X) → VS Code receives Alt+J normally (no console log)
- [ ] Rapid Alt+X press/release → no errors, logs appear correctly
- [ ] **Platform testing** (if available):
  - [ ] Linux: Test with GNOME/KDE - verify Alt key handling doesn't break window manager shortcuts
  - [ ] Windows: Verify Alt doesn't inadvertently activate menu bar
  - [ ] macOS: Verify Option+X works (note: may need platform-specific handling in future)

## Dependencies

| Package | Purpose             | Approved |
| ------- | ------------------- | -------- |
| (none)  | No new dependencies | N/A      |

## Documentation Updates

### Files to Update (in KEYBOARD_ACTIVATION plan)

| File                 | Changes Required                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| docs/ARCHITECTURE.md | Update "Alt Key Handling" section to document main-process-only capture instead of dual-capture strategy |

## Definition of Done

- [ ] All implementation steps complete
- [ ] All unit tests pass
- [ ] Integration test passes
- [ ] `pnpm validate:fix` passes
- [ ] Manual testing checklist completed
- [ ] Console logs confirm round-trip works
