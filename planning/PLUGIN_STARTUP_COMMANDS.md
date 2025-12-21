---
status: COMPLETED
last_updated: 2024-12-22
reviewers: [review-typescript, review-arch, review-testing, review-docs]
---

# PLUGIN_STARTUP_COMMANDS

## Overview

- **Problem**: Startup commands (close sidebars, open terminal, etc.) are executed by the VS Code extension with an arbitrary 100ms delay. CodeHydra has no control over timing.
- **Solution**: Move startup command execution to CodeHydra main process, triggered when a workspace's extension connects to the PluginServer.
- **Risks**:
  - Command execution timing - extension must be fully ready when connected (mitigated: Socket.IO connection only happens after extension activation)
  - Commands may fail if VS Code UI isn't ready (mitigated: log and continue, commands are non-critical; add small delay after connection)
- **Alternatives Considered**:
  - Keep in extension with longer delay - rejected: arbitrary timing, no CodeHydra control
  - Trigger from renderer UI - rejected: adds complexity, automatic is preferred
  - Use `Promise.allSettled()` for parallel execution - rejected: sequential is safer in case VS Code has ordering constraints (e.g., close sidebar before open terminal)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                  CodeHydra Main Process                             │
│                                                                     │
│  ┌─────────────────────┐      ┌──────────────────────────────────┐  │
│  │    PluginServer     │      │         index.ts                 │  │
│  │                     │      │                                  │  │
│  │  onConnect(cb) ─────┼──────► pluginServer.onConnect(path => { │  │
│  │  returns Unsubscribe│      │   void sendStartupCommands(...)  │  │
│  │                     │      │ })                               │  │
│  │  sendCommand() ◄────┼──────┤                                  │  │
│  │                     │      │                                  │  │
│  └─────────────────────┘      └──────────────────────────────────┘  │
│           │                                                         │
│           │ WebSocket                                               │
│           ▼                                                         │
│  ┌─────────────────────┐                                            │
│  │   VS Code Extension │                                            │
│  │   (no startup cmds) │                                            │
│  └─────────────────────┘                                            │
└─────────────────────────────────────────────────────────────────────┘
```

## Startup Commands

The following VS Code commands are sent on connection:

```typescript
export const STARTUP_COMMANDS = [
  "workbench.action.closeSidebar", // Hide left sidebar to maximize editor
  "workbench.action.closeAuxiliaryBar", // Hide right sidebar (auxiliary bar)
  "opencode.openTerminal", // Open OpenCode terminal for AI workflow
  "workbench.action.unlockEditorGroup", // Unlock editor group for tab reuse
  "workbench.action.closeEditorsInOtherGroups", // Clean up empty editor groups
] as const;

