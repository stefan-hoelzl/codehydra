---
status: COMPLETED
last_updated: 2025-12-23
reviewers: [review-typescript, review-arch, review-testing, review-docs]
---

# PLUGIN_API

## Overview

- **Problem**: Third-party VS Code extensions cannot interact with CodeHydra. The current plugin protocol only supports Server→Client commands (CodeHydra sending VS Code commands), not Client→Server API calls.

- **Solution**: Extend the plugin protocol to support bidirectional communication, allowing extensions to call CodeHydra API methods. Expose a workspace-scoped API subset via the codehydra extension's `exports` for other extensions to consume.

- **Risks**:
  - API versioning - future changes could break third-party extensions
  - Mitigation: Start with a minimal, stable API surface (3 methods only)

- **Alternatives Considered**:
  - **Full API exposure**: Rejected - too large an API surface, harder to maintain backwards compatibility
  - **HTTP API**: Rejected - Socket.IO already established, adds unnecessary complexity
  - **Global API (cross-workspace)**: Rejected - security concerns, simpler to scope to connected workspace

## Architecture

```
┌───────────────────────────────────────────────────────────────────────────┐
│                      CodeHydra (Electron Main)                            │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │  PluginServer                                                       │  │
│  │                                                                     │  │
│  │  connections: Map<workspacePath, Socket>                            │  │
│  │                                                                     │  │
│  │  Server → Client:                                                   │  │
│  │  ───► "command" (execute VS Code commands)                          │  │
│  │                                                                     │  │
│  │  Client → Server:  [NEW]                                            │  │
│  │  ◄─── "api:workspace:getStatus" → PluginResult<WorkspaceStatus>     │  │
│  │  ◄─── "api:workspace:getMetadata" → PluginResult<Record<...>>       │  │
│  │  ◄─── "api:workspace:setMetadata" → PluginResult<void>              │  │
│  │                                                                     │  │
│  │  API handlers registered via onApiCall() callback pattern           │  │
│  │  (PluginServer remains agnostic to API layer)                       │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                           ▲                               │
│                                           │ wirePluginApi() registers     │
│                                           │ handlers in startServices()   │
│  ┌────────────────────────────────────────┴────────────────────────────┐  │
│  │  wirePluginApi() - src/main/index.ts                                │  │
│  │                                                                     │  │
│  │  Workspace path resolution:                                         │  │
│  │  1. appState.findProjectForWorkspace(workspacePath)                 │  │
│  │  2. generateProjectId(project.path)                                 │  │
│  │  3. path.basename(workspacePath) as WorkspaceName                   │  │
│  │  4. If not found → return { success: false, error: "..." }          │  │
│  │                                                                     │  │
│  │  Delegates to ICodeHydraApi after resolution                        │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
                    │ WebSocket (localhost only)
                    ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                    codehydra extension (code-server)                      │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │  extension.js                                                       │  │
│  │                                                                     │  │
│  │  // Socket.IO client                                                │  │
│  │  socket.on("command", handler)           // existing                │  │
│  │  socket.emit("api:workspace:...", ack)   // [NEW] outbound API      │  │
│  │                                                                     │  │
│  │  // Connection state management                                     │  │
│  │  let connected = false;                                             │  │
│  │  let pendingReady = [];  // queue for whenReady()                   │  │
│  │                                                                     │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │  exports.codehydra = {                    [NEW]                     │  │
│  │    whenReady(): Promise<void>             // resolves when connected│  │
│  │    workspace: {                                                     │  │
│  │      getStatus(): Promise<WorkspaceStatus>                          │  │
│  │      getMetadata(): Promise<Record<string, string>>                 │  │
│  │      setMetadata(key, value): Promise<void>                         │  │
│  │    }                                                                │  │
│  │  }                                                                  │  │
│  │                                                                     │  │
│  │  Error handling: Returns rejected Promise with clear message        │  │
│  │  (matches PluginResult pattern - no throwing)                       │  │
│  │                                                                     │  │
│  │  Timeout: 10s (matches COMMAND_TIMEOUT_MS)                          │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
                    │
                    │ vscode.extensions.getExtension()
                    ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                    Third-party extension                                  │
│                                                                           │
│  const ext = vscode.extensions.getExtension('codehydra.codehydra');       │
│  const api = ext?.exports?.codehydra;                                     │
│  if (!api) throw new Error('codehydra extension not available');          │
│                                                                           │
│  await api.whenReady();  // wait for connection                           │
│  const status = await api.workspace.getStatus();                          │
│  const metadata = await api.workspace.getMetadata();                      │
│  await api.workspace.setMetadata('note', 'Working on feature X');         │
└───────────────────────────────────────────────────────────────────────────┘
```

