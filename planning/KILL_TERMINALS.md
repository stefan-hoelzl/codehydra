---
status: COMPLETED
last_updated: 2025-12-23
reviewers:
  - review-ui
  - review-typescript
  - review-arch
  - review-testing
  - review-docs
---

# KILL_TERMINALS

## Overview

- **Problem**: When a VS Code view is closed during workspace deletion, terminal processes may continue running, leaving orphaned processes and potential resource leaks.
- **Solution**: Before destroying the view, send `workbench.action.terminal.killAll` command via PluginServer to terminate all terminal processes in the workspace.
- **Risks**:
  - Extension may not be connected when deletion starts → Mitigated by graceful skip (mark step as done, log at debug level)
  - Command may timeout → Mitigated by 5s timeout, then proceed with deletion anyway (mark as done, log warning)
- **Alternatives Considered**:
  - Kill terminals in ViewManager.destroyWorkspaceView() → Rejected: Would require injecting PluginServer into ViewManager, changing IViewManager interface
  - Add callback/hook pattern to ViewManager → Rejected: Over-engineering for a single use case
  - Handle at AppState level → Rejected: AppState.removeWorkspace() is called after view destruction
  - Inject PluginServer directly into CodeHydraApiImpl → Rejected: Adds 9th constructor parameter, increases coupling. Use callback pattern instead.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Workspace Deletion Flow                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  remove() ──► switchToNextWorkspace() ──► executeDeletion()        │
│                     │                           │                   │
│                     │                           ▼                   │
│                     │               ┌───────────────────────┐       │
│                     │               │ Op 1: kill-terminals  │       │
│                     │               │ "Terminating processes"│       │
│                     │               │ (index 0)             │       │
│                     ▼               │                       │       │
│              View detached          │ killTerminalsCallback │       │
│              (still exists)         │   (workspacePath)     │       │
│                     │               │                       │       │
│                     │               │ (skipped if callback  │       │
│                     │               │  not provided or      │       │
│                     │               │  workspace not        │       │
│                     │               │  connected)           │       │
│                     │               └───────────┬───────────┘       │
│                     │                           │                   │
│                     │                           ▼                   │
│                     │               ┌───────────────────────┐       │
│                     │               │ Op 2: cleanup-vscode  │       │
│                     │               │ "Closing VS Code view"│       │
│                     │               │ (index 1)             │       │
│                     │               │                       │       │
│                     │               │ viewManager           │       │
│                     │               │   .destroyWorkspaceView()     │
│                     │               └───────────┬───────────┘       │
│                     │                           │                   │
│                     │                           ▼                   │
│                     │               ┌───────────────────────┐       │
│                     │               │ Op 3: cleanup-workspace│      │
│                     │               │ "Removing workspace"  │       │
│                     │               │ (index 2)             │       │
│                     │               │                       │       │
│                     │               │ provider              │       │
│                     │               │   .removeWorkspace()  │       │
│                     │               └───────────────────────┘       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

