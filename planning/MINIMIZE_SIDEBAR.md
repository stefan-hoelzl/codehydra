---
status: COMPLETED
last_updated: 2025-12-16
reviewers: []
---

# MINIMIZE_SIDEBAR

## Overview

- **Problem**: The sidebar takes 250px of horizontal space, reducing the available area for VS Code content. Users spend most time in VS Code, so sidebar should be unobtrusive by default.
- **Solution**: Minimize sidebar by default to 20px, showing only status indicators. Expand on hover, when UI mode is not "workspace", or when no workspaces exist. Expansion overlays VS Code (doesn't push it).
- **Risks**:
  - Hover detection edge cases (mouse leaving during animation) - mitigated with 150ms debounce
  - Performance of overlay animation - mitigated with transform-based animation (not width)
- **Non-goals**:
  - Touch device support (desktop app only)
  - Keyboard accessibility in minimized state (keyboard navigation only available in shortcut mode, when sidebar is already expanded)
- **Alternatives Considered**:
  - Collapsible sidebar with toggle button - rejected because it requires explicit user action
  - Auto-hide completely - rejected because status indicators are valuable at-a-glance info

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ MainView (position: relative)                                   │
│ ┌──────────────────────────────────────────────────────────────┐│
│ │ Sidebar (position: absolute, left: 0)                        ││
│ │ ┌────────────────────────────────────────────────────────┐   ││
│ │ │ Always rendered at 250px width                         │   ││
│ │ │ Uses transform: translateX(-230px) when minimized      │   ││
│ │ │ Only leftmost 20px visible (status indicators)         │   ││
│ │ │                                                        │   ││
│ │ │ ┌──────┐┌─────────────────────────────────────────┐    │   ││
│ │ │ │ 20px ││ 230px (hidden when minimized)           │    │   ││
│ │ │ │status││ Full workspace names, actions, etc.     │    │   ││
│ │ │ │icons ││                                         │    │   ││
│ │ │ └──────┘└─────────────────────────────────────────┘    │   ││
│ │ └────────────────────────────────────────────────────────┘   ││
│ └──────────────────────────────────────────────────────────────┘│
│ ┌──────────────────────────────────────────────────────────────┐│
│ │ VS Code Content Area (starts at x=20px, beneath expanded     ││
│ │                       sidebar overlay)                       ││
│ └──────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘

State Diagram:

  ┌─────────────┐
  │  MINIMIZED  │◄──────────────────┐
  │   (20px)    │                   │
  │ translateX  │                   │
  │  (-230px)   │                   │
  └──────┬──────┘                   │
         │                          │
         │ hover OR                 │ !hover AND
         │ uiMode !== "workspace"   │ uiMode === "workspace" AND
         │ OR totalWorkspaces === 0 │ totalWorkspaces > 0
         ▼                          │ (with 150ms debounce)
  ┌─────────────┐                   │
  │  EXPANDED   │───────────────────┘
  │   (250px)   │
  │ translateX  │
  │    (0)      │
  └─────────────┘

Expansion Condition (explicit):
  isExpanded = isHovering || uiMode !== "workspace" || totalWorkspaces === 0
  where totalWorkspaces = sum of workspaces across ALL projects

UI Modes (from main process):
- "workspace" → sidebar can minimize, UI layer behind workspace
- "shortcut"  → sidebar always expanded, UI layer on top
- "dialog"    → sidebar always expanded, UI layer on top

Z-Order Management (Central UI Mode Store):
┌─────────────────────────────────────────────────────────────┐
│                    ui-mode.svelte.ts                        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Inputs (state):                                       │  │
│  │   - modeFromMain: UIMode (from IPC events)            │  │
│  │   - dialogOpen: boolean (from dialog state)           │  │
│  │   - sidebarExpanded: boolean (from hover state)       │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │ Derived:                                              │  │
│  │   desiredMode = shortcut ? "shortcut"                 │  │
│  │                : (dialogOpen || sidebarExpanded)      │  │
│  │                  ? "dialog" : "workspace"             │  │
│  ├───────────────────────────────────────────────────────┤  │
│  │ Output (single $effect):                              │  │
│  │   api.ui.setMode(desiredMode)                         │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         ▲               ▲                    ▲
         │               │                    │
    App.svelte      MainView.svelte      Sidebar.svelte
   (IPC events)     (dialog state)       (hover state)
```

## UI Design

### Minimized State (20px visible)

```
┌──────────────────────┐
│ ▸│ PROJECTS...       │  ← Only "▸│" visible (chevron + border)
├──┼───────────────────┤
│██│ my-project        │  ← Status indicator visible, rest clipped
│░░│   main       × ██ │  ← Active: highlighted bg on indicator row
│  │   feature    × ░░ │
├──┼───────────────────┤  ← vscode-divider between projects
│██│ other-project     │
│  │   develop    ×    │
├──┼───────────────────┤
│ ▸│ [Open Project]    │  ← Bottom chevron visible
└──┴───────────────────┘
 ↑
20px visible (rest clipped via overflow + transform)

Status indicator visual (reuses AgentStatusIndicator):
██ = busy (red, pulsing)
░░ = idle (green)
   = none (no indicator shown)

Each workspace row: minimum 44px height for accessible click target
```

### Expanded State (250px, overlay with shadow)

```
┌─────────────────────────────────────────┐
│ PROJECTS                                │
├─────────────────────────────────────────┤
│ my-project                        + ×   │
│   ├─ main                        ×  ██  │  ← Active: highlighted bg
│   └─ feature-branch              ×  ░░  │
├─────────────────────────────────────────┤
│ other-project                     + ×   │
│   └─ develop                     ×      │
├─────────────────────────────────────────┤
│ [        Open Project           ]       │
└─────────────────────────────────────────┘
          ↑
       250px with box-shadow overlay effect
```

### User Interactions

- **Hover minimized sidebar**: Expands with 150ms transform animation
- **Mouse leaves expanded sidebar**: Collapses after 150ms debounce delay
- **Click status indicator area**: Switches to that workspace
- **UI mode changes to shortcut/dialog**: Sidebar expands automatically
- **UI mode returns to workspace**: Sidebar collapses (if not hovering, after debounce)
- **All workspaces deleted**: Sidebar stays expanded

## Implementation Steps

### Step 1: Add CSS variables for sidebar dimensions and z-index

- [x] **1.1**: Add variables to `variables.css`:

  ```css
  /* Existing */
  --ch-sidebar-width: 250px;

  /* New */
  --ch-sidebar-minimized-width: 20px;
  --ch-sidebar-transition: 150ms ease-out;
  --ch-z-sidebar-minimized: 1;
  --ch-z-sidebar-expanded: 50;
  ```

- Files affected: `src/renderer/lib/styles/variables.css`

### Step 2: Extend shortcuts store to expose uiMode

- [x] **2.1**: Write failing test for `uiMode` getter in shortcuts store
- [x] **2.2**: Add `uiMode` state and getter to `shortcuts.svelte.ts`:

  ```typescript
  import type { UIMode } from "@shared/ipc";

  let _uiMode = $state<UIMode>("workspace");

  export const uiMode = {
    get value() {
      return _uiMode;
    },
  };

  export function handleModeChange(event: UIModeChangedEvent): void {
    _uiMode = event.mode;
  }

  // shortcutModeActive becomes derived
  export const shortcutModeActive = {
    get value() {
      return _uiMode === "shortcut";
    },
  };
  ```

- [x] **2.3**: Write test verifying `shortcutModeActive` derives correctly from `uiMode`
- [x] **2.4**: Update `exitShortcutMode()` to only call `api.ui.setMode("workspace")` - state updates via IPC event callback
- Files affected: `src/renderer/lib/stores/shortcuts.svelte.ts`, `src/renderer/lib/stores/shortcuts.svelte.test.ts`

### Step 3: Add minimized state rendering to Sidebar component

Extend existing Sidebar to handle both states (avoids duplicating project/workspace iteration logic).

- [x] **3.1**: Write failing test for Sidebar with status indicator column
- [x] **3.2**: Add status indicator column (leftmost 20px) to each workspace row:
  - Wrap existing `AgentStatusIndicator` in a clickable button
  - Each workspace row: minimum 44px height for accessible click target
  - Active workspace indicator row has highlighted background
- [x] **3.3**: Add ARIA labels to status indicator buttons:
  ```svelte
  <button
    class="status-indicator-btn"
    aria-label="{workspace.name} in {project.name} - {statusText}"
    aria-current={isActive ? "true" : undefined}
    onclick={() => onSwitchWorkspace(ref)}
  >
    <AgentStatusIndicator ... />
  </button>
  ```
- [x] **3.4**: Add expand hint chevrons (▸) in header and footer using `<vscode-button appearance="icon">`
- [x] **3.5**: Ensure `<vscode-divider>` between projects is visible in minimized state
- [x] **3.6**: Write tests for:
  - Status indicator column renders for each workspace
  - Active workspace has highlight class on indicator row
  - Clicking indicator calls `onSwitchWorkspace`
  - Indicators have descriptive aria-label
  - Active indicator has `aria-current="true"`
  - Dividers appear between projects
  - Empty projects array renders correctly
- Files affected: `src/renderer/lib/components/Sidebar.svelte`, `src/renderer/lib/components/Sidebar.test.ts`

### Step 4: Add expansion state and hover logic to Sidebar

- [x] **4.1**: Write failing test for expansion on mouseenter
- [x] **4.2**: Add props and expansion state management:

  ```typescript
  interface SidebarProps {
    // ... existing props
    totalWorkspaces: number;
  }

  let isHovering = $state(false);
  let collapseTimeout: ReturnType<typeof setTimeout> | null = null;

  const isExpanded = $derived(isHovering || uiMode.value !== "workspace" || totalWorkspaces === 0);

  function handleMouseEnter() {
    if (collapseTimeout) {
      clearTimeout(collapseTimeout);
      collapseTimeout = null;
    }
    isHovering = true;
  }

  function handleMouseLeave() {
    collapseTimeout = setTimeout(() => {
      isHovering = false;
      collapseTimeout = null;
    }, 150); // 150ms debounce
  }
  ```

- [x] **4.3**: Clean up timeout on component destroy
- [x] **4.4**: Write tests for:
  - Expands on mouseenter
  - Collapses on mouseleave after 150ms debounce
  - Stays expanded when `uiMode !== "workspace"`
  - Stays expanded when `totalWorkspaces === 0`
  - Rapid mouseenter/mouseleave settles to correct final state
  - Timeout is cleared on unmount
- Files affected: `src/renderer/lib/components/Sidebar.svelte`, `src/renderer/lib/components/Sidebar.test.ts`

### Step 5: Add CSS for transform-based animation

- [x] **5.1**: Update Sidebar CSS for overlay positioning and transform animation:

  ```css
  .sidebar {
    position: absolute;
    left: 0;
    top: 0;
    width: var(--ch-sidebar-width);
    height: 100%;
    transform: translateX(calc(-1 * (var(--ch-sidebar-width) - var(--ch-sidebar-minimized-width))));
    transition:
      transform var(--ch-sidebar-transition),
      box-shadow var(--ch-sidebar-transition),
      z-index 0s;
    z-index: var(--ch-z-sidebar-minimized);
    overflow: hidden;
    background: var(--ch-background);
  }

  .sidebar.expanded {
    transform: translateX(0);
    z-index: var(--ch-z-sidebar-expanded);
    box-shadow: var(--ch-shadow);
  }

  @media (prefers-reduced-motion: reduce) {
    .sidebar {
      transition: none;
    }
  }
  ```

- [x] **5.2**: Write test verifying transition is disabled when `prefers-reduced-motion: reduce`
- Files affected: `src/renderer/lib/components/Sidebar.svelte`, `src/renderer/lib/components/Sidebar.test.ts`

### Step 6: Update MainView layout

- [x] **6.1**: Write failing test for MainView passing `totalWorkspaces` to Sidebar
- [x] **6.2**: Update MainView:
  - Compute `totalWorkspaces` from `getAllWorkspaces().length`
  - Pass `totalWorkspaces` prop to Sidebar
  - Update empty-backdrop `left` to use `--ch-sidebar-minimized-width`
  - Adjust layout since sidebar is now absolutely positioned (not in flex flow)
- [x] **6.3**: Write tests for:
  - MainView passes correct totalWorkspaces count
  - Empty backdrop left offset uses minimized width variable
- Files affected: `src/renderer/lib/components/MainView.svelte`, `src/renderer/lib/components/MainView.test.ts`

### Step 7: Verify ViewManager bounds (if needed)

- [x] **7.1**: Check if ViewManager in main process calculates workspace view bounds
- [x] **7.2**: If bounds exclude sidebar width, update to use minimized width (20px left offset)
- [x] **7.3**: Test that VS Code content area is positioned correctly
- Files affected: `src/main/managers/view-manager.ts` (if applicable)

### Step 8: Update documentation

- [x] **8.1**: Update `docs/USER_INTERFACE.md`:
  - Update Application Layout diagram to show minimized/expanded states
  - Update Layout Dimensions: "20px minimized, 250px expanded on hover"
  - Add section documenting sidebar expansion behavior
  - Document when sidebar is forced-expanded (shortcut/dialog modes, no workspaces)
- Files affected: `docs/USER_INTERFACE.md`

### Step 9: Create central ui-mode store for z-order management

The sidebar expansion on hover doesn't work because the UI layer z-order is controlled by the main process. We need a central store that manages all mode transitions and calls `api.ui.setMode()` in one place.

**IMPORTANT**: The ui-mode store is the ONLY place that calls `api.ui.setMode()`. No component should ever call this API directly - they should only update store inputs.

**TDD**: Write failing tests FIRST (Step 9.1), then implement to make them pass.

- [x] **9.1**: Write failing tests for `ui-mode.svelte.ts` store in `ui-mode.svelte.test.ts`:

  **Derived state tests:**
  - `ui-mode store: initial state is workspace mode`
  - `ui-mode store: modeFromMain="shortcut" takes priority even when dialogOpen=true and sidebarExpanded=true`
  - `ui-mode store: dialogOpen=true results in desiredMode="dialog"`
  - `ui-mode store: sidebarExpanded=true results in desiredMode="dialog"`
  - `ui-mode store: both dialogOpen=true and sidebarExpanded=true results in desiredMode="dialog"`
  - `ui-mode store: all inputs false results in desiredMode="workspace"`
  - `ui-mode store: modeFromMain transition from shortcut to workspace respects dialogOpen`

  **$effect IPC tests (mock api.ui.setMode):**
  - `ui-mode store: $effect calls api.ui.setMode when desiredMode changes`
  - `ui-mode store: $effect does NOT call api.ui.setMode when inputs change but desiredMode stays same`
  - `ui-mode store: $effect passes correct mode value to api.ui.setMode`

  **Reset/cleanup tests:**
  - `ui-mode store: reset() restores initial state`

- [x] **9.2**: Create `ui-mode.svelte.ts` store:

  ```typescript
  import * as api from "$lib/api";
  import type { UIMode } from "@shared/ipc";

  // ============ State (inputs from different sources) ============

  let _modeFromMain = $state<UIMode>("workspace");
  let _dialogOpen = $state(false);
  let _sidebarExpanded = $state(false);

  // Track last emitted mode to prevent duplicate IPC calls
  let _lastEmittedMode: UIMode | null = null;

  // ============ Pure function for mode derivation (testable) ============

  /**
   * Compute desired UI mode from inputs.
   * Priority: shortcut > (dialog | sidebarExpanded) > workspace
   *
   * Note: Both dialog and sidebarExpanded map to "dialog" for IPC purposes
   * because they both need the UI layer on top of workspace views.
   */
  export function computeDesiredMode(
    modeFromMain: UIMode,
    dialogOpen: boolean,
    sidebarExpanded: boolean
  ): UIMode {
    if (modeFromMain === "shortcut") return "shortcut";
    if (dialogOpen || sidebarExpanded) return "dialog";
    return "workspace";
  }

  // ============ Derived State ============

  const _desiredMode = $derived(computeDesiredMode(_modeFromMain, _dialogOpen, _sidebarExpanded));

  // ============ Getters (follow store pattern) ============

  export const uiMode = {
    get value(): UIMode {
      return _modeFromMain;
    },
  };

  export const desiredMode = {
    get value(): UIMode {
      return _desiredMode;
    },
  };

  export const shortcutModeActive = {
    get value(): boolean {
      return _modeFromMain === "shortcut";
    },
  };

  // ============ Setters ============

  export function setModeFromMain(mode: UIMode): void {
    _modeFromMain = mode;
  }

  export function setDialogOpen(open: boolean): void {
    _dialogOpen = open;
  }

  export function setSidebarExpanded(expanded: boolean): void {
    _sidebarExpanded = expanded;
  }

  // ============ Effect: Sync with main process ============

  // Note: This $effect persists for the application lifetime.
  // It uses deduplication to prevent redundant IPC calls.
  $effect(() => {
    const desired = _desiredMode;
    if (desired !== _lastEmittedMode) {
      _lastEmittedMode = desired;
      void api.ui.setMode(desired);
    }
  });

  // ============ Testing ============

  export function reset(): void {
    _modeFromMain = "workspace";
    _dialogOpen = false;
    _sidebarExpanded = false;
    _lastEmittedMode = null;
  }
  ```

- [x] **9.3**: Update `shortcuts.svelte.ts` (one-way dependency: shortcuts → ui-mode):

  **Before:**

  ```typescript
  let _uiMode = $state<UIMode>("workspace");

  export const uiMode = {
    get value() {
      return _uiMode;
    },
  };

  export const shortcutModeActive = {
    get value() {
      return _uiMode === "shortcut";
    },
  };

  export function handleModeChange(event: UIModeChangedEvent): void {
    _uiMode = event.mode;
  }
  ```

  **After:**

  ```typescript
  // Import from ui-mode store (one-way dependency)
  import { uiMode, shortcutModeActive, setModeFromMain } from "./ui-mode.svelte.js";

  // Re-export for existing consumers
  export { uiMode, shortcutModeActive };

  export function handleModeChange(event: UIModeChangedEvent): void {
    setModeFromMain(event.mode);
  }
  ```

  - Remove local `_uiMode` $state variable entirely
  - Import `uiMode`, `shortcutModeActive`, `setModeFromMain` from ui-mode store
  - Re-export `uiMode` and `shortcutModeActive` for existing consumers
  - Update `handleModeChange()` to call `setModeFromMain()`

- [x] **9.4**: Update `MainView.svelte`:
  - Import `setDialogOpen` from ui-mode store
  - Change $effect to call `setDialogOpen(isDialogOpen)` instead of `api.ui.setMode()`
  - **REMOVE** direct `api.ui.setMode()` call entirely (store is the only caller)

  **Before:**

  ```typescript
  $effect(() => {
    const isDialogOpen = dialogState.value.type !== "closed";
    if (shortcutModeActive.value) {
      return;
    }
    void api.ui.setMode(isDialogOpen ? "dialog" : "workspace");
  });
  ```

  **After:**

  ```typescript
  import { setDialogOpen } from "$lib/stores/ui-mode.svelte.js";

  $effect(() => {
    const isDialogOpen = dialogState.value.type !== "closed";
    setDialogOpen(isDialogOpen);
    // Note: shortcutModeActive guard not needed - ui-mode store handles priority
  });
  ```

- [x] **9.5**: Update `Sidebar.svelte`:
  - Import `setSidebarExpanded` from ui-mode store
  - Call `setSidebarExpanded(true)` in `handleMouseEnter()`
  - Call `setSidebarExpanded(false)` in debounced collapse callback
  - Add `$effect` to clear `isHovering` when entering shortcut mode (cleanup)
  - Remove debug console.log statements

  ```typescript
  import { setSidebarExpanded, shortcutModeActive } from "$lib/stores/ui-mode.svelte.js";

  function handleMouseEnter(): void {
    if (collapseTimeout) {
      clearTimeout(collapseTimeout);
      collapseTimeout = null;
    }
    isHovering = true;
    setSidebarExpanded(true);
  }

  function handleMouseLeave(): void {
    collapseTimeout = setTimeout(() => {
      isHovering = false;
      setSidebarExpanded(false);
      collapseTimeout = null;
    }, 150);
  }

  // Clear hover state when entering shortcut mode
  $effect(() => {
    if (shortcutModeActive.value && collapseTimeout) {
      clearTimeout(collapseTimeout);
      collapseTimeout = null;
    }
  });
  ```

- Files affected: `src/renderer/lib/stores/ui-mode.svelte.ts` (new), `src/renderer/lib/stores/ui-mode.svelte.test.ts` (new), `shortcuts.svelte.ts`, `MainView.svelte`, `Sidebar.svelte`

### Step 10: Restore original expanded layout, add minimized-only template

The current implementation moved status indicators to the LEFT for both states. This should be reverted:

- **Expanded state**: Restore ORIGINAL sidebar layout (status indicators on RIGHT, no chevrons)
- **Minimized state**: Use a SEPARATE simplified template showing only clickable status indicators

**TDD**: Write failing tests FIRST (Step 10.1), then implement to make them pass.

**Accessibility**: Do NOT remove workspace names from DOM - screen reader users need them. Use CSS hiding + comprehensive aria-labels.

- [x] **10.1**: Write failing tests in `Sidebar.test.ts`:
  - `Sidebar expanded layout matches original (no status-indicator-btn in workspace rows)`
  - `Sidebar minimized layout shows only status indicators with aria-labels`
  - `Sidebar expand hint only visible when minimized`
  - `Sidebar minimized status-indicator-btn has full aria-label with workspace name`

- [x] **10.2**: Revert expanded layout to original:
  - Remove status-indicator-btn from expanded workspace rows
  - Remove expand-hint chevrons from header/footer in expanded state
  - Keep original workspace-item layout: workspace-btn + remove-btn + AgentStatusIndicator

- [x] **10.3**: Add minimized-only template with conditional rendering:

  In Sidebar.svelte, inside the `{#each project.workspaces as workspace}` loop, replace the current workspace item template:

  ```svelte
  {#if isExpanded}
    <!-- Original expanded layout (unchanged from before this feature) -->
    <li class="workspace-item" class:active={isActive}>
      <button class="workspace-btn" ...>{workspace.name}</button>
      <button class="remove-btn" ...>&times;</button>
      <AgentStatusIndicator ... />
    </li>
  {:else}
    <!-- Minimized: clickable status indicators with full aria-label -->
    <!-- Note: aria-label includes workspace name for screen readers -->
    <li class="workspace-item-minimized" class:active={isActive}>
      <button
        type="button"
        class="status-indicator-btn"
        aria-label="{workspace.name} in {project.name} - {statusText}"
        aria-current={isActive ? "true" : undefined}
        onclick={() => onSwitchWorkspace(ref)}
      >
        <AgentStatusIndicator ... />
      </button>
    </li>
  {/if}
  ```

- [x] **10.4**: Make expand hints more subtle (minimized state only):
  - Show chevron in BOTH header and footer (for visual balance, per mockup)
  - Reduce chevron opacity to 0.5 (meets WCAG contrast requirements)
  - Use minimum 12px font-size (accessibility requirement)
  - Only render chevrons when `!isExpanded`

  ```svelte
  <!-- In header -->
  {#if !isExpanded}
    <span class="expand-hint" aria-hidden="true">
      <span class="chevron">▸</span>
    </span>
  {/if}
  ```

  ```css
  .expand-hint {
    opacity: 0.5;
    font-size: 12px;
  }
  .expand-hint:hover {
    opacity: 1;
  }
  ```

- [x] **10.5**: Extract helper function to avoid type assertion duplication:

  ```typescript
  function toWorkspaceRef(project: ProjectWithId, workspace: Workspace): WorkspaceRef {
    return {
      projectId: project.id,
      workspaceName: workspace.name as WorkspaceName,
      path: workspace.path,
    };
  }
  ```

- Files affected: `src/renderer/lib/components/Sidebar.svelte`, `src/renderer/lib/components/Sidebar.test.ts`

### Step 11: Run validation and fix issues

- [x] **11.1**: Run `npm run validate:fix`
- [x] **11.2**: Fix any TypeScript, ESLint, or test failures
- [ ] **11.3**: Verify 60fps animation performance in DevTools Performance panel
- Files affected: Various (based on issues found)

## Testing Strategy

### Unit Tests (vitest)

| Test Case                                   | Description                                          | File                       |
| ------------------------------------------- | ---------------------------------------------------- | -------------------------- |
| ui-mode store: initial state                | Default desiredMode is "workspace"                   | `ui-mode.svelte.test.ts`   |
| ui-mode store: shortcut priority            | modeFromMain="shortcut" overrides other inputs       | `ui-mode.svelte.test.ts`   |
| ui-mode store: dialogOpen sets dialog       | dialogOpen=true results in desiredMode="dialog"      | `ui-mode.svelte.test.ts`   |
| ui-mode store: sidebarExpanded sets dialog  | sidebarExpanded=true results in desiredMode="dialog" | `ui-mode.svelte.test.ts`   |
| ui-mode store: $effect calls setMode        | api.ui.setMode called when desiredMode changes       | `ui-mode.svelte.test.ts`   |
| ui-mode store: $effect deduplication        | setMode NOT called when desiredMode unchanged        | `ui-mode.svelte.test.ts`   |
| ui-mode store: reset()                      | Restores initial state                               | `ui-mode.svelte.test.ts`   |
| uiMode store tracks mode                    | Updates when mode change event received              | `shortcuts.svelte.test.ts` |
| shortcutModeActive derives from uiMode      | Returns true when uiMode is "shortcut"               | `shortcuts.svelte.test.ts` |
| exitShortcutMode only calls IPC             | Does not directly modify local state                 | `shortcuts.svelte.test.ts` |
| Sidebar renders status indicator column     | Shows clickable indicator per workspace              | `Sidebar.test.ts`          |
| Sidebar shows project dividers              | Renders vscode-divider between projects              | `Sidebar.test.ts`          |
| Sidebar indicator click switches workspace  | Calls onSwitchWorkspace on indicator click           | `Sidebar.test.ts`          |
| Sidebar highlights active indicator row     | Active workspace row has highlight class             | `Sidebar.test.ts`          |
| Sidebar indicator has aria-label            | Describes workspace, project, and status             | `Sidebar.test.ts`          |
| Sidebar active indicator has aria-current   | aria-current="true" on active workspace              | `Sidebar.test.ts`          |
| Sidebar expands on hover                    | mouseenter sets isExpanded=true                      | `Sidebar.test.ts`          |
| Sidebar collapses on leave with debounce    | mouseleave triggers collapse after 150ms             | `Sidebar.test.ts`          |
| Sidebar stays expanded in shortcut mode     | uiMode="shortcut" forces expanded                    | `Sidebar.test.ts`          |
| Sidebar stays expanded in dialog mode       | uiMode="dialog" forces expanded                      | `Sidebar.test.ts`          |
| Sidebar stays expanded when no workspaces   | totalWorkspaces=0 forces expanded                    | `Sidebar.test.ts`          |
| Sidebar rapid hover settles correctly       | Multiple mouseenter/leave settles to final state     | `Sidebar.test.ts`          |
| Sidebar cleans up timeout on unmount        | No memory leak from collapse timeout                 | `Sidebar.test.ts`          |
| Sidebar respects prefers-reduced-motion     | No transition when reduced motion enabled            | `Sidebar.test.ts`          |
| Sidebar with empty projects                 | Renders correctly with no projects                   | `Sidebar.test.ts`          |
| Sidebar with mismatched activeWorkspacePath | Shows no highlight when path doesn't match           | `Sidebar.test.ts`          |
| MainView passes totalWorkspaces             | Sidebar receives correct workspace count             | `MainView.test.ts`         |
| MainView backdrop at minimized width        | Empty backdrop left offset uses CSS variable         | `MainView.test.ts`         |

### Integration Tests

| Test Case                              | Description                                      | File                  |
| -------------------------------------- | ------------------------------------------------ | --------------------- |
| Sidebar expansion syncs with uiMode    | Mode changes from main process trigger expansion | `integration.test.ts` |
| Sidebar expansion on hover in MainView | Hover triggers expansion in full app context     | `MainView.test.ts`    |

### Manual Testing Checklist

- [ ] Hover over minimized sidebar → expands smoothly (150ms)
- [ ] Move mouse away → collapses after brief delay (150ms debounce)
- [ ] Rapid mouse in/out → settles to correct state without flickering
- [ ] Enter shortcut mode (Alt+X) → sidebar expands
- [ ] Exit shortcut mode (Escape) → sidebar collapses (if not hovering)
- [ ] Open create workspace dialog → sidebar stays expanded
- [ ] Close dialog → sidebar collapses (if not hovering)
- [ ] Delete all workspaces → sidebar stays expanded
- [ ] Create first workspace → sidebar can now collapse
- [ ] Click status indicator in minimized view → switches workspace
- [ ] Active workspace indicator is visually distinct
- [ ] Animation respects system "reduce motion" preference
- [ ] Expanded sidebar overlays VS Code content (doesn't push it)
- [ ] Shadow appears on expanded sidebar for depth
- [ ] Animation runs at 60fps (verify in DevTools Performance panel)
- [ ] Status indicators have readable aria-labels (screen reader test)

## Dependencies

No new dependencies required.

## Documentation Updates

### Files to Update

| File                     | Changes Required                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/USER_INTERFACE.md` | Update layout diagram, add minimized sidebar section, document expansion triggers                                                                             |
| `docs/ARCHITECTURE.md`   | Update UI Mode System section to describe centralized mode management via ui-mode store, including the input/derived/effect pattern                           |
| `AGENTS.md`              | Document Central UI Mode Store pattern: multiple $state inputs → single $derived mode → single $effect for IPC. Include when to use this vs distributed state |

### New Documentation Required

None - feature is self-documenting through UI behavior.

## Definition of Done

- [ ] All implementation steps complete
- [ ] `npm run validate:fix` passes
- [ ] Animation runs at 60fps (no jank)
- [ ] Documentation updated
- [ ] User acceptance testing passed
- [ ] Changes committed
