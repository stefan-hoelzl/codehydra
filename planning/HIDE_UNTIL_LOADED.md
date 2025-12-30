---
status: COMPLETED
last_updated: 2025-12-30
reviewers: [review-ui, review-typescript, review-arch, review-testing, review-docs]
---

# HIDE_UNTIL_LOADED

## Overview

- **Problem**: When a workspace is created/activated, VS Code loads progressively causing visual flickering.
- **Solution**: Keep VS Code view hidden until first MCP request received (TUI attachment signal), with 10-second timeout fallback
- **Risks**:
  - OpenCode server might fail to start → timeout handles this
  - OpenCode CLI might fail to attach → timeout handles this
  - User might expect immediate feedback → loading overlay provides feedback
- **Alternatives Considered**:
  - **OpenCode SSE events (original approach)**: Discovered that OpenCode doesn't emit SSE events when TUI attaches. `session.created` only fires when user sends first prompt, NOT when TUI attaches. Status change is not a valid signal.
  - Separate "client attached" callback: OpenCode SDK doesn't provide this
  - Wait for extension connection: Too early, VS Code still loading
  - CSS opacity hiding: View still attached, may still consume GPU
  - Extend WorkspaceStatus with isLoading: Considered, but separate event is clearer for this transient state

### Key Discovery: MCP-Based Detection

During implementation, we discovered that OpenCode SSE events don't fire when TUI (Terminal User Interface) attaches - only when a session is created (first user prompt). However, through testing we confirmed:

1. When app runs WITHOUT TUI attachment (`opencode.openTerminal` not called): **ZERO MCP requests**
2. When TUI attaches: MCP requests appear ~0.7 seconds later

The MCP requests are made by `opencode serve` when a TUI client attaches, even though the user hasn't sent a prompt yet. This makes the first MCP request a reliable proxy signal for TUI attachment.

### Valid Detection Signals

| Signal      | Trigger        | Timing             | Use            |
| ----------- | -------------- | ------------------ | -------------- |
| MCP request | TUI attachment | ~0.7s after attach | Primary signal |
| Timeout     | None           | 10s fixed          | Fallback       |

**Invalid signals (do NOT use):**

- `onStatusChanged` - Only fires when first session created (user sends prompt), not on TUI attachment
- OpenCode SSE events - Same issue, `session.created` requires user interaction

## Architecture

```
Detection Signal: First MCP Request
====================================

When a workspace is created, the OpenCode server starts but no TUI has attached yet.
OpenCode SSE doesn't emit events when TUI attaches (only on session.created after first prompt).
However, MCP requests ARE triggered by TUI attachment.

Detection flow:
  1. Workspace created, view loading, MCP server running
  2. TUI attaches to workspace's OpenCode server
  3. TUI triggers MCP requests (~0.7s after attachment)
  4. McpServerManager fires onFirstRequest callback
  5. ViewManager.setWorkspaceLoaded() called → view attached

Fallback: 10-second timeout if TUI never attaches


Workspace Creation Flow:
========================

┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ createWorkspace │ ──► │ setActiveWS      │ ──► │ User sees       │
│ View (detached) │     │ (load URL only,  │     │ loading overlay │
│ + start timeout │     │  keep detached)  │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                                                 │
        ▼                                                 │
┌─────────────────┐     ┌──────────────────┐             │
│ startOpenCode   │ ──► │ TUI attaches     │             │
│ ServerAsync()   │     │ (opencode CLI    │             │
│ (existing)      │     │  in terminal)    │             │
└─────────────────┘     └──────────────────┘             │
                                │                         │
                                ▼                         │
                        ┌──────────────────┐             │
                        │ First MCP request│             │
                        │ received (~0.7s) │             │
                        └──────────────────┘             │
                                │                         │
                                ▼                         │
                        ┌──────────────────┐             │
                        │ McpServerManager │◄────────────┘
                        │ onFirstRequest() │   (or timeout after 10s)
                        └──────────────────┘
                                │
                                ▼
                        ┌──────────────────┐
                        │ setWorkspace     │
                        │ Loaded(path)     │
                        │ + attachView()   │
                        └──────────────────┘
                                │
                                ▼
                        ┌──────────────────┐
                        │ User sees VS Code│
                        │ (fully ready)    │
                        └──────────────────┘
```