## Implementation Steps

- [x] **Step 1: Extend plugin protocol types**
  - Replace `ClientToServerEvents = Record<string, never>` with typed interface
  - Add explicit Socket.IO acknowledgment callback signatures:

    ```typescript
    export interface ClientToServerEvents {
      "api:workspace:getStatus": (ack: (result: PluginResult<WorkspaceStatus>) => void) => void;
      "api:workspace:getMetadata": (
        ack: (result: PluginResult<Record<string, string>>) => void
      ) => void;
      "api:workspace:setMetadata": (
        request: SetMetadataRequest,
        ack: (result: PluginResult<void>) => void
      ) => void;
    }

    export interface SetMetadataRequest {
      readonly key: string;
      readonly value: string | null;
    }
    ```

  - Add validation function for `SetMetadataRequest`:
    - Validate `key` against existing `METADATA_KEY_REGEX` (from `types.ts`)
    - Validate `value` is string or null
  - Files: `src/shared/plugin-protocol.ts`
  - Test criteria: Types compile, validators reject invalid payloads (empty key, invalid key format, wrong value type)

- [x] **Step 2: Add PluginServer API callback support**
  - Add `onApiCall()` method to register API handlers (callback pattern, like `onConnect()`)
  - PluginServer remains agnostic to API layer - just routes events to callbacks
  - Handle incoming `api:workspace:*` events on client sockets
  - Pass workspace path (from `socket.data.workspacePath`) to callback
  - Return callback result via Socket.IO acknowledgment
  - Validate `SetMetadataRequest` before invoking callback
  - Files: `src/services/plugin-server/plugin-server.ts`
  - Test criteria: Events routed to callbacks, workspace path passed correctly, validation works

- [x] **Step 3: Create test utilities for PluginServer**
  - Create `createMockSocket()` factory for unit tests
  - Mock Socket.IO client behavior for testing API calls
  - Files: `src/services/plugin-server/plugin-server.test-utils.ts`
  - Test criteria: Mock socket usable in unit tests, simulates emit/ack pattern

- [x] **Step 4: Wire PluginServer to CodeHydraApi**
  - Create `wirePluginApi()` function (pattern matches `wireApiEvents()`)
  - Workspace path resolution logic:
    1. `appState.findProjectForWorkspace(workspacePath)` → project or undefined
    2. If undefined → return `{ success: false, error: "Workspace not found" }`
    3. `generateProjectId(project.path)` → projectId
    4. `path.basename(workspacePath)` as WorkspaceName
  - Register callbacks via `pluginServer.onApiCall()`:
    - `getStatus`: resolve IDs, call `api.workspaces.getStatus()`, wrap in PluginResult
    - `getMetadata`: resolve IDs, call `api.workspaces.getMetadata()`, wrap in PluginResult
    - `setMetadata`: resolve IDs, call `api.workspaces.setMetadata()`, wrap in PluginResult
  - Error handling: try/catch around API calls, map exceptions to `{ success: false, error: message }`
  - Files: `src/main/index.ts`
  - Test criteria: End-to-end API calls work, errors mapped correctly

- [x] **Step 5: Update extension to expose API**
  - Create `CodehydraApi` object wrapping Socket.IO calls
  - Add `whenReady()` method returning Promise that resolves when connected
  - Queue API calls made before connection, resolve when connected
  - Timeout handling: 10s timeout (matches `COMMAND_TIMEOUT_MS`)
  - Error handling: Return rejected Promise with clear message (not throw)
  - Expose via `activate()` return value: `return { codehydra: api }`
  - Add JSDoc type annotations matching the `.d.ts` file
  - Files: `src/services/vscode-setup/assets/codehydra-extension/extension.js`
  - Test criteria: API callable, errors return rejected Promises, timeout works

- [x] **Step 6: Add extension API type declarations**
  - Create inline `.d.ts` file (simpler than npm package for 3-method API)
  - Document that third-party extensions should copy this file
  - Include all types: `WorkspaceStatus`, `AgentStatus`, `AgentStatusCounts`
  - Include `CodehydraApi` interface with `whenReady()` and `workspace` namespace
  - Files: `src/services/vscode-setup/assets/codehydra-extension/api.d.ts`
  - Test criteria: Types compile, match runtime behavior

## Testing Strategy

### Unit Tests (vitest)

