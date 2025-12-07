---
status: REVIEW_PENDING
last_updated: 2025-12-07
reviewers: []
depends_on: KEYBOARD_ACTIVATION
---

# KEYBOARD_ACTIONS

## Overview

- **Problem**: Shortcut mode activates and shows overlay, but pressing action keys does nothing.
- **Solution**: Implement action handlers for navigation, workspace jumping, and dialog opening. Add sidebar index numbers.
- **Risks**:
  - Global workspace indexing across projects may be confusing
  - Edge cases: no workspaces, out-of-range indices
- **Alternatives Considered**:
  - Per-project indexing - rejected because requires knowing which project is "active"

**Depends on**: `KEYBOARD_ACTIVATION` must be completed first.

## User Interactions

| Shortcut             | Action                                 |
| -------------------- | -------------------------------------- |
| Alt+X                | Enter shortcut mode (already works)    |
| Release Alt          | Exit shortcut mode (already works)     |
| Alt+↑                | Navigate to previous workspace (wraps) |
| Alt+↓                | Navigate to next workspace (wraps)     |
| Alt+1 through Alt+9  | Jump to workspace at index 1-9         |
| Alt+0                | Jump to workspace at index 10          |
| Alt+Enter            | Open create workspace dialog           |
| Alt+Delete/Backspace | Open remove workspace dialog           |

## UI Design

### Sidebar with Index Numbers (only in shortcut mode)

```
Normal:                          Shortcut Mode:
┌───────────────────────┐        ┌───────────────────────┐
│ project-a        [+][×]│        │ project-a        [+][×]│
│   └─ feature       [×] │        │   1 feature        [×] │
│   └─ bugfix        [×] │        │   2 bugfix         [×] │
│ project-b        [+][×]│        │ project-b        [+][×]│
│   └─ experiment    [×] │        │   3 experiment     [×] │
└───────────────────────┘        └───────────────────────┘

Index numbering: 1-9, then 0 for 10th. Workspaces 11+ have no shortcut.
```

## Implementation Steps

- [ ] **Step 1: Projects Store Helper Functions**
  - **Tests first**:
    - `get-all-workspaces-flat`: Returns flat array of all workspaces
    - `get-all-workspaces-order`: Order is consistent (project order, then workspace order)
    - `get-all-workspaces-empty`: Returns empty array when no projects
    - `get-workspace-by-index`: Returns workspace at global index
    - `get-workspace-by-index-bounds`: Returns undefined for out-of-range
  - Add helper functions to projects store:

  ```typescript
  // In projects.svelte.ts

  /** Get flat array of all workspaces across all projects. */
  export function getAllWorkspacesFlat(): Workspace[] {
    return projectsState.projects.flatMap((p) => p.workspaces);
  }

  /** Get workspace by global index (0-based). */
  export function getWorkspaceByIndex(index: number): Workspace | undefined {
    const all = getAllWorkspacesFlat();
    return all[index];
  }
  ```

  - Files affected: `src/renderer/lib/stores/projects.svelte.ts`, `src/renderer/lib/stores/projects.test.ts`

- [ ] **Step 2: Action Handlers in Shortcut Store**
  - **Tests first**:
    - `action-navigate-up`: ArrowUp calls navigateWorkspace(-1)
    - `action-navigate-down`: ArrowDown calls navigateWorkspace(+1)
    - `action-navigate-wrap-top`: At first workspace, up wraps to last
    - `action-navigate-wrap-bottom`: At last workspace, down wraps to first
    - `action-navigate-no-workspaces`: No workspaces → no-op
    - `action-jump-1-to-9`: Keys 1-9 jump to indices 0-8
    - `action-jump-0`: Key 0 jumps to index 9
    - `action-jump-out-of-range`: Out of range → no-op
    - `action-enter-opens-create`: Enter opens create dialog
    - `action-delete-opens-remove`: Delete opens remove dialog
    - `action-backspace-opens-remove`: Backspace opens remove dialog
    - `action-dialog-exits-first`: Dialog actions exit shortcut mode first
  - Add to shortcuts store:

  ```typescript
  import { isActionKey, isNavigationKey, isDialogKey, isJumpKey } from "../../shared/shortcuts";
  import { getAllWorkspacesFlat, getWorkspaceByIndex } from "./projects.svelte";
  import { dialogState } from "./dialogs.svelte";

  function handleKeyDown(event: KeyboardEvent): void {
    if (!shortcutModeActive) return;

    if (isActionKey(event.key)) {
      event.preventDefault();
      executeAction(event.key);
    }
  }

  function executeAction(key: ActionKey): void {
    if (isNavigationKey(key)) {
      navigateWorkspace(key === "ArrowUp" ? -1 : 1);
    } else if (isJumpKey(key)) {
      const index = key === "0" ? 9 : parseInt(key, 10) - 1;
      jumpToWorkspace(index);
    } else if (isDialogKey(key)) {
      exitShortcutMode();
      if (key === "Enter") {
        openCreateDialog();
      } else {
        openRemoveDialog();
      }
    }
  }

  function navigateWorkspace(direction: -1 | 1): void {
    const all = getAllWorkspacesFlat();
    if (all.length === 0) return;

    const currentIndex = all.findIndex((w) => w.path === activeWorkspacePath);
    const nextIndex = (currentIndex + direction + all.length) % all.length;
    void api.activateWorkspace(all[nextIndex].path);
  }

  function jumpToWorkspace(index: number): void {
    const workspace = getWorkspaceByIndex(index);
    if (!workspace) return;
    void api.activateWorkspace(workspace.path);
  }

  function openCreateDialog(): void {
    // Use existing dialog state to open create dialog
    dialogState.openCreateWorkspace(activeProjectPath);
  }

  function openRemoveDialog(): void {
    // Use existing dialog state to open remove dialog
    dialogState.openRemoveWorkspace(activeWorkspacePath);
  }
  ```

  - Update exports to include handleKeyDown
  - Files affected: `src/renderer/lib/stores/shortcuts.svelte.ts`, `src/renderer/lib/stores/shortcuts.test.ts`

