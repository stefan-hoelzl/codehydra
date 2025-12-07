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
depends_on: KEYBOARD_WIRING
---

# KEYBOARD_ACTIVATION

## Overview

- **Problem**: Console logs prove wiring works, but users need visual feedback when shortcut mode is active.
- **Solution**: Add overlay component and proper state management to show/hide shortcut mode visually.
- **Risks**:
  - CSS transitions may conflict with z-order changes
  - State synchronization between store and UI
- **Alternatives Considered**:
  - Inline all logic in App.svelte - rejected because not testable
  - Shared types in this plan - deferred to KEYBOARD_ACTIONS where they're actually used

**Depends on**: `KEYBOARD_WIRING` must be completed first.

## Prerequisites

Before starting implementation, verify these exist from KEYBOARD_WIRING:

| API Method                   | Purpose                                               |
| ---------------------------- | ----------------------------------------------------- |
| `api.onShortcutEnable()`     | Subscribe to shortcut enable events                   |
| `api.onShortcutDisable()`    | Subscribe to shortcut disable events (race condition) |
| `api.setDialogMode()`        | Swap UI layer z-order                                 |
| `api.focusActiveWorkspace()` | Return focus to VS Code                               |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SHORTCUT MODE UI                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  NORMAL STATE                           SHORTCUT MODE                       │
│  ────────────                           ─────────────                       │
│                                                                             │
│  ┌──────────────────────────────┐       ┌──────────────────────────────┐   │
│  │                              │       │                              │   │
│  │  VS Code (focused)           │       │  UI Layer (focused)          │   │
│  │                              │       │  ┌────────────────────────┐  │   │
│  │                              │       │  │   Shortcut Overlay     │  │   │
│  │                              │       │  │   (bottom center)      │  │   │
│  │                              │       │  └────────────────────────┘  │   │
│  └──────────────────────────────┘       └──────────────────────────────┘   │
│  ┌──────────────────────────────┐       ┌──────────────────────────────┐   │
│  │  UI Layer (behind, hidden)   │       │  VS Code (behind)            │   │
│  └──────────────────────────────┘       └──────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## UI Design