| Test Case                                                | Description                                            | File                      |
| -------------------------------------------------------- | ------------------------------------------------------ | ------------------------- |
| `validates SetMetadataRequest with valid key`            | Validator accepts alphanumeric keys                    | `plugin-protocol.test.ts` |
| `rejects SetMetadataRequest with empty key`              | Validator rejects empty string                         | `plugin-protocol.test.ts` |
| `rejects SetMetadataRequest with invalid key format`     | Validator rejects keys not matching METADATA_KEY_REGEX | `plugin-protocol.test.ts` |
| `rejects SetMetadataRequest with wrong value type`       | Validator rejects non-string/null values               | `plugin-protocol.test.ts` |
| `routes api:workspace:getStatus to callback`             | PluginServer routes to registered handler              | `plugin-server.test.ts`   |
| `routes api:workspace:getMetadata to callback`           | PluginServer routes to registered handler              | `plugin-server.test.ts`   |
| `routes api:workspace:setMetadata to callback`           | PluginServer routes to registered handler              | `plugin-server.test.ts`   |
| `passes workspace path from socket.data to callback`     | Handler receives correct workspace path                | `plugin-server.test.ts`   |
| `validates setMetadata request before callback`          | Invalid request returns error, callback not invoked    | `plugin-server.test.ts`   |
| `returns error when no callback registered`              | Error returned if onApiCall not called                 | `plugin-server.test.ts`   |
| `handles concurrent API calls from different workspaces` | Multiple sockets can call simultaneously               | `plugin-server.test.ts`   |
| `handles rapid sequential calls from same workspace`     | No race conditions                                     | `plugin-server.test.ts`   |

### Boundary Tests (vitest)

| Test Case                                   | Description                    | File                             |
| ------------------------------------------- | ------------------------------ | -------------------------------- |
| `getStatus round-trip via real Socket.IO`   | Client emits, server responds  | `plugin-server.boundary.test.ts` |
| `getMetadata round-trip via real Socket.IO` | Client emits, server responds  | `plugin-server.boundary.test.ts` |
| `setMetadata round-trip via real Socket.IO` | Client emits, server responds  | `plugin-server.boundary.test.ts` |
| `handles socket disconnect mid-request`     | Graceful failure on disconnect | `plugin-server.boundary.test.ts` |
| `handles request timeout`                   | Returns error after timeout    | `plugin-server.boundary.test.ts` |

### Integration Tests

| Test Case                                 | Description                           | File                                |
| ----------------------------------------- | ------------------------------------- | ----------------------------------- |
| `getStatus returns workspace status`      | Full round-trip through wirePluginApi | `plugin-server.integration.test.ts` |
| `getMetadata returns workspace metadata`  | Full round-trip through wirePluginApi | `plugin-server.integration.test.ts` |
| `setMetadata updates workspace metadata`  | Full round-trip through wirePluginApi | `plugin-server.integration.test.ts` |
| `returns error when workspace not found`  | Unknown workspace path returns error  | `plugin-server.integration.test.ts` |
| `returns error when metadata key invalid` | Invalid key rejected at validation    | `plugin-server.integration.test.ts` |
| `returns error when API throws exception` | Exception mapped to error response    | `plugin-server.integration.test.ts` |

### Manual Testing Checklist

- [ ] Start CodeHydra with a project and workspace
- [ ] Verify extension connects to PluginServer (check logs)
- [ ] From VS Code dev tools console, get extension API:
  ```javascript
  const ext = vscode.extensions.getExtension("codehydra.codehydra");
  const api = ext?.exports?.codehydra;
  await api.whenReady();
  ```
- [ ] Call `api.workspace.getStatus()` and verify correct status returned
- [ ] Call `api.workspace.setMetadata('test-key', 'test-value')`
- [ ] Call `api.workspace.getMetadata()` and verify 'test-key' present
- [ ] Disconnect network briefly, verify `whenReady()` works after reconnect
- [ ] Test error case: call API before extension connected

## Dependencies

| Package | Purpose                      | Approved |
| ------- | ---------------------------- | -------- |
| (none)  | No new dependencies required | N/A      |

## Documentation Updates

### Files to Update

| File                   | Changes Required                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`            | Add Plugin API section documenting the extension API for third-party developers                                                           |
| `docs/ARCHITECTURE.md` | Update Plugin Interface section to document bidirectional protocol (Client→Server API: api:workspace:getStatus, getMetadata, setMetadata) |

### New Documentation Required

| File   | Purpose                                                  |
| ------ | -------------------------------------------------------- |
| (none) | API documented in TypeScript declaration file (api.d.ts) |

## Definition of Done

- [x] All implementation steps complete
- [x] `npm run validate:fix` passes
- [x] Documentation updated
- [x] User acceptance testing passed
- [x] Changes committed