- [ ] **Step 3: Wire handleKeyDown in App.svelte**
  - **Tests first**:
    - `app-wires-keydown`: handleKeyDown connected to svelte:window
  - Update App.svelte:

  ```svelte
  <svelte:window
    onkeydown={shortcuts.handleKeyDown}
    onkeyup={shortcuts.handleKeyUp}
    onblur={shortcuts.handleWindowBlur}
  />
  ```

  - Files affected: `src/renderer/App.svelte`, `src/renderer/App.test.ts`

- [ ] **Step 4: Sidebar Index Numbers**
  - **Tests first**:
    - `sidebar-indices-visible`: Index numbers shown when shortcutModeActive
    - `sidebar-indices-hidden`: Index numbers hidden when not active
    - `sidebar-indices-correct`: Indices 1-9, 0 for 10th
    - `sidebar-indices-global`: Numbering is global across projects
    - `sidebar-indices-limit`: Only first 10 workspaces have numbers
    - `sidebar-indices-aria`: Index has aria-label
  - Add `shortcutModeActive` prop to Sidebar:

  ```svelte
  <script lang="ts">
    interface Props {
      // ... existing props
      shortcutModeActive?: boolean;
    }

    let { shortcutModeActive = false, ...rest }: Props = $props();

    // Compute global index for each workspace
    function getWorkspaceIndex(projectIndex: number, workspaceIndex: number): number | null {
      let globalIndex = 0;
      for (let p = 0; p < projectIndex; p++) {
        globalIndex += projects[p].workspaces.length;
      }
      globalIndex += workspaceIndex;
      return globalIndex < 10 ? globalIndex : null;
    }

    function formatIndex(index: number): string {
      return index === 9 ? "0" : String(index + 1);
    }
  </script>

  <!-- In workspace list item -->
  {#if shortcutModeActive}
    {@const index = getWorkspaceIndex(pIndex, wIndex)}
    {#if index !== null}
      <span class="shortcut-index" aria-label="Press {formatIndex(index)} to jump">
        {formatIndex(index)}
      </span>
    {/if}
  {/if}
  ```

  - Files affected: `src/renderer/lib/components/Sidebar.svelte`, `src/renderer/lib/components/Sidebar.test.ts`

- [ ] **Step 5: Pass shortcutModeActive to Sidebar**
  - Update App.svelte to pass prop:

  ```svelte
  <Sidebar
    {projects}
    {activeProjectPath}
    {activeWorkspacePath}
    shortcutModeActive={shortcuts.active}
    ...
  />
  ```

  - Files affected: `src/renderer/App.svelte`

- [ ] **Step 6: Integration Tests**
  - **Tests**:
    - `integration-full-flow`: Alt+X → action → Alt release works
    - `integration-multi-action`: Alt+X → Alt+1 → Alt+2 works
    - `integration-dialog-from-shortcut`: Alt+X → Enter opens dialog
    - `integration-navigate-wrap`: Alt+X → navigate past end wraps
  - Files affected: `src/renderer/lib/integration.test.ts`

## Testing Strategy

### Unit Tests