## UI Design

```
┌──────────────────────────────────────────────────────────────┐
│ ┌───┐                                                        │
│ │   │  Loading Overlay (covers workspace area)              │
│ │ S │  ┌──────────────────────────────────────────────────┐ │
│ │ I │  │                                                  │ │
│ │ D │  │                                                  │ │
│ │ E │  │         <vscode-progress-ring>                   │ │
│ │ B │  │         Loading workspace...                     │ │
│ │ A │  │                                                  │ │
│ │ R │  │                                                  │ │
│ │   │  │                                                  │ │
│ │   │  └──────────────────────────────────────────────────┘ │
│ └───┘                                                        │
└──────────────────────────────────────────────────────────────┘

Overlay uses:
- <vscode-progress-ring> for spinner (handles prefers-reduced-motion internally)
- Svelte transition:fade for mount/unmount animation (respects prefers-reduced-motion)
- role="status" and aria-live="polite" for screen reader announcements
- Same positioning as DeletionProgressView (absolute, left: var(--ch-sidebar-minimized-width))
```

### User Interactions

- **Workspace activation**: Loading overlay appears (fade in)
- **TUI attaches (MCP request received)**: Overlay fades out, VS Code visible (~3s)
- **Timeout (10s)**: Overlay fades out, VS Code visible
- **Switch away during loading**: Overlay follows active workspace state
- **Switch back to loading workspace**: Overlay re-appears (derived state is per-workspace)

## Implementation Steps

- [x] **Step 1: Add loading state tracking to ViewManager**
  - Add `loadingWorkspaces: Map<string, NodeJS.Timeout>` to track workspaces awaiting TUI attach
  - Add exported constant `WORKSPACE_LOADING_TIMEOUT_MS = 10000`
  - Add `loadingChangeCallbacks: Set<(path: string, loading: boolean) => void>` for notifications
  - Add method `onLoadingChange(callback): Unsubscribe`
  - Add method `isWorkspaceLoading(path: string): boolean`
  - **Update `IViewManager` interface** with new methods:
    ```typescript
    isWorkspaceLoading(workspacePath: string): boolean;
    setWorkspaceLoaded(workspacePath: string): void;
    onLoadingChange(callback: (path: string, loading: boolean) => void): Unsubscribe;
    ```
  - Add JSDoc comments for all new public methods
  - Files affected: `src/main/managers/view-manager.ts`, `src/main/managers/view-manager.interface.ts`
  - Test criteria: Loading state can be set and queried, callbacks fire on state change

- [x] **Step 2: Integrate loading state into workspace lifecycle**
  - Modify `createWorkspaceView()` to mark workspace as loading and start timeout:
    ```typescript
    const timeout = setTimeout(
      () => this.setWorkspaceLoaded(workspacePath),
      WORKSPACE_LOADING_TIMEOUT_MS
    );
    this.loadingWorkspaces.set(workspacePath, timeout);
    this.notifyLoadingChange(workspacePath, true);
    ```
  - Add private method `notifyLoadingChange(path: string, loading: boolean)` to invoke callbacks
  - Add method `setWorkspaceLoaded(path: string)` to:
    1. Guard: `if (!this.loadingWorkspaces.has(workspacePath)) return;`
    2. Clear timeout if exists
    3. Remove from loadingWorkspaces map
    4. Notify listeners with loading=false
    5. If this workspace is active, call `attachView(path)`
  - Modify `setActiveWorkspace()`: if workspace is loading, load URL but do NOT attach (keep detached)
  - Modify `destroyWorkspaceView()` to clean up loading state:
    ```typescript
    const timeout = this.loadingWorkspaces.get(workspacePath);
    if (timeout !== undefined) {
      clearTimeout(timeout);
      this.loadingWorkspaces.delete(workspacePath);
      this.notifyLoadingChange(workspacePath, false);
    }
    ```
  - **CRITICAL**: `createWorkspaceView()` must be called BEFORE `startOpenCodeServerAsync()` to ensure the loading state is tracked before MCP requests can arrive from the OpenCode server
  - Files affected: `src/main/managers/view-manager.ts`
  - Test criteria: Loading workspace stays detached when activated, becomes attached when loaded

