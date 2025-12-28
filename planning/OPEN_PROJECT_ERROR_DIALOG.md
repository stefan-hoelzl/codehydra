---
status: COMPLETED
last_updated: 2025-12-28
reviewers: [review-ui, review-typescript, review-arch, review-testing, review-docs]
---

# OPEN_PROJECT_ERROR_DIALOG

## Overview

- **Problem**: When a user selects a folder that is not a valid git repository root (e.g., a subdirectory), the error is logged to console but the user sees nothing - no feedback about what went wrong.
- **Solution**: Add error handling to the folder picker flow that shows an error dialog when `api.projects.open()` fails, allowing the user to retry with a different folder or cancel.
- **Risks**: None significant - this is a simple UI enhancement with no backend changes.
- **Alternatives Considered**:
  - Custom "Open Project" dialog with path input and validation: More complex, overkill for this use case
  - Toast/notification: Less discoverable, doesn't allow easy retry

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        MainView.svelte                       │
│                                                              │
│  handleOpenProject() ◄─────────────────────────────────────┐ │
│       │                                                    │ │
│       ▼                                                    │ │
│  api.ui.selectFolder()                                     │ │
│       │                                                    │ │
│       ├── null (user cancelled) ──► return (no-op)        │ │
│       │                                                    │ │
│       ▼                                                    │ │
│  api.projects.open(path)                                   │ │
│       │                                                    │ │
│   ┌───┴───┐                                               │ │
│   ▼       ▼                                               │ │
│ success  error ────► openProjectError = message           │ │
│   │                        │                              │ │
│   ▼                        ▼                              │ │
│ done           OpenProjectErrorDialog shown               │ │
│                        │                                  │ │
│                    ┌───┴───┐                              │ │
│                    ▼       ▼                              │ │
│              "Select    "Cancel"                          │ │
│              Different   │                                │ │
│              Folder"     ▼                                │ │
│                 │    close dialog                         │ │
│                 │    (done)                               │ │
│                 │                                         │ │
│                 ▼                                         │ │
│           api.ui.selectFolder()                           │ │
│                 │                                         │ │
│                 ├── null ──► keep dialog open             │ │
│                 │            (user can retry or cancel)   │ │
│                 │                                         │ │
│                 └── path ──► api.projects.open(path) ─────┘ │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    shortcuts.svelte.ts                       │
│                                                              │
│  handleProjectOpen()                                         │
│       │                                                      │
│       ▼                                                      │
│  exitShortcutMode()                                          │
│       │                                                      │
│       ▼                                                      │
│  window.dispatchEvent(new CustomEvent('codehydra:open-project'))
│       │                                                      │
│       └──────► MainView listens ──► handleOpenProject()      │
│                                                              │
│  Note: Event dispatch decouples shortcuts store from         │
│  MainView component, avoiding circular imports.              │
└─────────────────────────────────────────────────────────────┘
```

## UI Design

```
┌─────────────────────────────────────────────────────────────┐
│  Could Not Open Project                                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Path is not a git repository root:                  │    │
│  │ /path/to/folder. Please select the                  │    │
│  │ root directory of your git repository.              │    │
│  └─────────────────────────────────────────────────────┘    │
│   (role="alert" for screen reader announcements)            │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│   [Cancel]  [Select Different Folder]                       │
└─────────────────────────────────────────────────────────────┘
         ↑              ↑
      secondary      primary (default focus)
      (Esc key)      (Enter key)