export type StartupCommand = (typeof STARTUP_COMMANDS)[number];
```

## Implementation Steps

- [x] **Step 1: Add onConnect callback to PluginServer**
  - Write failing tests first, then implement
  - Add `onConnect(callback: (workspacePath: string) => void): Unsubscribe` method
  - Store callbacks in a Set and invoke all when client connects (after validation)
  - Return `Unsubscribe` function following existing codebase pattern
  - Callback is invoked AFTER connection validation succeeds (rejected connections don't trigger)
  - Add JSDoc documentation for the new public method
  - Files: `src/services/plugin-server/plugin-server.ts`, `src/services/plugin-server/plugin-server.test.ts`
  - Test criteria:
    - Callback invoked with normalized workspace path on valid connection
    - Callback NOT invoked for invalid auth (rejected connections)
    - Multiple callbacks all invoked
    - Exception in one callback doesn't crash server or prevent other callbacks
    - Unsubscribe function removes callback

- [x] **Step 2: Define startup commands constant**
  - Create `STARTUP_COMMANDS` array with the 5 VS Code command IDs (listed above)
  - Use `as const` assertion for literal type checking
  - Export `StartupCommand` type for type safety
  - Place in `src/services/plugin-server/startup-commands.ts`
  - Export from `src/services/plugin-server/index.ts`
  - Files: `src/services/plugin-server/startup-commands.ts`, `src/services/plugin-server/index.ts`
  - Test criteria:
    - `STARTUP_COMMANDS` is array of 5 strings
    - Each command matches expected VS Code command ID

- [x] **Step 3: Create sendStartupCommands helper**
  - Write failing tests first, then implement
  - Function signature:
    ```typescript
    /**
     * Send startup commands to configure workspace layout.
     * Commands are sent sequentially; failures are logged but don't stop execution.
     *
     * @param server - PluginServer instance to send commands through
     * @param workspacePath - Normalized workspace path
     * @param logger - Logger for command execution logging
     * @param delayMs - Delay before sending commands (default: 100ms for UI stabilization)
     */
    export async function sendStartupCommands(
      server: PluginServer,
      workspacePath: string,
      logger: Logger,
      delayMs = 100
    ): Promise<void>;
    ```
  - Wait `delayMs` before sending commands (allows VS Code UI to stabilize)
  - Send commands sequentially with `for...of` and `await`
  - Each command is awaited before sending next
  - On failure: log warning with command ID, error message, and workspace path, then continue
  - Use shorter timeout (5s) for startup commands since they're best-effort
  - Files: `src/services/plugin-server/startup-commands.ts`, `src/services/plugin-server/startup-commands.test.ts`
  - Test criteria:
    - All 5 commands sent to correct workspace path
    - Commands sent sequentially (second not sent until first completes)
    - Failure of one command doesn't prevent others
    - Failures logged with command ID, error, and workspace path
    - Timeout handled gracefully (logged, continues to next)
    - Empty/invalid workspace path handled gracefully

- [x] **Step 4: Wire up in main process**
  - In `src/main/index.ts`, in `startServices()`, after PluginServer starts:
    ```typescript
    // After: const pluginPort = await pluginServer.start();
    const pluginLogger = loggingService.createLogger("plugin");
    pluginServer.onConnect((workspacePath) => {
      void sendStartupCommands(pluginServer, workspacePath, pluginLogger);
    });
    ```
  - Use `void` operator for fire-and-forget async call (established pattern in AGENTS.md)
  - Use same `[plugin]` logger as PluginServer for consistent log grouping
  - Files: `src/main/index.ts`
  - Test criteria: Covered by integration test (Step 6)

- [x] **Step 5: Remove startup commands from extension**
  - Remove the `setTimeout` block with startup commands from `activate()` (lines 104-118)
  - Keep only the PluginServer connection logic
  - Verify extension still activates correctly after removal
  - Files: `src/services/vscode-setup/assets/codehydra-extension/extension.js`
  - Test criteria: Extension activates without errors, connects to PluginServer

- [x] **Step 6: Add integration test for wiring**
  - Test the full flow: PluginServer start → onConnect registration → connection → sendStartupCommands called
  - Use real PluginServer with mock Socket.IO client
  - Verify commands reach the wire protocol level
  - Files: `src/services/plugin-server/plugin-server.integration.test.ts`
  - Test criteria:
    - All 5 startup commands received by mock client
    - Commands received in correct order
    - Commands sent after connection established

- [x] **Step 7: Update boundary test**
  - Extend existing boundary test to verify startup commands flow
  - Files: `src/services/plugin-server/plugin-server.boundary.test.ts`
  - Test criteria:
    - All 5 command IDs sent in correct order
    - Commands sent with no arguments
    - Commands sent after connection established (not before)
    - Failure of one command doesn't prevent others
    - Concurrent workspace connections handled independently

## Testing Strategy

### Unit Tests (vitest)

| Test Case                                            | Description                                      | File                       |
| ---------------------------------------------------- | ------------------------------------------------ | -------------------------- |
| `onConnect callback invoked with workspace path`     | Verify callback called after valid connection    | `plugin-server.test.ts`    |
| `onConnect callback not called for invalid auth`     | Verify callback skipped for rejected connections | `plugin-server.test.ts`    |
| `onConnect multiple callbacks all invoked`           | Verify all registered callbacks called           | `plugin-server.test.ts`    |
| `onConnect callback exception doesn't crash server`  | Exception in callback doesn't prevent others     | `plugin-server.test.ts`    |
| `onConnect unsubscribe removes callback`             | Unsubscribe function works correctly             | `plugin-server.test.ts`    |
| `STARTUP_COMMANDS has 5 valid command strings`       | Validate constant structure                      | `startup-commands.test.ts` |
| `sendStartupCommands sends all commands`             | All 5 commands sent to correct path              | `startup-commands.test.ts` |
| `sendStartupCommands sends commands sequentially`    | Second command waits for first                   | `startup-commands.test.ts` |
| `sendStartupCommands continues on failure`           | Failure doesn't stop remaining commands          | `startup-commands.test.ts` |
| `sendStartupCommands logs failures with context`     | Logger.warn called with command, error, path     | `startup-commands.test.ts` |
| `sendStartupCommands handles timeout gracefully`     | Timeout logged, continues to next                | `startup-commands.test.ts` |
| `sendStartupCommands handles invalid workspace path` | Empty/null path handled gracefully               | `startup-commands.test.ts` |
| `sendStartupCommands waits for delay before sending` | Commands not sent until after delay              | `startup-commands.test.ts` |