- [x] **Step 3: Add IPC event for loading state changes**
  - Add `WORKSPACE_LOADING_CHANGED: "api:workspace:loading-changed"` to `ApiIpcChannels`
  - Define payload type in `src/shared/ipc.ts`:
    ```typescript
    export interface WorkspaceLoadingChangedPayload {
      readonly path: WorkspacePath;
      readonly loading: boolean;
    }
    ```
  - Wire `viewManager.onLoadingChange()` to emit IPC event in `wireApiEvents()`
  - Note: No preload changes needed - existing `on()` function handles arbitrary events via channel mapping
  - Files affected: `src/shared/ipc.ts`, `src/main/ipc/api-handlers.ts`
  - Test criteria: Renderer receives loading state change events, verify with mock webContents.send()

- [x] **Step 4: Add loading state store in renderer**
  - Create new file `src/renderer/lib/stores/workspace-loading.svelte.ts`
  - Use `SvelteSet<string>` from `svelte/reactivity` (cleaner than Map for boolean state):

    ```typescript
    import { SvelteSet } from "svelte/reactivity";
    const _loadingWorkspaces = new SvelteSet<string>();

    export function isWorkspaceLoading(path: string): boolean {
      return _loadingWorkspaces.has(path);
    }

    export function setWorkspaceLoading(path: string, loading: boolean): void {
      if (loading) {
        _loadingWorkspaces.add(path);
      } else {
        _loadingWorkspaces.delete(path);
      }
    }
    ```

  - Files affected: new file `src/renderer/lib/stores/workspace-loading.svelte.ts`
  - Test file: `src/renderer/lib/stores/workspace-loading.test.ts`
  - Test criteria: Store correctly tracks loading state per workspace

- [x] **Step 5: Subscribe to loading events in renderer**
  - Add `api.on("workspace:loading-changed", ...)` in `setupDomainEventBindings.ts`:
    ```typescript
    const unsubLoading = api.on<WorkspaceLoadingChangedPayload>(
      "workspace:loading-changed",
      (payload) => setWorkspaceLoading(payload.path, payload.loading)
    );
    ```
  - Add cleanup to returned function
  - Files affected: `src/renderer/lib/utils/setup-domain-event-bindings.ts`, `src/renderer/lib/api/index.ts`
  - Test criteria: Store updates when IPC events received

- [x] **Step 6: Create WorkspaceLoadingOverlay component**
  - Create `src/renderer/lib/components/WorkspaceLoadingOverlay.svelte`
  - Use `<vscode-progress-ring>` for spinner (handles prefers-reduced-motion internally)
  - Show "Loading workspace..." message
  - Add accessibility: `role="status"` and `aria-live="polite"` on container
  - **Use Svelte transition for fade in/out** (respects prefers-reduced-motion automatically):

    ```svelte
    <script>
      import { fade } from "svelte/transition";
    </script>

    <div
      class="loading-overlay"
      role="status"
      aria-live="polite"
      transition:fade={{ duration: 150 }}
    >
      ...
    </div>
    ```

  - Use same positioning as `DeletionProgressView`:
    ```css
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: var(--ch-sidebar-minimized-width, 20px);
    ```
  - Files affected: new file `src/renderer/lib/components/WorkspaceLoadingOverlay.svelte`
  - Test file: `src/renderer/lib/components/WorkspaceLoadingOverlay.test.ts`
  - Test criteria: Component renders with progress ring and message, has proper ARIA attributes

