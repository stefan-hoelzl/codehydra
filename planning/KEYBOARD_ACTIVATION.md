---
status: REVIEW_PENDING
last_updated: 2025-12-07
reviewers: []
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

**Depends on**: `KEYBOARD_WIRING` must be completed first.

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

## Shared Types

Create `src/shared/shortcuts.ts` for types used by future action handlers:

```typescript
// src/shared/shortcuts.ts

export const NAVIGATION_KEYS = ["ArrowUp", "ArrowDown"] as const;
export const DIALOG_KEYS = ["Enter", "Delete", "Backspace"] as const;
export const JUMP_KEYS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
export const ACTION_KEYS = [...NAVIGATION_KEYS, ...DIALOG_KEYS, ...JUMP_KEYS] as const;

export type NavigationKey = (typeof NAVIGATION_KEYS)[number];
export type DialogKey = (typeof DIALOG_KEYS)[number];
export type JumpKey = (typeof JUMP_KEYS)[number];
export type ActionKey = (typeof ACTION_KEYS)[number];

const navigationKeySet = new Set<string>(NAVIGATION_KEYS);
const dialogKeySet = new Set<string>(DIALOG_KEYS);
const jumpKeySet = new Set<string>(JUMP_KEYS);
const actionKeySet = new Set<string>(ACTION_KEYS);

export function isNavigationKey(key: string): key is NavigationKey {
  return navigationKeySet.has(key);
}

export function isDialogKey(key: string): key is DialogKey {
  return dialogKeySet.has(key);
}

export function isJumpKey(key: string): key is JumpKey {
  return jumpKeySet.has(key);
}

export function isActionKey(key: string): key is ActionKey {
  return actionKeySet.has(key);
}
```

## Implementation Steps

- [ ] **Step 1: Shared Types**
  - **Tests first**:
    - `type-guard-navigation`: isNavigationKey identifies ArrowUp/Down
    - `type-guard-dialog`: isDialogKey identifies Enter/Delete/Backspace
    - `type-guard-jump`: isJumpKey identifies 0-9
    - `type-guard-action`: isActionKey identifies all action keys
    - `type-guard-rejects-invalid`: Guards return false for invalid keys
  - Create `src/shared/shortcuts.ts` with types and guards
  - Files affected: `src/shared/shortcuts.ts` (new), `src/shared/shortcuts.test.ts` (new)

- [ ] **Step 2: Shortcut Store**
  - **Tests first**:
    - `store-initial-state`: shortcutModeActive is false initially
    - `store-enable`: handleShortcutEnable sets active to true
    - `store-enable-when-dialog`: handleShortcutEnable ignored if dialog open
    - `store-alt-release`: handleKeyUp with Alt exits shortcut mode
    - `store-blur-exit`: handleWindowBlur exits shortcut mode
    - `store-exit-calls-api`: exitShortcutMode calls setDialogMode(false)
  - Create `src/renderer/lib/stores/shortcuts.svelte.ts`:

  ```typescript
  import { api } from "$lib/api";
  import { dialogState } from "./dialogs.svelte";

  let shortcutModeActive = $state(false);
  let dialogOpen = $derived(dialogState.value.type !== "closed");

  function handleShortcutEnable(): void {
    if (dialogOpen) return;
    shortcutModeActive = true;
  }

  function handleKeyUp(event: KeyboardEvent): void {
    if (event.key === "Alt" && shortcutModeActive) {
      exitShortcutMode();
    }
  }

  function handleWindowBlur(): void {
    if (shortcutModeActive) {
      exitShortcutMode();
    }
  }

  function exitShortcutMode(): void {
    shortcutModeActive = false;
    void api.setDialogMode(false);
  }

  export const shortcuts = {
    get active() {
      return shortcutModeActive;
    },
    handleShortcutEnable,
    handleKeyUp,
    handleWindowBlur,
  };
  ```

  - Files affected: `src/renderer/lib/stores/shortcuts.svelte.ts` (new), `src/renderer/lib/stores/shortcuts.test.ts` (new)

- [ ] **Step 3: Shortcut Overlay Component**
  - **Tests first**:
    - `overlay-renders-when-active`: Shows when active prop is true
    - `overlay-hidden-when-inactive`: Hidden when active is false
    - `overlay-has-aria-status`: Has role="status"
    - `overlay-has-aria-live`: Has aria-live="polite"
    - `overlay-shows-hints`: Displays keyboard hints
    - `overlay-has-transition`: Has opacity transition CSS
  - Create `src/renderer/lib/components/ShortcutOverlay.svelte`:

  ```svelte
  <script lang="ts">
    interface Props {
      active: boolean;
    }

    let { active }: Props = $props();
  </script>

  <div class="shortcut-overlay" class:active role="status" aria-live="polite">
    {#if active}
      <span>↑↓ Navigate</span>
      <span>⏎ New</span>
      <span>⌫ Del</span>
      <span>1-0 Jump</span>
    {/if}
  </div>

  <style>
    .shortcut-overlay {
      position: fixed;
      bottom: 1rem;
      left: 50%;
      transform: translateX(-50%);
      background: var(--vscode-editor-background, rgba(30, 30, 30, 0.9));
      border: 1px solid var(--vscode-panel-border, #454545);
      border-radius: 4px;
      padding: 0.5rem 1rem;
      display: flex;
      gap: 1.5rem;
      font-size: 0.875rem;
      color: var(--vscode-foreground, #cccccc);
      opacity: 0;
      pointer-events: none;
      transition: opacity 150ms ease-in-out;
    }

    .shortcut-overlay.active {
      opacity: 1;
    }
  </style>
  ```

  - Files affected: `src/renderer/lib/components/ShortcutOverlay.svelte` (new), `src/renderer/lib/components/ShortcutOverlay.test.ts` (new)

