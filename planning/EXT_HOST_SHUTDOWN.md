---
status: COMPLETED
last_updated: 2024-12-27
reviewers: [review-typescript, review-arch, review-testing, review-docs]
---

# EXT_HOST_SHUTDOWN

## Overview

- **Problem**: On Windows, when a workspace is deleted, the extension host process holds file handles to the workspace directory, preventing deletion. The git worktree removal fails with "file in use" errors.
- **Solution**: Add a `shutdown` event that the sidekick extension handles by:
  1. Gracefully removing workspace folders via VS Code API
  2. Terminating the extension host process via `process.exit(0)`

  CodeHydra waits for socket disconnect as confirmation that the extension host is dead before proceeding with deletion.

- **Risks**:
  - Extension host termination is abrupt, but acceptable since workspace is being deleted anyway
  - If socket doesn't disconnect within timeout (5s), log warning and proceed with deletion anyway (best-effort). This is acceptable because: (1) The extension host is likely hung/unresponsive, (2) Deletion will attempt to proceed (may fail with file locks on Windows), (3) User can retry deletion
- **Alternatives Considered**:
  - **Only `updateWorkspaceFolders`**: Risk - File watcher handles remain open, blocking deletion
  - **Only `process.exit()`**: Risk - Unclean shutdown, potential data loss (though acceptable for deletion case)
  - **Query terminal PIDs + custom kill**: More complex; not needed if we keep existing terminal kill step
- **Platform Behavior**: The shutdown step runs on all platforms (not Windows-only). Graceful cleanup is never harmful, and the overhead is minimal (~100ms). This avoids platform-specific code paths.

## Architecture

### Process Tree Context

Each workspace has its own extension host, but terminals are shared:

```
code-server (single instance)
  └─ VS Code Server
       ├─ ptyHost (SHARED)              ← Terminals live here
       │   ├─ bash → workspace A
       │   ├─ bash → workspace B
       │   └─ ...
       │
       ├─ extensionHost (workspace A)   ← FILE HANDLES HERE
       │   └─ fileWatcher               ← Also holds handles
       ├─ extensionHost (workspace B)
       └─ ...
```

**Key insight**: Killing extension host A only affects workspace A - other workspaces continue working.

### Safe Shutdown Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Workspace Deletion Flow                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  CodeHydra Main Process              │  code-server                          │
│  ────────────────────────            │  ───────────────────────────          │
│                                      │                                       │
│  Step 1: Kill terminals (existing)   │                                       │
│  └─► emit("command", killAll) ──────►│  Execute terminal.killAll             │
│  └─► Wait for ack ◄─────────────────┤  (kills workspace terminals)           │
│                                      │                                       │
│  Step 2: Shutdown extension host     │                                       │
│  └─► Set up disconnect listener      │                                       │
│  └─► emit("shutdown") ──────────────►│  a) try: updateWorkspaceFolders(0,len)│
│                                      │     catch: log error, continue        │
│      ◄─── ack ──────────────────────┤  b) ack({ success: true })             │
│                                      │  c) setImmediate → process.exit(0)    │
│  └─► Wait for disconnect OR timeout  │     └─► Kills extension host          │
│      ◄─── disconnect event ─────────┤     └─► Socket connection drops        │
│  └─► Clean up listener               │                                       │
│                                      │                                       │
│  Step 3: Cleanup                     │  (extension host dead)                │
│  └─► destroyWorkspaceView()          │                                       │
│  └─► git worktree remove ───────────►│  ✓ No file handles blocking           │
│                                      │                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Why Both Steps?

| Step                    | Kills                            | Why Needed                                                         |
| ----------------------- | -------------------------------- | ------------------------------------------------------------------ |
| Kill terminals          | Terminal processes under ptyHost | ptyHost is shared; extension host death may not clean up terminals |
| Shutdown extension host | Extension host + file watcher    | These hold the file handles blocking Windows deletion              |

## Implementation Steps

- [x] **Step 1: Add `shutdown` event to plugin protocol**
  - Add `shutdown` event type to `ServerToClientEvents` interface:
    ```typescript
    shutdown: (ack: (result: PluginResult<void>) => void) => void;
    ```
  - Add constant `SHUTDOWN_DISCONNECT_TIMEOUT_MS = 5000`
  - Files affected: `src/shared/plugin-protocol.ts`
  - Test criteria: TypeScript compiles, add unit test for event signature in `plugin-protocol.test.ts`

- [x] **Step 2: Handle `shutdown` event in sidekick extension**
  - Add `socket.on("shutdown", ...)` handler after existing `command` handler
  - Implementation with error handling:

    ```javascript
    socket.on("shutdown", (ack) => {
      log("Shutdown command received, workspace: " + currentWorkspacePath);

      // Graceful: try to remove workspace folders (releases file watchers)
      try {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
          vscode.workspace.updateWorkspaceFolders(0, folders.length);
          log("Removed " + folders.length + " workspace folder(s)");
        }
      } catch (err) {
        logError("Graceful shutdown failed: " + (err instanceof Error ? err.message : String(err)));
        // Continue anyway - we're exiting
      }

      // Send ack before exit
      ack({ success: true, data: undefined });

      // Use setImmediate to allow ack to flush before exit
      log("Exiting extension host");
      setImmediate(() => process.exit(0));
    });
    ```

  - Files affected: `src/services/vscode-setup/assets/codehydra-sidekick/extension.js`
  - Test criteria: Manual test with specific verification (see Manual Testing Checklist)