Note: kill-terminals MUST run before cleanup-vscode because terminal
processes must be killed while the view still exists (extension is
still connected). After view destruction, the extension disconnects
and commands cannot be sent.
```

## UI Design

No UI changes required. The existing `DeletionProgressView` component renders operations dynamically from the `operations` array. Adding a new operation will automatically display it.

```
┌──────────────────────────────────────┐
│         Removing workspace           │
│           "feature-branch"           │
│                                      │
│  ● Terminating processes             │  ← NEW (in-progress)
│  ○ Closing VS Code view              │  ← pending
│  ○ Removing workspace                │  ← pending
│                                      │
└──────────────────────────────────────┘
```

### User Interactions

- No new user interactions - deletion flow remains the same
- Progress view shows the new step automatically

## Implementation Steps

- [x] **Step 1: Update DeletionOperationId type**
  - Add `"kill-terminals"` to the union type (first in the union for consistency with array order)
  - File: `src/shared/api/types.ts`
  - Test: Type system validates - no runtime test needed

- [x] **Step 2: Create shutdown-commands.ts**
  - Create new file following `startup-commands.ts` pattern
  - Define constant: `SHUTDOWN_COMMAND = "workbench.action.terminal.killAll" as const`
  - Define timeout constant: `SHUTDOWN_COMMAND_TIMEOUT_MS = 5000`
  - Create `sendShutdownCommand(server: PluginServer, workspacePath: string, logger: Logger): Promise<void>` function
    - Check `server.isConnected(workspacePath)` first - if not connected, log debug and return early
    - Call `server.sendCommand(workspacePath, SHUTDOWN_COMMAND, [], SHUTDOWN_COMMAND_TIMEOUT_MS)`
    - On success: log debug "Shutdown command executed"
    - On failure (timeout or error): log warning with error details, do NOT throw
  - Add JSDoc documentation for the function
  - Files:
    - `src/services/plugin-server/shutdown-commands.ts` (new)
    - `src/services/plugin-server/shutdown-commands.test.ts` (new)
  - Test criteria: See Testing Strategy section for detailed test cases

- [x] **Step 3: Export from plugin-server index**
  - Export `SHUTDOWN_COMMAND`, `sendShutdownCommand` from index.ts
  - File: `src/services/plugin-server/index.ts`
  - Test: Import works (verified by usage in step 4)

- [x] **Step 4: Add killTerminalsCallback to CodeHydraApiImpl**
  - Add optional callback parameter to constructor: `killTerminalsCallback?: (workspacePath: string) => Promise<void>`
  - Store as private readonly field (follows existing `emitDeletionProgress` pattern)
  - This avoids coupling CodeHydraApiImpl to PluginServer directly
  - File: `src/main/api/codehydra-api.ts`
  - Test:
    - Existing tests pass with undefined callback
    - New test verifies callback is invoked during deletion

- [x] **Step 5: Implement kill-terminals operation in executeDeletion**
  - Update `updateOp` helper to accept `DeletionOperationId` type instead of hardcoded union
  - Insert "kill-terminals" as first element (index 0) in operations array with label "Terminating processes"
  - Before "cleanup-vscode" operation, execute kill-terminals step:

    ```typescript
    // Operation 1: Kill terminals (best-effort)
    updateOp("kill-terminals", "in-progress");
    emitProgress(false, false);

    if (this.killTerminalsCallback) {
      try {
        await this.killTerminalsCallback(workspacePath);
        updateOp("kill-terminals", "done");
      } catch (error) {
        // Best-effort: log and continue, mark as done (not error)
        this.logger.warn("Kill terminals failed", { workspacePath, error });
        updateOp("kill-terminals", "done");
      }
    } else {
      // No callback provided, skip gracefully
      updateOp("kill-terminals", "done");
    }
    emitProgress(false, false);
    ```

  - Note: The callback itself handles the "not connected" case internally (logs debug, returns early)
  - File: `src/main/api/codehydra-api.ts`
  - Test: See Testing Strategy section for detailed test cases

- [x] **Step 6: Update CodeHydraApiImpl instantiation**
  - In `startServices()`, create the callback that uses PluginServer:
    ```typescript
    const killTerminalsCallback = pluginServer
      ? async (workspacePath: string) => {
          await sendShutdownCommand(pluginServer, workspacePath, pluginLogger);
        }
      : undefined;
    ```
  - Pass `killTerminalsCallback` to `CodeHydraApiImpl` constructor
  - File: `src/main/index.ts`
  - Test: Integration verified by app running

- [x] **Step 7: Update existing tests**
  - Update test fixtures that create DeletionProgress objects to include 3 operations
  - Update operation count assertions from 2 to 3
  - Add "kill-terminals" as first operation in all fixture arrays
  - Files and specific changes:
    - `src/main/api/codehydra-api.test.ts`: Update mock operations, add tests for kill-terminals behavior
    - `src/renderer/lib/stores/deletion.svelte.test.ts`: Update createDeletionProgress helper
    - `src/renderer/lib/components/DeletionProgressView.test.ts`: Update defaultProgress, add test for 3-operation rendering
    - `src/renderer/lib/components/MainView.test.ts`: Update createDeletionProgress helper
    - `src/renderer/lib/components/Sidebar.test.ts`: Update createDeletionProgress helper
  - Test criteria: All tests pass with updated operation arrays

- [x] **Step 8: Add boundary test**
  - Create boundary test for real PluginServer integration
  - Test real command sending over WebSocket
  - File: `src/services/plugin-server/shutdown-commands.boundary.test.ts` (new)
  - Test criteria: Verify command is sent and acknowledged via real Socket.IO connection

- [x] **Step 9: Update documentation**
  - Update `docs/ARCHITECTURE.md` to document the new deletion sequence
  - Add to "Workspace Cleanup" section explaining the 3-step process
  - Update `AGENTS.md` Plugin Interface section to mention shutdown commands alongside startup commands
  - Files:
    - `docs/ARCHITECTURE.md`
    - `AGENTS.md`

## Testing Strategy

### Unit Tests (vitest)

| Test Case                                       | Description                                                                                          | File                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------- |
| sendShutdownCommand-success                     | Calls PluginServer.sendCommand with SHUTDOWN_COMMAND and 5000ms timeout, returns without throwing    | shutdown-commands.test.ts    |
| sendShutdownCommand-timeout                     | When sendCommand times out, logs warning with `[plugin]` logger and returns without throwing         | shutdown-commands.test.ts    |
| sendShutdownCommand-not-connected               | When server.isConnected returns false, logs debug and returns without calling sendCommand            | shutdown-commands.test.ts    |
| sendShutdownCommand-command-error               | When sendCommand returns `{success: false, error: "..."}`, logs warning and returns without throwing | shutdown-commands.test.ts    |
| sendShutdownCommand-logs-debug-on-success       | Verifies debug log "Shutdown command executed" on success                                            | shutdown-commands.test.ts    |
| sendShutdownCommand-logs-warning-on-failure     | Verifies warning log includes workspace path and error details                                       | shutdown-commands.test.ts    |
| SHUTDOWN_COMMAND-constant                       | Verifies constant equals "workbench.action.terminal.killAll"                                         | shutdown-commands.test.ts    |
| SHUTDOWN_COMMAND_TIMEOUT_MS-constant            | Verifies timeout constant equals 5000                                                                | shutdown-commands.test.ts    |
| executeDeletion-kill-terminals-transitions      | Emits progress events: pending → in-progress → done for kill-terminals operation                     | codehydra-api.test.ts        |
| executeDeletion-kill-terminals-first            | Verifies kill-terminals is at index 0, runs before cleanup-vscode                                    | codehydra-api.test.ts        |
| executeDeletion-kill-terminals-skip-no-callback | When killTerminalsCallback is undefined, operation immediately transitions to done                   | codehydra-api.test.ts        |
| executeDeletion-kill-terminals-callback-error   | When callback throws, logs warning, marks operation as done (not error), continues                   | codehydra-api.test.ts        |
| executeDeletion-kill-terminals-callback-invoked | Verifies callback is called with correct workspacePath                                               | codehydra-api.test.ts        |
| updateOp-accepts-DeletionOperationId            | Verifies updateOp helper accepts all DeletionOperationId values                                      | codehydra-api.test.ts        |
| DeletionProgressView-renders-three-operations   | Renders all three operations in correct order with correct labels                                    | DeletionProgressView.test.ts |

### Boundary Tests

| Test Case                        | Description                                                      | File                               |
| -------------------------------- | ---------------------------------------------------------------- | ---------------------------------- |
| sendShutdownCommand-real-socket  | Sends command via real Socket.IO server, verifies acknowledgment | shutdown-commands.boundary.test.ts |
| sendShutdownCommand-real-timeout | Verifies timeout behavior with delayed mock client               | shutdown-commands.boundary.test.ts |

### Integration Tests

| Test Case                              | Description                                                                                                                                             | File                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| deletion-full-flow-with-kill-terminals | Full deletion flow: Mock killTerminalsCallback, real AppState/progress tracking, verify 3 operations in sequence, all progress events emitted correctly | codehydra-api.integration.test.ts |
| deletion-concurrent-attempt            | Start deletion (kill-terminals running), try delete again, verify idempotent behavior                                                                   | codehydra-api.integration.test.ts |

### Manual Testing Checklist

- [ ] Delete workspace with active terminals - verify terminals are killed
- [ ] Delete workspace with no terminals - verify no errors
- [ ] Delete workspace when extension not connected - verify graceful skip (check logs for debug message)
- [ ] Verify progress view shows all three steps in order
- [ ] Verify deletion completes successfully within reasonable time (<10s including 5s timeout)
- [ ] Check application logs for appropriate `[plugin]` logger entries
- [ ] Delete workspace immediately after opening (terminals might not be fully initialized)
- [ ] Delete workspace with long-running terminal process - verify cleanup doesn't hang
- [ ] Test on Linux (primary platform)
- [ ] Test on Windows if available (terminal behavior may differ)

## Dependencies

No new dependencies required. Uses existing:

- `PluginServer` for command sending
- `workbench.action.terminal.killAll` VS Code built-in command

## Documentation Updates

### Files to Update

| File                   | Changes Required                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `docs/ARCHITECTURE.md` | Add to "Workspace Cleanup" section: document 3-step deletion sequence (kill terminals → destroy view → remove worktree) |
| `AGENTS.md`            | Add `sendShutdownCommand` to Plugin Interface section alongside startup commands                                        |

### New Documentation Required

None required beyond the updates above.

## Definition of Done

- [x] All implementation steps complete
- [x] `npm run validate:fix` passes
- [x] Documentation updated
- [ ] User acceptance testing passed
- [ ] Changes committed