- [x] **Step 7: Integrate loading overlay into MainView**
  - Import `isWorkspaceLoading` from store
  - Add derived state: `const activeLoading = $derived(activeWorkspacePath.value ? isWorkspaceLoading(activeWorkspacePath.value) : false)`
  - Update conditional rendering order (deletion > loading > empty):
    ```svelte
    {#if activeDeletionState}
      <DeletionProgressView ... />
    {:else if activeLoading}
      <WorkspaceLoadingOverlay />
    {:else if activeWorkspacePath.value === null}
      <div class="empty-backdrop">...</div>
    {/if}
    ```
  - Files affected: `src/renderer/lib/components/MainView.svelte`
  - Test criteria: Loading overlay shows for loading workspace, hides when loaded, re-appears when switching back to loading workspace

- [x] **Step 8: Handle edge cases**
  - **Existing workspaces on startup**: No code changes needed - existing workspaces are not marked as loading
  - **Rapid workspace switching**: No code changes needed - loading state is tracked per workspace in Map, each workspace has independent timeout
  - **Workspace deletion during loading**: Handled in Step 2's `destroyWorkspaceView()` modification - clears timeout and loading state
  - **Timeout fires but client attaches later**: No code changes needed - view already shown via timeout
  - **setWorkspaceLoading(path, false) for unknown path**: Handled by SvelteSet.delete() - safe no-op
  - Files affected: None (edge cases handled by design)
  - Test criteria: Create workspace, delete immediately, advance timers by 11s - no errors; multiple workspace switches preserve correct loading states

- [x] **Step 9: Add MCP-based detection (primary signal)**

  **Architecture**: McpServer emits request events → McpServerManager tracks first-per-workspace and notifies callbacks → external code (index.ts) subscribes via `onFirstRequest()`
  - **a. Define callback type** in `src/services/mcp-server/types.ts`:

    ```typescript
    /** Callback for MCP request events. Fire-and-forget, errors logged internally. */
    export type McpRequestCallback = (workspacePath: string) => void;
    ```

  - **b. Update McpServer** in `src/services/mcp-server/mcp-server.ts`:
    - Add `onRequest?: McpRequestCallback` to constructor parameters
    - In `handleRequest()`, after extracting workspacePath from `X-Workspace-Path` header, call callback with try-catch:
      ```typescript
      // After const workspacePath = this.getWorkspacePath(req);
      if (workspacePath && this.onRequest) {
        try {
          this.onRequest(workspacePath);
        } catch (error) {
          this.logger.error("onRequest callback error", { error: getErrorMessage(error) });
        }
      }
      ```

  - **c. Update McpServerManager** in `src/services/mcp-server/mcp-server-manager.ts`:
    - Add state tracking (use Path class for normalized comparison):

      ```typescript
      import { Path } from "../platform/path";

      private seenWorkspaces = new Set<string>();
      private firstRequestCallbacks = new Set<McpRequestCallback>();
      ```

    - Add subscription method:
      ```typescript
      /**
       * Subscribe to first MCP request per workspace.
       * Callback fires once per workspace when the first request is received.
       */
      onFirstRequest(callback: McpRequestCallback): Unsubscribe {
        this.firstRequestCallbacks.add(callback);
        return () => this.firstRequestCallbacks.delete(callback);
      }
      ```
    - Add private notification method:
      ```typescript
      private notifyFirstRequest(workspacePath: string): void {
        const normalizedPath = new Path(workspacePath).toString();
        if (this.seenWorkspaces.has(normalizedPath)) return;
        this.seenWorkspaces.add(normalizedPath);
        for (const callback of this.firstRequestCallbacks) {
          callback(normalizedPath);
        }
      }
      ```
    - Pass callback to McpServer in `start()`:
      ```typescript
      this.mcpServer = new McpServer(
        this.api,
        this.appState,
        this.serverFactory,
        this.logger,
        (workspacePath) => this.notifyFirstRequest(workspacePath)
      );
      ```
    - Add cleanup in `stop()`:
      ```typescript
      async stop(): Promise<void> {
        // ... existing cleanup
        this.seenWorkspaces.clear();
        this.firstRequestCallbacks.clear();
      }
      ```

  - **d. Wire in index.ts** in `src/main/index.ts`:
    - Store unsubscribe function:
      ```typescript
      let mcpFirstRequestCleanup: Unsubscribe | null = null;
      ```
    - In `startServices()`, after MCP manager starts, register callback:
      ```typescript
      mcpFirstRequestCleanup = mcpManager.onFirstRequest((workspacePath) => {
        // setWorkspaceLoaded is idempotent (guards internally), no need to check isWorkspaceLoading
        viewManagerRef.setWorkspaceLoaded(workspacePath);
      });
      ```
    - In `cleanup()`, call unsubscribe:
      ```typescript
      if (mcpFirstRequestCleanup) {
        mcpFirstRequestCleanup();
        mcpFirstRequestCleanup = null;
      }
      ```

  - Files affected: `src/services/mcp-server/types.ts`, `src/services/mcp-server/mcp-server.ts`, `src/services/mcp-server/mcp-server-manager.ts`, `src/main/index.ts`
  - Test criteria: First MCP request for workspace triggers callback; subsequent requests don't; callback triggers setWorkspaceLoaded for loading workspaces; non-loading workspace requests are no-op