- [x] **Step 3: Add `sendExtensionHostShutdown` method to PluginServer**
  - Implement as method on PluginServer class (keeps socket access internal)
  - Method signature:
    ```typescript
    /**
     * Send shutdown command and wait for extension host to disconnect.
     *
     * This is a best-effort operation for workspace deletion cleanup.
     * Waits for socket disconnect (not just ack) as confirmation that
     * the extension host process has terminated.
     *
     * @param workspacePath - Normalized workspace path
     * @param options - Optional configuration
     * @returns Promise that resolves when disconnected or timeout
     */
    async sendExtensionHostShutdown(
      workspacePath: string,
      options?: { timeoutMs?: number }
    ): Promise<void>
    ```
  - Implementation details:
    1. If socket not found, log debug and return immediately (no-op)
    2. Set up disconnect listener BEFORE emitting shutdown (prevents race)
    3. Emit `shutdown` event with ack callback
    4. Wait for disconnect event OR timeout (do NOT wait for ack)
    5. On timeout: log warning, clean up listener, return (best-effort)
    6. On disconnect: clean up timeout, return

    ```typescript
    async sendExtensionHostShutdown(
      workspacePath: string,
      options?: { timeoutMs?: number }
    ): Promise<void> {
      const timeoutMs = options?.timeoutMs ?? SHUTDOWN_DISCONNECT_TIMEOUT_MS;
      const normalized = normalizeWorkspacePath(workspacePath);
      const socket = this.connections.get(normalized);

      if (!socket) {
        this.logger.debug("Shutdown skipped: workspace not connected", { workspace: normalized });
        return;
      }

      return new Promise<void>((resolve) => {
        let resolved = false;

        const cleanup = () => {
          if (!resolved) {
            resolved = true;
            socket.off("disconnect", disconnectHandler);
            clearTimeout(timeoutId);
          }
        };

        const disconnectHandler = () => {
          this.logger.debug("Shutdown complete: socket disconnected", { workspace: normalized });
          cleanup();
          resolve();
        };

        const timeoutId = setTimeout(() => {
          this.logger.warn("Shutdown timeout: proceeding anyway", { workspace: normalized, timeoutMs });
          cleanup();
          resolve();
        }, timeoutMs);

        // Set up listener BEFORE emit to avoid race condition
        socket.once("disconnect", disconnectHandler);

        this.logger.debug("Sending shutdown", { workspace: normalized });
        socket.emit("shutdown", (result) => {
          // Ack received - extension is about to exit
          // Don't resolve here - wait for actual disconnect
          if (!result.success) {
            this.logger.warn("Shutdown ack error", { workspace: normalized, error: result.error });
          }
        });
      });
    }
    ```

  - Export constant from `src/services/plugin-server/index.ts`
  - Files affected: `src/services/plugin-server/plugin-server.ts`, `src/services/plugin-server/index.ts`
  - Test criteria: Unit tests and boundary tests (see Testing Strategy)