- [ ] **Step 4: App.svelte Integration**
  - **Tests first**:
    - `app-renders-overlay`: ShortcutOverlay is rendered
    - `app-passes-active-prop`: Overlay receives shortcuts.active
    - `app-wires-keyup`: handleKeyUp connected to svelte:window
    - `app-wires-blur`: handleWindowBlur connected to svelte:window
    - `app-subscribes-enable`: onShortcutEnable subscription on mount
  - Replace console.log wiring with store + overlay:

  ```svelte
  <script lang="ts">
    import { onMount } from "svelte";
    import { api } from "$lib/api";
    import { shortcuts } from "$lib/stores/shortcuts.svelte";
    import ShortcutOverlay from "$lib/components/ShortcutOverlay.svelte";

    onMount(() => {
      return api.onShortcutEnable(shortcuts.handleShortcutEnable);
    });
  </script>

  <svelte:window onkeyup={shortcuts.handleKeyUp} onblur={shortcuts.handleWindowBlur} />

  <!-- Existing content... -->

  <ShortcutOverlay active={shortcuts.active} />
  ```

  - Files affected: `src/renderer/App.svelte`, `src/renderer/App.test.ts`

## Testing Strategy

### Unit Tests

| Test Case                    | Description                  | File                                                  |
| ---------------------------- | ---------------------------- | ----------------------------------------------------- |
| type-guard-navigation        | isNavigationKey works        | `src/shared/shortcuts.test.ts`                        |
| type-guard-dialog            | isDialogKey works            | `src/shared/shortcuts.test.ts`                        |
| type-guard-jump              | isJumpKey works              | `src/shared/shortcuts.test.ts`                        |
| type-guard-action            | isActionKey works            | `src/shared/shortcuts.test.ts`                        |
| type-guard-rejects-invalid   | Guards reject invalid keys   | `src/shared/shortcuts.test.ts`                        |
| store-initial-state          | Initial state is inactive    | `src/renderer/lib/stores/shortcuts.test.ts`           |
| store-enable                 | Enable sets active           | `src/renderer/lib/stores/shortcuts.test.ts`           |
| store-enable-when-dialog     | Enable ignored during dialog | `src/renderer/lib/stores/shortcuts.test.ts`           |
| store-alt-release            | Alt keyup exits              | `src/renderer/lib/stores/shortcuts.test.ts`           |
| store-blur-exit              | Window blur exits            | `src/renderer/lib/stores/shortcuts.test.ts`           |
| store-exit-calls-api         | Exit calls setDialogMode     | `src/renderer/lib/stores/shortcuts.test.ts`           |
| overlay-renders-when-active  | Shows when active            | `src/renderer/lib/components/ShortcutOverlay.test.ts` |
| overlay-hidden-when-inactive | Hidden when inactive         | `src/renderer/lib/components/ShortcutOverlay.test.ts` |
| overlay-has-aria-status      | Has role="status"            | `src/renderer/lib/components/ShortcutOverlay.test.ts` |
| overlay-shows-hints          | Shows keyboard hints         | `src/renderer/lib/components/ShortcutOverlay.test.ts` |
| app-renders-overlay          | Overlay in App               | `src/renderer/App.test.ts`                            |
| app-wires-keyup              | KeyUp handler wired          | `src/renderer/App.test.ts`                            |

### Manual Testing Checklist

- [ ] Press Alt+X → overlay fades in at bottom center
- [ ] Release Alt → overlay fades out
- [ ] Alt+X then Alt+Tab → overlay disappears
- [ ] While dialog is open, Alt+X → nothing happens (dialog takes precedence)
- [ ] Close dialog, Alt+X → overlay appears normally
- [ ] Verify overlay shows all hints: ↑↓ Navigate, ⏎ New, ⌫ Del, 1-0 Jump
- [ ] Verify focus is on UI layer when overlay visible (can verify via DevTools)

## Dependencies

| Package | Purpose             | Approved |
| ------- | ------------------- | -------- |
| (none)  | No new dependencies | N/A      |

## Documentation Updates

### Files to Update

| File                   | Changes Required                                  |
| ---------------------- | ------------------------------------------------- |
| `docs/ARCHITECTURE.md` | Add "Keyboard Capture System" section (see below) |
| `AGENTS.md`            | Add ShortcutController to Key Concepts table      |

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
| `src/shared/shortcuts.ts`                     | Type definitions and guards        |
| `src/main/shortcut-controller.ts`             | Activation detection state machine |
| `src/renderer/lib/stores/shortcuts.svelte.ts` | UI layer state and handlers        |
```

## Definition of Done

- [ ] All implementation steps complete
- [ ] All tests pass
- [ ] `pnpm validate:fix` passes
- [ ] Manual testing checklist completed
- [ ] Documentation updated
- [ ] Overlay appears/disappears correctly with fade transition