| Test Case                     | Description               | File                                          |
| ----------------------------- | ------------------------- | --------------------------------------------- |
| get-all-workspaces-flat       | Returns flat array        | `src/renderer/lib/stores/projects.test.ts`    |
| get-all-workspaces-order      | Correct order             | `src/renderer/lib/stores/projects.test.ts`    |
| get-workspace-by-index        | Returns correct workspace | `src/renderer/lib/stores/projects.test.ts`    |
| get-workspace-by-index-bounds | Handles out of range      | `src/renderer/lib/stores/projects.test.ts`    |
| action-navigate-up            | ArrowUp navigates         | `src/renderer/lib/stores/shortcuts.test.ts`   |
| action-navigate-down          | ArrowDown navigates       | `src/renderer/lib/stores/shortcuts.test.ts`   |
| action-navigate-wrap-top      | Wraps at top              | `src/renderer/lib/stores/shortcuts.test.ts`   |
| action-navigate-wrap-bottom   | Wraps at bottom           | `src/renderer/lib/stores/shortcuts.test.ts`   |
| action-navigate-no-workspaces | No-op when empty          | `src/renderer/lib/stores/shortcuts.test.ts`   |
| action-jump-1-to-9            | Jump by number            | `src/renderer/lib/stores/shortcuts.test.ts`   |
| action-jump-0                 | 0 jumps to 10th           | `src/renderer/lib/stores/shortcuts.test.ts`   |
| action-jump-out-of-range      | No-op for invalid         | `src/renderer/lib/stores/shortcuts.test.ts`   |
| action-enter-opens-create     | Enter opens dialog        | `src/renderer/lib/stores/shortcuts.test.ts`   |
| action-delete-opens-remove    | Delete opens dialog       | `src/renderer/lib/stores/shortcuts.test.ts`   |
| action-dialog-exits-first     | Exits mode before dialog  | `src/renderer/lib/stores/shortcuts.test.ts`   |
| sidebar-indices-visible       | Shown when active         | `src/renderer/lib/components/Sidebar.test.ts` |
| sidebar-indices-hidden        | Hidden when inactive      | `src/renderer/lib/components/Sidebar.test.ts` |
| sidebar-indices-correct       | 1-9, 0 numbering          | `src/renderer/lib/components/Sidebar.test.ts` |
| sidebar-indices-global        | Global across projects    | `src/renderer/lib/components/Sidebar.test.ts` |
| sidebar-indices-limit         | Only first 10             | `src/renderer/lib/components/Sidebar.test.ts` |

### Integration Tests

| Test Case                        | Description                  | File                                   |
| -------------------------------- | ---------------------------- | -------------------------------------- |
| integration-full-flow            | Complete shortcut flow       | `src/renderer/lib/integration.test.ts` |
| integration-multi-action         | Multiple actions in sequence | `src/renderer/lib/integration.test.ts` |
| integration-dialog-from-shortcut | Shortcut opens dialog        | `src/renderer/lib/integration.test.ts` |
| integration-navigate-wrap        | Navigation wraps around      | `src/renderer/lib/integration.test.ts` |

### Manual Testing Checklist

- [ ] Alt+X then Alt+1 → switches to first workspace, overlay stays
- [ ] Alt+X then Alt+2 → switches to second workspace
- [ ] Alt+X then Alt+0 → switches to 10th workspace (if exists)
- [ ] Alt+X then Alt+5 with only 3 workspaces → nothing happens
- [ ] Alt+X then Alt+↓ → navigates to next workspace
- [ ] Alt+X then Alt+↑ → navigates to previous workspace
- [ ] Alt+X then Alt+↓ on last workspace → wraps to first
- [ ] Alt+X then Alt+↑ on first workspace → wraps to last
- [ ] Alt+X then Alt+1 then Alt+2 → switches twice while holding Alt
- [ ] Alt+X then Alt+Enter → create dialog opens, overlay hidden
- [ ] Alt+X then Alt+Delete → remove dialog opens, overlay hidden
- [ ] Alt+X then Alt+Backspace → remove dialog opens, overlay hidden
- [ ] Verify sidebar shows 1-9, 0 numbers during shortcut mode
- [ ] Verify sidebar numbers are global across projects
- [ ] With >10 workspaces → first 10 have numbers, rest don't

## Dependencies

| Package | Purpose             | Approved |
| ------- | ------------------- | -------- |
| (none)  | No new dependencies | N/A      |

## Documentation Updates

No additional documentation updates needed - covered in KEYBOARD_ACTIVATION.

## Definition of Done

- [ ] All implementation steps complete
- [ ] All tests pass
- [ ] `pnpm validate:fix` passes
- [ ] Manual testing checklist completed
- [ ] All shortcut actions work correctly
- [ ] Sidebar shows index numbers during shortcut mode