### Shortcut Overlay (bottom center, semi-transparent)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  Sidebar                    VS Code Area                                    │
│                                                                             │
│                                                                             │
│                                                                             │
│                                                                             │
│                          ┌─────────────────────────────────────┐            │
│                          │  ↑↓ Navigate   ⏎ New   ⌫ Del   1-0 Jump │       │
│                          └─────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────────────────────┘
```

- Position: `fixed`, bottom center
- Semi-transparent background (uses CSS variables)
- Fade transition: 150ms ease-in-out
- ARIA: `role="status"`, `aria-live="polite"`

## Implementation Steps

- [x] **Step 1: Shortcut Store**
  - **Tests first** (write before implementation):
    - `should-have-inactive-state-initially`: shortcutModeActive.value is false initially
    - `should-enable-shortcut-mode-when-no-dialog-open`: handleShortcutEnable sets active to true
    - `should-ignore-enable-when-dialog-is-open`: handleShortcutEnable ignored if dialog open
    - `should-disable-shortcut-mode-and-restore-state`: handleShortcutDisable resets state and calls APIs
    - `should-ignore-disable-when-already-inactive`: handleShortcutDisable when inactive is no-op
    - `should-exit-shortcut-mode-on-alt-keyup`: handleKeyUp with Alt calls exitShortcutMode
    - `should-ignore-keyup-for-non-alt-keys`: handleKeyUp with other keys is ignored
    - `should-ignore-keyup-when-inactive`: handleKeyUp when inactive is no-op
    - `should-ignore-repeat-keyup-events`: handleKeyUp with event.repeat=true is ignored
    - `should-exit-shortcut-mode-on-window-blur`: handleWindowBlur exits shortcut mode
    - `should-call-setDialogMode-false-on-exit`: exitShortcutMode calls api.setDialogMode(false)
    - `should-call-focusActiveWorkspace-on-exit`: exitShortcutMode calls api.focusActiveWorkspace()
    - `should-update-dialogOpen-when-dialogState-changes`: $derived reactivity works
    - `should-handle-rapid-enable-disable-toggle`: rapid state changes remain consistent
    - `should-reset-state-for-testing`: reset() sets state to false
  - Create `src/renderer/lib/stores/shortcuts.svelte.ts`:

  ```typescript
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
  let _dialogOpen = $derived(dialogState.value.type !== "closed");

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
    if (_dialogOpen) return;
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
  ```

  - Files affected: `src/renderer/lib/stores/shortcuts.svelte.ts` (new), `src/renderer/lib/stores/shortcuts.test.ts` (new)

- [x] **Step 2: Shortcut Overlay Component**
  - **Tests first** (write before implementation):
    - `should-show-overlay-with-opacity-1-when-active`: Shows (opacity 1) when active=true
    - `should-hide-overlay-with-opacity-0-when-inactive`: Hidden (opacity 0) when active=false
    - `should-have-role-status-attribute`: Has role="status"
    - `should-have-aria-live-polite-attribute`: Has aria-live="polite"
    - `should-have-aria-hidden-when-inactive`: Has aria-hidden={true} when inactive
    - `should-announce-state-change-for-screen-readers`: sr-only text appears when active
    - `should-have-aria-labels-on-hint-symbols`: Symbols have aria-label attributes
    - `should-display-all-keyboard-hints`: Shows Navigate, New, Del, Jump hints
    - `should-have-opacity-transition-css`: Has transition property
    - `should-have-z-index-for-layering`: Has z-index: 9999
  - Create `src/renderer/lib/components/ShortcutOverlay.svelte`:

  ```svelte
  <script lang="ts">
    interface Props {
      active: boolean;
    }

    let { active }: Props = $props();
  </script>

  <!-- 
    Content is always rendered (no {#if}) so fade-out transition works smoothly.
    aria-hidden prevents screen readers from reading invisible content.
    Dynamic sr-only text announces state changes for aria-live region.
  -->
  <div class="shortcut-overlay" class:active role="status" aria-live="polite" aria-hidden={!active}>
    {#if active}
      <span class="sr-only">Shortcut mode active.</span>
    {/if}
    <span aria-label="Up and Down arrows to navigate">↑↓ Navigate</span>
    <span aria-label="Enter key to create new workspace">⏎ New</span>
    <span aria-label="Delete key to remove workspace">⌫ Del</span>
    <span aria-label="Number keys 1 through 0 to jump">1-0 Jump</span>
  </div>

  <style>
    .shortcut-overlay {
      position: fixed;
      bottom: 1rem;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9999;
      background: var(--vscode-editor-background, rgba(30, 30, 30, 0.9));
      border: 1px solid var(--vscode-panel-border, #454545);
      border-radius: 4px;
      padding: 0.5rem 1rem;
      display: flex;
      gap: 1rem;
      font-size: 0.875rem;
      color: var(--vscode-foreground, #cccccc);
      opacity: 0;
      pointer-events: none;
      transition: opacity 150ms ease-in-out;
    }

    .shortcut-overlay.active {
      opacity: 1;
    }

    /* Screen reader only - announces state changes */
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
  </style>
  ```

  - Files affected: `src/renderer/lib/components/ShortcutOverlay.svelte` (new), `src/renderer/lib/components/ShortcutOverlay.test.ts` (new)

- [x] **Step 3: App.svelte Integration**
  - **Tests first**:
    - `app-renders-shortcut-overlay`: ShortcutOverlay component is rendered in App
    - `app-passes-active-prop-to-overlay`: Overlay receives shortcutModeActive.value
    - `app-wires-keyup-to-store`: handleKeyUp connected to svelte:window onkeyup
    - `app-wires-blur-to-store`: handleWindowBlur connected to svelte:window onblur
    - `app-subscribes-to-shortcut-enable`: onShortcutEnable subscription via $effect
    - `app-subscribes-to-shortcut-disable`: onShortcutDisable subscription via $effect
    - `app-cleanup-subscriptions-on-unmount`: Verify unsubscribe called on component unmount
  - **Changes**:
    1. Remove temporary console.log statements from `src/renderer/App.svelte`:
       - Remove `console.log("KEYBOARD_WIRING: shortcut mode enabled")` (around line 36)
       - Remove `console.log(\`KEYBOARD_WIRING: shortcut mode disabled (${reason})\`)` (around line 56)
    2. Remove inline shortcut state: `let shortcutModeActive = $state(false)` (line 24)
    3. Remove inline handlers: `deactivateShortcutMode`, `handleKeyUp`, `handleWindowBlur` (lines 53-72)
    4. Remove inline shortcut $effect subscriptions (lines 33-47)
    5. Import shortcuts store functions and state
    6. Add ShortcutOverlay component import and render
    7. Wire up subscriptions via single $effect with cleanup
    8. **Fix transparency**: Change `.app` background from `var(--ch-background)` to `transparent`
       - This allows WebContentsView transparency to work (VS Code visible through UI layer)
       - Sidebar keeps its own opaque background (`var(--ch-background)`)
       - Remove the TODO comment about Linux transparency (lines 183-185)
  - Replace console.log wiring with store + overlay:

  ```svelte
  <script lang="ts">
    import * as api from "$lib/api";
    import {
      shortcutModeActive,
      handleShortcutEnable,
      handleShortcutDisable,
      handleKeyUp,
      handleWindowBlur,
    } from "$lib/stores/shortcuts.svelte";
    import ShortcutOverlay from "$lib/components/ShortcutOverlay.svelte";

    // Subscribe to shortcut events from main process
    $effect(() => {
      const unsubEnable = api.onShortcutEnable(handleShortcutEnable);
      const unsubDisable = api.onShortcutDisable(handleShortcutDisable);
      return () => {
        unsubEnable();
        unsubDisable();
      };
    });
  </script>

  <svelte:window onkeyup={handleKeyUp} onblur={handleWindowBlur} />

  <!-- Existing content... -->

  <ShortcutOverlay active={shortcutModeActive.value} />

  <style>
    .app {
      display: flex;
      height: 100vh;
      color: var(--ch-foreground);
      background: transparent; /* Allow VS Code to show through UI layer */
    }
  </style>
  ```

  - Files affected: `src/renderer/App.svelte`, `src/renderer/App.test.ts`

## Testing Strategy

### Mocking Strategy

```typescript
// In shortcuts.test.ts setup
import { vi, beforeEach } from "vitest";

vi.mock("$lib/api", () => ({
  setDialogMode: vi.fn(),
  focusActiveWorkspace: vi.fn(),
}));

// Mock dialog state - update in individual tests as needed
vi.mock("./dialogs.svelte", () => ({
  dialogState: { value: { type: "closed" } },
}));

beforeEach(() => {
  vi.clearAllMocks();
  reset(); // Reset store state between tests
});
```

### Unit Tests

| Test Case                                         | Description                                   | File                      |
| ------------------------------------------------- | --------------------------------------------- | ------------------------- |
| should-have-inactive-state-initially              | Initial state is false                        | `shortcuts.test.ts`       |
| should-enable-shortcut-mode-when-no-dialog-open   | Enable sets active to true                    | `shortcuts.test.ts`       |
| should-ignore-enable-when-dialog-is-open          | Enable ignored during dialog                  | `shortcuts.test.ts`       |
| should-disable-shortcut-mode-and-restore-state    | Disable sets active false, calls APIs         | `shortcuts.test.ts`       |
| should-ignore-disable-when-already-inactive       | Disable when inactive is no-op                | `shortcuts.test.ts`       |
| should-exit-shortcut-mode-on-alt-keyup            | Alt keyup calls exitShortcutMode              | `shortcuts.test.ts`       |
| should-ignore-keyup-for-non-alt-keys              | Non-Alt keyup is ignored                      | `shortcuts.test.ts`       |
| should-ignore-keyup-when-inactive                 | Alt keyup when inactive is no-op              | `shortcuts.test.ts`       |
| should-ignore-repeat-keyup-events                 | event.repeat=true is ignored                  | `shortcuts.test.ts`       |
| should-exit-shortcut-mode-on-window-blur          | Blur calls exitShortcutMode                   | `shortcuts.test.ts`       |
| should-call-setDialogMode-false-on-exit           | exitShortcutMode calls setDialogMode(false)   | `shortcuts.test.ts`       |
| should-call-focusActiveWorkspace-on-exit          | exitShortcutMode calls focusActiveWorkspace() | `shortcuts.test.ts`       |
| should-update-dialogOpen-when-dialogState-changes | $derived reactivity works                     | `shortcuts.test.ts`       |
| should-handle-rapid-enable-disable-toggle         | Rapid state changes are consistent            | `shortcuts.test.ts`       |
| should-reset-state-for-testing                    | reset() sets state to false                   | `shortcuts.test.ts`       |
| should-show-overlay-with-opacity-1-when-active    | Shows when active=true                        | `ShortcutOverlay.test.ts` |
| should-hide-overlay-with-opacity-0-when-inactive  | Hidden when active=false                      | `ShortcutOverlay.test.ts` |
| should-have-role-status-attribute                 | Has role="status"                             | `ShortcutOverlay.test.ts` |
| should-have-aria-live-polite-attribute            | Has aria-live="polite"                        | `ShortcutOverlay.test.ts` |
| should-have-aria-hidden-when-inactive             | Has aria-hidden={true} when inactive          | `ShortcutOverlay.test.ts` |
| should-announce-state-change-for-screen-readers   | sr-only text appears when active              | `ShortcutOverlay.test.ts` |
| should-have-aria-labels-on-hint-symbols           | Symbols have aria-label attributes            | `ShortcutOverlay.test.ts` |
| should-display-all-keyboard-hints                 | Shows Navigate, New, Del, Jump hints          | `ShortcutOverlay.test.ts` |
| should-have-opacity-transition-css                | Has transition property                       | `ShortcutOverlay.test.ts` |
| should-have-z-index-for-layering                  | Has z-index: 9999                             | `ShortcutOverlay.test.ts` |
| should-render-shortcut-overlay-component          | Overlay in App                                | `App.test.ts`             |
| should-pass-active-prop-to-overlay                | Overlay receives shortcutModeActive.value     | `App.test.ts`             |
| should-wire-keyup-handler-to-window               | handleKeyUp connected to window               | `App.test.ts`             |
| should-wire-blur-handler-to-window                | handleWindowBlur connected to window          | `App.test.ts`             |
| should-subscribe-to-shortcut-enable-on-mount      | onShortcutEnable subscribed                   | `App.test.ts`             |
| should-subscribe-to-shortcut-disable-on-mount     | onShortcutDisable subscribed                  | `App.test.ts`             |
| should-cleanup-subscriptions-on-unmount           | Unsubscribe called on unmount                 | `App.test.ts`             |

### Integration Tests

| Test Case                     | Description                                                       | File                  |
| ----------------------------- | ----------------------------------------------------------------- | --------------------- |
| keyboard-activation-full-flow | Alt+X → overlay shows → Alt release → overlay hides → APIs called | `integration.test.ts` |

### Manual Testing Checklist

**Basic Functionality:**

- [ ] Press Alt+X → overlay fades in at bottom center
- [ ] Release Alt → overlay fades out smoothly (content visible during fade)
- [ ] Alt+X then Alt+Tab → overlay disappears
- [ ] Alt+X then release Alt very quickly → overlay still disappears (tests race condition where Alt released before focus switches)
- [ ] While dialog is open, Alt+X → nothing happens (dialog takes precedence)
- [ ] Close dialog, Alt+X → overlay appears normally
- [ ] Verify overlay shows all hints: ↑↓ Navigate, ⏎ New, ⌫ Del, 1-0 Jump
- [ ] Verify no console.log statements appear (KEYBOARD_WIRING logs removed)

**Focus & Transparency:**

- [ ] Verify focus is on UI layer when overlay visible (DevTools → Elements tab → check focus outline)
- [ ] Verify VS Code is visible through transparent UI layer during shortcut mode
- [ ] Verify sidebar remains opaque (not transparent) during shortcut mode

**Accessibility:**

- [ ] Test with screen reader (NVDA/JAWS on Windows, Orca on Linux) - verify "Shortcut mode active" announced
- [ ] Verify keyboard hints are readable by screen reader (aria-labels work)
- [ ] Verify all functionality works without mouse

**Platform-Specific:**

- [ ] Linux: Verify Alt doesn't interfere with window manager shortcuts (GNOME/KDE)
- [ ] Windows: Verify Alt doesn't inadvertently activate menu bar
- [ ] macOS: Verify Option+X works correctly (if applicable)

## Dependencies

| Package | Purpose             | Approved |
| ------- | ------------------- | -------- |
| (none)  | No new dependencies | N/A      |

## Documentation Updates

### Files to Update

| File                   | Changes Required                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/ARCHITECTURE.md` | Add "Keyboard Capture System" section after "External URL Handling" (around line 203)                                                  |
| `AGENTS.md`            | Add to Key Concepts table: `Shortcut Mode \| Keyboard-driven navigation activated by Alt+X, shows overlay with workspace action hints` |

### New Section for ARCHITECTURE.md

```markdown
## Keyboard Capture System

CodeHydra uses a two-phase keyboard capture system to enable shortcuts inside VS Code views.

### Phase 1: Activation Detection (Main Process)

The `ShortcutController` uses Electron's `before-input-event` API to intercept keyboard events
before they reach VS Code. It detects the Alt+X activation sequence:

- Alt keydown → Enter ALT_WAITING state, prevent event
- X keydown (while ALT_WAITING) → Activate shortcut mode, focus UI layer
- Non-X keydown (while ALT_WAITING) → Let through to VS Code with altKey modifier
- Alt keyup → Always suppressed (VS Code never sees Alt-only events)

### Phase 2: Action Handling (UI Layer)

Once activated, the UI layer has focus and handles keys directly via DOM events:

- Action keys (0-9, arrows, Enter, Delete) → Execute workspace actions
- Alt keyup → Exit shortcut mode, return focus to VS Code
- Window blur → Exit shortcut mode (handles Alt+Tab)

### Key Files

| File                                          | Purpose                            |
| --------------------------------------------- | ---------------------------------- |
| `src/main/shortcut-controller.ts`             | Activation detection state machine |
| `src/renderer/lib/stores/shortcuts.svelte.ts` | UI layer state and handlers        |
```

## Definition of Done

- [x] All implementation steps complete
- [x] All tests pass
- [x] `pnpm validate:fix` passes
- [ ] Manual testing checklist completed
- [x] Documentation updated
- [ ] Overlay appears/disappears correctly with fade transition