### Integration Tests

| Test Case                                             | Description                            | File                                |
| ----------------------------------------------------- | -------------------------------------- | ----------------------------------- |
| `startup commands sent on workspace connection`       | Full flow: connect → commands received | `plugin-server.integration.test.ts` |
| `concurrent connections receive independent commands` | Multiple workspaces handled correctly  | `plugin-server.integration.test.ts` |

### Manual Testing Checklist

**When to test:** After Step 5 complete (extension updated)

- [ ] Start CodeHydra, open a project with a workspace
- [ ] Verify sidebars are closed when workspace loads
- [ ] Verify OpenCode terminal opens automatically
- [ ] Check logs for "Sending startup commands" and individual command logs
- [ ] Verify startup commands complete within 2 seconds of connection
- [ ] Verify no 100ms delay visible (commands sent immediately after brief stabilization delay)

## Dependencies

No new dependencies required.

## Documentation Updates

### Files to Update

| File        | Changes Required                                                |
| ----------- | --------------------------------------------------------------- |
| `AGENTS.md` | Add Startup Commands subsection to Plugin Interface (see below) |

### Exact Documentation to Add

In `AGENTS.md`, Plugin Interface section, after "Connection Lifecycle" subsection, add:

```markdown
### Startup Commands

When an extension connects to PluginServer, CodeHydra automatically sends startup commands to configure the workspace layout:

| Command                                      | Purpose                                    |
| -------------------------------------------- | ------------------------------------------ |
| `workbench.action.closeSidebar`              | Hide left sidebar to maximize editor space |
| `workbench.action.closeAuxiliaryBar`         | Hide right sidebar (auxiliary bar)         |
| `opencode.openTerminal`                      | Open OpenCode terminal for AI workflow     |
| `workbench.action.unlockEditorGroup`         | Unlock editor group for tab reuse          |
| `workbench.action.closeEditorsInOtherGroups` | Clean up empty editor groups               |

Commands are sent sequentially after a brief delay (100ms) for UI stabilization. Failures are non-fatal and logged as warnings with `[plugin]` logger.
```

### New Documentation Required

None - internal implementation detail covered by AGENTS.md update.

## Definition of Done

- [ ] All implementation steps complete
- [ ] `npm run validate:fix` passes
- [ ] Documentation updated
- [ ] User acceptance testing passed
- [ ] Changes committed