- [x] **Step 4: Integrate into workspace deletion flow**
  - Add new step between kill-terminals and cleanup-vscode in `executeDeletion()`
  - Create callback similar to `killTerminalsCallback` pattern in `src/main/index.ts`
  - Call via callback (best-effort, doesn't block on failure)
  - Files affected: `src/main/api/codehydra-api.ts`, `src/main/index.ts`
  - Test criteria: Integration test verifies ordering and completion

- [x] **Step 5: Update documentation**
  - Update `docs/ARCHITECTURE.md`: Add shutdown step to Workspace Deletion Sequence
  - Update `docs/PATTERNS.md`: Add `shutdown` event to Plugin Interface events table
  - Update `docs/API.md`: Add `shutdown` event to WebSocket Access section
  - Update `AGENTS.md`: Add `shutdown` event to Plugin Interface section
  - Files affected: `docs/ARCHITECTURE.md`, `docs/PATTERNS.md`, `docs/API.md`, `AGENTS.md`
  - Test criteria: Documentation accurately reflects implementation

- [x] **Step 6: Rebuild sidekick extension**
  - Run `npm run build:extension` to rebuild the vsix
  - Verify the new handler is included in the bundle (grep for "shutdown" in dist/extension.js)
  - Files affected: `src/services/vscode-setup/assets/codehydra-sidekick/dist/extension.js`
  - Test criteria: Built extension contains shutdown handler

## Testing Strategy

### Unit Tests (vitest)

| Test Case                                                 | Description                                                    | File                      |
| --------------------------------------------------------- | -------------------------------------------------------------- | ------------------------- |
| `sendExtensionHostShutdown resolves on disconnect`        | Verify function resolves when socket disconnects               | `plugin-server.test.ts`   |
| `sendExtensionHostShutdown resolves on timeout`           | Verify function resolves (doesn't throw) after timeout         | `plugin-server.test.ts`   |
| `sendExtensionHostShutdown handles missing socket`        | Verify early return when workspace not connected               | `plugin-server.test.ts`   |
| `sendExtensionHostShutdown uses default 5s timeout`       | Verify default timeout constant is used                        | `plugin-server.test.ts`   |
| `sendExtensionHostShutdown respects custom timeout`       | Verify custom timeout option is honored                        | `plugin-server.test.ts`   |
| `sendExtensionHostShutdown handles emit failure`          | Verify graceful handling if emit fails                         | `plugin-server.test.ts`   |
| `sendExtensionHostShutdown handles ack error`             | Verify warning logged on ack error, still waits for disconnect | `plugin-server.test.ts`   |
| `sendExtensionHostShutdown cleans up listener on timeout` | Verify disconnect listener removed after timeout               | `plugin-server.test.ts`   |
| `sendExtensionHostShutdown is idempotent`                 | Verify multiple calls for same workspace are safe              | `plugin-server.test.ts`   |
| `shutdown event signature in ServerToClientEvents`        | Verify type accepts correct callback                           | `plugin-protocol.test.ts` |

### Boundary Tests

| Test Case                                         | Description                                                             | File                             |
| ------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------- |
| `sendExtensionHostShutdown with real socket`      | Start real Socket.IO server, connect client, verify shutdown event      | `plugin-server.boundary.test.ts` |
| `disconnect detection with real socket lifecycle` | Verify disconnect event fires when client calls process.exit simulation | `plugin-server.boundary.test.ts` |
| `timeout behavior with real delays`               | Verify timeout fires correctly with actual setTimeout                   | `plugin-server.boundary.test.ts` |

### Integration Tests

| Test Case                                                | Description                                                            | File                                |
| -------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------- |
| `workspace deletion calls shutdown after kill-terminals` | Verify shutdown is called in correct order                             | `codehydra-api.integration.test.ts` |
| `workspace deletion flow ordering`                       | Mock both callbacks, assert order: kill-terminals → shutdown → cleanup | `codehydra-api.integration.test.ts` |
| `workspace deletion completes successfully`              | Verify worktree removed, no file handle errors                         | `codehydra-api.integration.test.ts` |
| `multi-workspace isolation`                              | Delete workspace A, verify workspace B socket unaffected               | `codehydra-api.integration.test.ts` |

### Test Utilities

Create mock factories in `src/services/plugin-server/test-utils.ts`:

- `createMockPluginServer()` - returns server with controllable socket map
- `createMockSocket()` - returns socket with emit/disconnect spies

### Manual Testing Checklist

**Extension Handler Verification:**

- [ ] Enable extension development host logging, trigger shutdown, verify logs show:
  1. "Shutdown command received, workspace: {path}"
  2. "Removed N workspace folder(s)"
  3. "Exiting extension host"
- [ ] Monitor process tree during shutdown, verify extension host PID disappears within 1 second

**Windows File Handle Tests:**

- [ ] Create workspace with open files, delete workspace → no "file in use" errors
- [ ] Create workspace with running terminal (`npm run dev`), delete → clean deletion
- [ ] Create workspace, open multiple files in editor, delete → clean deletion

**Cross-Platform Regression:**

- [ ] **Linux/macOS**: Verify deletion still works (no regression)

**Multi-Workspace:**

- [ ] Delete one workspace, verify others continue working
- [ ] Verify only target workspace receives shutdown event

**Edge Cases:**

- [ ] **Disconnected workspace**: Delete workspace that's not connected → graceful handling
- [ ] **Process verification**: Check process tree before/after deletion, confirm extension host is gone

## Dependencies

| Package | Purpose                      | Approved |
| ------- | ---------------------------- | -------- |
| (none)  | No new dependencies required | N/A      |

## Documentation Updates

### Files to Update

| File                   | Changes Required                                                           |
| ---------------------- | -------------------------------------------------------------------------- |
| `docs/ARCHITECTURE.md` | Add shutdown step to Workspace Deletion Sequence diagram and numbered list |
| `docs/PATTERNS.md`     | Add `shutdown` event to Plugin Interface Server→Client events table        |
| `docs/API.md`          | Add `shutdown` event to WebSocket Access events table                      |
| `AGENTS.md`            | Add `shutdown` event to Plugin Interface section                           |

### New Documentation Required

| File   | Purpose                                        |
| ------ | ---------------------------------------------- |
| (none) | Internal feature, documented in existing files |

## Definition of Done

- [ ] All implementation steps complete
- [ ] `npm run validate:fix` passes
- [ ] Unit tests passing
- [ ] Boundary tests passing
- [ ] Integration tests passing
- [ ] Manual testing passed (especially Windows)
- [ ] Documentation updated
- [ ] Changes committed