Button order in markup (flex-direction: row-reverse):
1. <vscode-button onclick={onRetry}>Select Different Folder</vscode-button>
2. <vscode-button secondary onclick={onClose}>Cancel</vscode-button>
```

### User Interactions

- **Select Different Folder button**: Opens folder picker; on success closes dialog and opens project; on cancel keeps dialog open
- **Cancel button**: Closes dialog, returns to normal state
- **Escape key**: Same as Cancel button (handled by base Dialog component)
- **Enter key**: Same as Select Different Folder (default focus via `initialFocusSelector="vscode-button"`)
- **Click outside dialog**: Same as Cancel (handled by base Dialog component's `handleOverlayClick`)

## Implementation Steps

- [x] **Step 1: Create OpenProjectErrorDialog.svelte**
  - Create new file `src/renderer/lib/components/OpenProjectErrorDialog.svelte`
  - Use `Dialog.svelte` as base component (see `src/renderer/lib/components/Dialog.svelte`)
  - Follow the pattern in `RemoveWorkspaceDialog.svelte` for props structure
  - Define props interface using Svelte 5 runes:
    ```typescript
    interface OpenProjectErrorDialogProps {
      open: boolean;
      errorMessage: string;
      onRetry: () => void;
      onClose: () => void;
    }
    let { open, errorMessage, onRetry, onClose }: OpenProjectErrorDialogProps = $props();
    ```
  - Title: "Could Not Open Project"
  - Content: Error message in styled div with `role="alert"` for screen reader announcements
  - Use `--ch-danger` CSS variable for error styling (consistent with existing semantic colors)
  - Actions: Use `<vscode-button>` components (required by VSCode Elements patterns)
    - Primary button first in markup: "Select Different Folder" (onclick={onRetry})
    - Secondary button second: "Cancel" (onclick={onClose}, secondary attribute)
  - Pass `initialFocusSelector="vscode-button"` to Dialog to focus retry button on open
  - Files affected: `src/renderer/lib/components/OpenProjectErrorDialog.svelte` (new)
  - Test criteria: Dialog renders with correct title, message, buttons, and focus

- [x] **Step 2: Add error state to MainView.svelte**
  - Add state variable: `let openProjectError = $state<string | null>(null);`
  - Note: Simple string state is intentionally chosen over discriminated union since only one piece of state is tracked
  - Add retry handler that handles folder picker cancellation:
    ```typescript
    async function handleOpenProjectRetry(): Promise<void> {
      const path = await api.ui.selectFolder();
      if (!path) {
        // User cancelled folder picker - keep dialog open with original error
        return;
      }
      // Clear error and try opening the new path
      openProjectError = null;
      try {
        await api.projects.open(path);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to open project";
        logger.warn("Failed to open project", { path, error: message });
        openProjectError = message;
      }
    }
    ```
  - Add close handler: `function handleOpenProjectErrorClose(): void { openProjectError = null; }`
  - Files affected: `src/renderer/lib/components/MainView.svelte`
  - Test criteria: State changes correctly on error set/clear, retry handles cancellation

- [x] **Step 3: Add error handling to handleOpenProject()**
  - CURRENT: `handleOpenProject()` calls `api.ui.selectFolder()` then `api.projects.open(path)` without error handling
  - CHANGE: Wrap `api.projects.open(path)` in try/catch with type-safe error extraction:

    ```typescript
    async function handleOpenProject(): Promise<void> {
      const path = await api.ui.selectFolder();
      if (!path) return;

      try {
        await api.projects.open(path);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to open project";
        logger.warn("Failed to open project", { path, error: message });
        openProjectError = message;
      }
    }
    ```

  - Files affected: `src/renderer/lib/components/MainView.svelte`
  - Test criteria: Errors are caught, logged, and state is set

- [x] **Step 4: Render OpenProjectErrorDialog in MainView**
  - Import `OpenProjectErrorDialog` component
  - Add to template after other dialogs (after CloseProjectDialog):
    ```svelte
    <OpenProjectErrorDialog
      open={openProjectError !== null}
      errorMessage={openProjectError ?? ""}
      onRetry={handleOpenProjectRetry}
      onClose={handleOpenProjectErrorClose}
    />
    ```
  - Files affected: `src/renderer/lib/components/MainView.svelte`
  - Test criteria: Dialog shows when error is set, hides when cleared

- [x] **Step 5: Modify shortcuts.svelte.ts to dispatch event**
  - CURRENT: `handleProjectOpen()` calls `api.ui.selectFolder()` and `api.projects.open()` directly
  - CHANGE: Dispatch event for MainView to handle (enables error dialog display):
    ```typescript
    function handleProjectOpen(): void {
      exitShortcutMode();
      window.dispatchEvent(new CustomEvent("codehydra:open-project"));
    }
    ```
  - Note: Event dispatch decouples shortcuts store from MainView component, avoiding circular imports
  - Files affected: `src/renderer/lib/stores/shortcuts.svelte.ts`
  - Test criteria: Event is dispatched when O key is pressed in shortcut mode

- [x] **Step 6: Add event listener in MainView.svelte**
  - In `onMount`, add listener using wrapper function for proper cleanup:

    ```typescript
    const handleOpenProjectEvent = (): void => {
      void handleOpenProject();
    };
    window.addEventListener("codehydra:open-project", handleOpenProjectEvent);

    return () => {
      cleanup();
      unsubscribeDeletionProgress();
      window.removeEventListener("codehydra:open-project", handleOpenProjectEvent);
    };
    ```

  - Note: Wrapper function ensures same reference for add/remove; `void` handles async return
  - Files affected: `src/renderer/lib/components/MainView.svelte`
  - Test criteria: MainView responds to event by opening folder picker

- [x] **Step 7: Update USER_INTERFACE.md documentation**
  - Update "Opening a Project" section (around lines 236-249) to document the error dialog
  - Add error dialog mockup following established pattern (see lines 465-519 for RemoveWorkspaceDialog example)
  - Document: dialog title, error message format, button labels, retry flow behavior
  - Note: After retry, shortcut mode remains exited (user can re-activate with Alt+X)
  - Files affected: `docs/USER_INTERFACE.md`
  - Test criteria: Documentation matches implementation

## Testing Strategy

### Integration Tests

Test behavior through user interactions with behavioral mocks.

| #   | Test Case                                    | Entry Point                                        | Boundary Mocks                                                                              | Behavior Verified                                    |
| --- | -------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | Shows error dialog when project open fails   | Render MainView, simulate folder selection         | `api.ui.selectFolder` returns path, `api.projects.open` rejects with "Not a git repository" | Dialog visible with error message text               |
| 2   | Retry opens folder picker and succeeds       | Render OpenProjectErrorDialog, click retry button  | `api.ui.selectFolder` returns new path, `api.projects.open` resolves                        | Dialog closes, project opened                        |
| 3   | Retry with picker cancel keeps dialog open   | Render OpenProjectErrorDialog, click retry button  | `api.ui.selectFolder` returns null                                                          | Dialog remains open with original error              |
| 4   | Cancel button closes dialog                  | Render OpenProjectErrorDialog, click cancel button | None                                                                                        | Dialog closes, error state cleared                   |
| 5   | Valid folder opens without error dialog      | Render MainView, simulate folder selection         | `api.ui.selectFolder` returns path, `api.projects.open` resolves                            | No error dialog shown, project opened                |
| 6   | Complete retry flow: error → retry → success | Render MainView, full flow                         | First open rejects, second succeeds                                                         | Error dialog → retry → dialog closes                 |
| 7   | Multiple retry attempts work                 | Render OpenProjectErrorDialog, click retry twice   | First retry fails, second succeeds                                                          | Each retry opens picker, final success closes dialog |

### UI Integration Tests

| #   | Test Case                           | Category | Component              | Behavior Verified                                                   |
| --- | ----------------------------------- | -------- | ---------------------- | ------------------------------------------------------------------- |
| 1   | Dialog renders complete structure   | Pure-UI  | OpenProjectErrorDialog | Title "Could Not Open Project", error message, both buttons present |
| 2   | Retry button receives default focus | Pure-UI  | OpenProjectErrorDialog | `initialFocusSelector` focuses vscode-button on open                |
| 3   | Error message has correct ARIA      | Pure-UI  | OpenProjectErrorDialog | `role="alert"` present on error container                           |
| 4   | Error uses danger color styling     | Pure-UI  | OpenProjectErrorDialog | Background uses `--ch-danger` variable                              |

### Manual Testing Checklist

- [ ] Click "Open Project" button, select subdirectory of git repo → error dialog shows with helpful message
- [ ] Use shortcut mode (Alt+X, O), select invalid folder → error dialog shows (same behavior)
- [ ] Click "Select Different Folder" → folder picker opens
- [ ] In folder picker, select valid git repo root → project opens, dialog closes
- [ ] In folder picker, click cancel → error dialog remains open with original error
- [ ] Click "Select Different Folder" multiple times → each opens folder picker correctly
- [ ] Click "Cancel" → dialog closes, back to normal state
- [ ] Press Escape → dialog closes
- [ ] Press Enter with retry button focused → folder picker opens
- [ ] Tab navigation works through all interactive elements
- [ ] Screen reader announces error message when dialog opens (role="alert")
- [ ] Error message is readable and explains the issue clearly

## Dependencies

No new dependencies required.

## Documentation Updates

### Files to Update

| File                     | Changes Required                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `docs/USER_INTERFACE.md` | Update "Opening a Project" section with error dialog UI, mockup, and retry flow documentation |

### New Documentation Required

None required.

## Definition of Done

- [ ] All implementation steps complete
- [ ] `npm run validate:fix` passes
- [ ] Documentation updated
- [ ] User acceptance testing passed
- [ ] Changes committed