- [x] **Step 10: Remove invalid status change detection**
  - **Purpose**: Clean up code that uses status change as a signal (it doesn't work for TUI attachment)
  - In `src/main/index.ts`:
    - Remove the status change → setWorkspaceLoaded wiring added in previous implementation
    - The `onStatusChanged` callback should only update renderer status, NOT trigger loading completion
  - Files affected: `src/main/index.ts`
  - Test criteria: Status change does NOT call setWorkspaceLoaded

- [x] **Step 11: Update documentation with correct detection mechanism**
  - **Purpose**: Fix documentation that incorrectly describes status change as the detection signal
  - **Note**: Line numbers may have shifted; search for the quoted text if line numbers don't match
  - In `AGENTS.md`, find and change:
    ```
    | View Loading    | New workspaces show a loading overlay until first OpenCode client attaches (status "none" → "idle"/"busy") or 10-second timeout. Prevents VS Code flickering during progressive load. View URL loads but stays detached.       |
    ```
    To:
    ```
    | View Loading    | New workspaces show a loading overlay until first OpenCode client attaches (first MCP request received) or 10-second timeout. Prevents VS Code flickering during progressive load. View URL loads but stays detached.       |
    ```
  - In `docs/ARCHITECTURE.md`, find and change:
    ```
                               first OpenCode client attaches OR 10s timeout
    ```
    To:
    ```
                               first MCP request OR 10s timeout
    ```
  - In `docs/ARCHITECTURE.md`, find and change:
    ```
    - **Loading state**: New workspaces show a loading overlay until first OpenCode client attaches (status changes from "none" to "idle"/"busy") or 10-second timeout. The view URL is loaded but the view remains detached (not attached to contentView).
    ```
    To:
    ```
    - **Loading state**: New workspaces show a loading overlay until first MCP request is received (indicating TUI attachment) or 10-second timeout. The view URL is loaded but the view remains detached (not attached to contentView).
    ```
  - Files affected: `AGENTS.md`, `docs/ARCHITECTURE.md`
  - Test criteria: Documentation accurately describes MCP-based detection

## Testing Strategy

All integration tests must use fake timers (`vi.useFakeTimers()`) to avoid real 10-second waits. Target <50ms per test.

### Integration Tests

Test behavior through high-level entry points with behavioral mocks. **Verify outcome state, not method calls.**

| #   | Test Case                                        | Entry Point                          | Boundary Mocks | Behavior Verified                                                                  |
| --- | ------------------------------------------------ | ------------------------------------ | -------------- | ---------------------------------------------------------------------------------- |
| 1   | View stays detached for loading workspace        | `ViewManager.setActiveWorkspace()`   | none           | Create view, set active → `expect(contentView.children).not.toContain(view)`       |
| 2   | View attaches when workspace loaded              | `ViewManager.setWorkspaceLoaded()`   | none           | Set loaded → `expect(contentView.children).toContain(view)`                        |
| 3   | Timeout makes view visible after 10 seconds      | `ViewManager.createWorkspaceView()`  | fake timers    | Advance 10s → `expect(contentView.children).toContain(view)`                       |
| 4   | Loading callback fires on state change           | `ViewManager.onLoadingChange()`      | none           | Create view → callback(path, true); set loaded → callback(path, false)             |
| 5   | Destroy workspace cleans up loading state        | `ViewManager.destroyWorkspaceView()` | fake timers    | Destroy → timeout no longer fires, `isWorkspaceLoading` returns false              |
| 6   | Loading state changes propagate to renderer      | Full IPC flow                        | none           | Create view → verify store state is true; set loaded → verify store state is false |
| 7   | MCP first request fires callback                 | `McpServerManager.onFirstRequest()`  | none           | First request → callback called; second request → callback NOT called              |
| 8   | MCP request marks workspace as loaded            | `McpServerManager` + `ViewManager`   | none           | MCP first request → `expect(viewManager.isWorkspaceLoading(path)).toBe(false)`     |
| 9   | MCP request for non-loading workspace is no-op   | `McpServerManager.onFirstRequest()`  | none           | Request for unknown workspace → no errors, no state changes                        |
| 10  | MCP request before createWorkspaceView completes | Race condition                       | fake timers    | Early MCP request → workspace eventually loads correctly when view is created      |
| 11  | MCP request after timeout already fired          | Race condition                       | fake timers    | Timeout fires, then MCP request → no errors, workspace stays loaded                |
| 12  | Workspace deleted while MCP callback pending     | Race condition                       | none           | Delete workspace, then MCP request arrives → no errors, graceful handling          |

### UI Integration Tests

| #   | Test Case                                    | Category | Component               | Behavior Verified                                                                         |
| --- | -------------------------------------------- | -------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| 1   | Loading overlay shown for loading workspace  | UI-state | MainView                | `expect(screen.getByText("Loading workspace...")).toBeInTheDocument()`                    |
| 2   | Loading overlay hidden when workspace loaded | UI-state | MainView                | `expect(screen.queryByText("Loading workspace...")).not.toBeInTheDocument()`              |
| 3   | Loading overlay has ARIA attributes          | Pure-UI  | WorkspaceLoadingOverlay | `expect(container).toHaveAttribute("role", "status")`                                     |
| 4   | Loading store tracks multiple workspaces     | UI-state | workspace-loading store | `expect(isWorkspaceLoading(path1)).toBe(true)` while `isWorkspaceLoading(path2)` is false |

### Test File Naming

- `src/main/managers/view-manager.integration.test.ts` - tests 1-5
- `src/main/ipc/api-handlers.integration.test.ts` - test 6
- `src/services/mcp-server/mcp-server-manager.integration.test.ts` - tests 7-12
- `src/renderer/lib/stores/workspace-loading.test.ts` - store tests
- `src/renderer/lib/components/WorkspaceLoadingOverlay.test.ts` - component tests

### Manual Testing Checklist

- [ ] Create new workspace → loading overlay appears
- [ ] Wait for OpenCode terminal to attach → overlay disappears (~3s, via MCP), VS Code visible
- [ ] Create workspace, switch away before loaded → no overlay on other workspace
- [ ] Switch back to loading workspace → overlay appears again
- [ ] Wait 10+ seconds with broken OpenCode → overlay disappears, view shows
- [ ] Delete workspace while loading → no errors, clean transition

## Dependencies

No new dependencies required.

## Documentation Updates

### Files to Update

| File                   | Changes Required                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `AGENTS.md`            | Fix View Loading description: change "status none→idle/busy" to "first MCP request"       |
| `docs/ARCHITECTURE.md` | Fix view lifecycle diagram and Loading state description to reference MCP-based detection |

### New Documentation Required

None required - behavior is internal implementation detail.

## Definition of Done

- [x] Steps 1-8 complete (loading infrastructure, UI overlay)
- [x] Step 9 complete (MCP-based detection)
- [x] Step 10 complete (remove invalid status change detection)
- [x] Step 11 complete (documentation fixes)
- [x] `npm run validate:fix` passes
- [ ] All integration tests complete in <50ms each (verified with fake timers)
- [ ] Manual Testing Checklist passed (all items verified)
- [ ] Changes committed
