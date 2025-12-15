---
status: COMPLETED
last_updated: 2025-12-15
reviewers: [review-arch, review-typescript, review-testing, review-docs]
---

# LEGACY_SETUP_REMOVAL

## Overview

- **Problem**: Two parallel sets of IPC handlers for setup flow - legacy handlers (`setup:ready`, `setup:retry`, `setup:quit`) and v2 API handlers (`lifecycle.getState()`, `lifecycle.setup()`, `lifecycle.quit()`). This creates maintenance burden and inconsistency.
- **Solution**: Remove legacy setup handlers and use only the v2 CodeHydra API. Create a standalone `LifecycleApi` class that is instantiated early in `bootstrap()` and reused by `CodeHydraApiImpl`.
- **Risks**:
  - Breaking the setup flow if handler registration timing is wrong
  - Mitigation: Careful testing of both fresh setup and already-setup scenarios, with TDD approach
- **Alternatives Considered**:
  - Keep legacy as wrapper around v2: Rejected - adds complexity, doesn't solve the core issue
  - Make `CodeHydraApiImpl.lifecycle` dead code: Rejected - creates unused code and interface compliance issues
  - Create separate early API just for lifecycle: Similar to chosen approach but less clean

## Architecture

```
BEFORE:
┌─────────────────────────────────────────────────────────────────┐
│ bootstrap()                                                      │
│ ├─ Create vscodeSetupService                                     │
│ ├─ Register legacy handlers (setup:ready, setup:retry, setup:quit)│
│ └─ Load UI                                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ startServices() [only if setup complete OR after setup finishes] │
│ ├─ Create full CodeHydraApi                                      │
│ ├─ registerApiHandlers() ← includes lifecycle handlers (TOO LATE)│
│ └─ wireApiEvents()                                               │
└─────────────────────────────────────────────────────────────────┘

AFTER:
┌─────────────────────────────────────────────────────────────────┐
│ bootstrap()                                                      │
│ ├─ Create vscodeSetupService                                     │
│ ├─ Create LifecycleApi (standalone, needs only setup + app)      │
│ ├─ Register lifecycle handlers (delegates to LifecycleApi)       │
│ ├─ Wire api:setup:progress event via webContents.send()          │
│ └─ Load UI                                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
         Key change: api:lifecycle:* handlers available immediately
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ startServices() [only if setup complete OR after setup finishes] │
│ ├─ Create CodeHydraApiImpl (receives existing LifecycleApi)      │
│ │   └─ this.lifecycle = existingLifecycleApi  ← REUSES instance  │
│ ├─ registerApiHandlers() ← EXCLUDES lifecycle (already registered)│
│ └─ wireApiEvents()                                               │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Steps

Each step follows TDD: write failing tests first (RED), implement to pass (GREEN), refactor (REFACTOR).

- [x] **Step 1: Create LifecycleApi class and lifecycle handlers**
  - **1a (RED)**: Write failing tests for `LifecycleApi` class in `src/main/api/lifecycle-api.test.ts`
  - **1b (GREEN)**: Create `LifecycleApi` class in `src/main/api/lifecycle-api.ts`
    - Implements `ILifecycleApi` interface
    - Constructor takes `vscodeSetupService`, `app`, `onSetupComplete` callback, `emitProgress` callback
    - `getState()`: Returns `"ready"` if setup complete, `"setup"` otherwise
    - `setup()`:
      1. If `setupInProgress` flag is true → return `{ success: false, message: "Setup already in progress", code: "SETUP_IN_PROGRESS" }`
      2. Set `setupInProgress = true`
      3. Call `cleanVscodeDir()` (auto-clean before setup)
      4. Run setup with progress callbacks → calls `emitProgress()` for each step
      5. On success: call `onSetupComplete()` callback, return `{ success: true }`
      6. On error: return `{ success: false, message, code }`
      7. Finally: set `setupInProgress = false`
    - `quit()`: Calls `app.quit()`
  - **1c (RED)**: Write failing tests for `registerLifecycleHandlers()` in `src/main/ipc/lifecycle-handlers.test.ts`
  - **1d (GREEN)**: Create `registerLifecycleHandlers()` in `src/main/ipc/lifecycle-handlers.ts`
    - Takes `lifecycleApi: ILifecycleApi` instance
    - Registers `api:lifecycle:get-state`, `api:lifecycle:setup`, `api:lifecycle:quit`
    - Each handler delegates to corresponding `lifecycleApi` method
    - **ALSO removes lifecycle handlers from `registerApiHandlers()`** (prevents duplicate registration)
  - **1e (REFACTOR)**: Clean up, add JSDoc documenting timing requirements
  - Files affected: `src/main/api/lifecycle-api.ts` (new), `src/main/api/lifecycle-api.test.ts` (new), `src/main/ipc/lifecycle-handlers.ts` (new), `src/main/ipc/lifecycle-handlers.test.ts` (new), `src/main/ipc/api-handlers.ts` (remove lifecycle), `src/main/ipc/index.ts`
  - Test criteria: Unit tests pass, `setupInProgress` guard tested, `cleanVscodeDir` called before setup

- [x] **Step 2: Update bootstrap() to use LifecycleApi and new handlers**
  - **2a (RED)**: Write/update integration tests in `src/main/index.test.ts` for new bootstrap flow
    - Test: lifecycle handlers available before startServices completes
    - Test: renderer can call `lifecycle.getState()` immediately after bootstrap
  - **2b (GREEN)**: Update `bootstrap()` in `src/main/index.ts`
    - Create `LifecycleApi` instance after `vscodeSetupService`
    - Call `registerLifecycleHandlers(lifecycleApi)`
    - Progress events emitted via `webContents.send(ApiIpcChannels.SETUP_PROGRESS, ...)` directly
    - Pass `startServices` as the `onSetupComplete` callback
    - Store `lifecycleApi` in module-level variable for `startServices()` to access
    - Remove: `registerSetupReadyHandler()`, `registerSetupRetryAndQuitHandlers()`, `runSetupProcess()`, `createSetupEmitters()`, legacy emit functions
  - **2c (REFACTOR)**: Clean up removed code
  - Files affected: `src/main/index.ts`, `src/main/index.test.ts`
  - Test criteria: Integration tests pass, no duplicate handler registration

- [x] **Step 3: Update CodeHydraApiImpl to reuse LifecycleApi**
  - **3a (RED)**: Update tests in `src/main/api/codehydra-api.test.ts` to pass `LifecycleApi` instance
  - **3b (GREEN)**: Update `CodeHydraApiImpl` constructor
    - Accept optional `lifecycleApi?: ILifecycleApi` parameter
    - If provided: `this.lifecycle = lifecycleApi` (reuse existing instance)
    - If not provided: create internal instance (for backward compat in tests)
    - Remove internal `createLifecycleApi()` method
  - **3c (REFACTOR)**: Clean up
  - Files affected: `src/main/api/codehydra-api.ts`, `src/main/api/codehydra-api.test.ts`
  - Test criteria: Tests pass, `CodeHydraApiImpl.lifecycle` delegates to shared instance

- [x] **Step 4: Update preload to use v2 API for setup**
  - **4a (RED)**: Update `src/preload/index.test.ts` for new API shape
  - **4b (GREEN)**: Update `src/preload/index.ts`
    - Remove legacy setup methods: `setupReady`, `setupRetry`, `setupQuit`
    - Remove legacy event subscriptions: `onSetupProgress`, `onSetupComplete`, `onSetupError`
    - Setup progress events are consumed via existing `api.on("setup:progress", handler)` pattern
    - No new setup-specific event methods needed
  - **4c**: Update `src/shared/electron-api.d.ts` with proper return types:
    ```typescript
    lifecycle: {
      getState: () => Promise<AppState>; // "ready" | "setup"
      setup: () => Promise<SetupResult>; // { success: true } | { success: false, message, code }
      quit: () => Promise<void>;
    }
    ```
  - Files affected: `src/preload/index.ts`, `src/preload/index.test.ts`, `src/shared/electron-api.d.ts`
  - Test criteria: TypeScript compilation, preload tests pass

- [x] **Step 5: Update renderer to use v2 API**
  - **5a (RED)**: Update `src/renderer/App.test.ts` for v2 API usage
    - Replace `setupReady`/`setupRetry`/`setupQuit` mocks with `lifecycle.getState`/`setup`/`quit`
    - Test Promise-based setup completion handling
  - **5b (GREEN)**: Update `src/renderer/App.svelte`
    - Replace `setupReady()` with `lifecycle.getState()`:
      - Old: `const { ready } = await api.setupReady()` → `if (ready)`
      - New: `const state = await api.lifecycle.getState()` → `if (state === "ready")`
    - Replace `setupRetry()` with `lifecycle.setup()`:
      - Old: Called `setupRetry()`, listened for `onSetupComplete`/`onSetupError` events
      - New: `const result = await api.lifecycle.setup()` → check `result.success`
    - Replace `setupQuit()` with `lifecycle.quit()`
    - Replace event subscriptions:
      - Old: `api.onSetupProgress()`, `api.onSetupComplete()`, `api.onSetupError()`
      - New: `api.on("setup:progress", handler)` for progress, Promise result for completion/error
    - On setup failure, SetupError component calls `lifecycle.setup()` again for retry
  - **5c**: Update `src/renderer/lib/api/index.ts`
    - Remove legacy setup exports: `setupReady`, `setupRetry`, `setupQuit`, `onSetupProgress`, `onSetupComplete`, `onSetupError`
  - **5d (REFACTOR)**: Clean up
  - Files affected: `src/renderer/App.svelte`, `src/renderer/App.test.ts`, `src/renderer/lib/api/index.ts`
  - Test criteria: App.svelte tests pass, manual testing of setup flow

- [x] **Step 6: Remove legacy setup code**
  - Remove `src/main/ipc/setup-handlers.ts` (entire file)
  - Remove `src/main/ipc/setup-handlers.test.ts` (entire file)
  - Remove legacy IPC channels from `src/shared/ipc.ts`:
    - `IpcChannels.SETUP_READY`, `SETUP_RETRY`, `SETUP_QUIT`, `SETUP_PROGRESS`, `SETUP_COMPLETE`, `SETUP_ERROR`
  - Remove legacy types from `src/shared/ipc.ts`: `SetupReadyResponse`
  - Update `src/main/ipc/index.ts` exports (remove setup-handlers exports)
  - Files affected: `src/main/ipc/setup-handlers.ts`, `src/main/ipc/setup-handlers.test.ts`, `src/shared/ipc.ts`, `src/main/ipc/index.ts`
  - Test criteria: TypeScript compilation, no unused exports

- [x] **Step 7: Update documentation**
  - Update `AGENTS.md`:
    - **App/MainView Split Pattern**: Replace `setupReady()` with `lifecycle.getState()`, `setupRetry()` with `lifecycle.setup()`, `setupQuit()` with `lifecycle.quit()`. Update event subscriptions from `onSetupProgress/Complete/Error` to `on("setup:progress")` + Promise handling.
    - **Main Process Startup Architecture**: Add note that lifecycle handlers (`api:lifecycle:*`) are registered in `bootstrap()` before UI loads via `LifecycleApi`, while normal API handlers are registered in `startServices()`. `CodeHydraApiImpl` reuses the same `LifecycleApi` instance. Update timing diagram.
  - Update `docs/ARCHITECTURE.md`:
    - **Renderer Startup Flow** section: Update to show v2 API usage (`lifecycle.getState()`, `lifecycle.setup()`, `on("setup:progress")` event subscription)
  - Files affected: `AGENTS.md`, `docs/ARCHITECTURE.md`
  - Test criteria: Documentation reflects new flow accurately

## Testing Strategy

### Unit Tests (vitest)

| Test Case             | Description                                         | File                                    |
| --------------------- | --------------------------------------------------- | --------------------------------------- |
| LifecycleApi getState | Returns "ready" when setup complete                 | src/main/api/lifecycle-api.test.ts      |
| LifecycleApi getState | Returns "setup" when setup incomplete               | src/main/api/lifecycle-api.test.ts      |
| LifecycleApi setup    | Cleans vscode dir before running setup (auto-clean) | src/main/api/lifecycle-api.test.ts      |
| LifecycleApi setup    | Emits progress events during setup                  | src/main/api/lifecycle-api.test.ts      |
| LifecycleApi setup    | Calls onSetupComplete callback on success           | src/main/api/lifecycle-api.test.ts      |
| LifecycleApi setup    | Returns failure result on error                     | src/main/api/lifecycle-api.test.ts      |
| LifecycleApi setup    | Guards against concurrent setup calls               | src/main/api/lifecycle-api.test.ts      |
| LifecycleApi setup    | Returns success immediately if already complete     | src/main/api/lifecycle-api.test.ts      |
| LifecycleApi setup    | Handles error in onSetupComplete callback           | src/main/api/lifecycle-api.test.ts      |
| LifecycleApi quit     | Calls app.quit()                                    | src/main/api/lifecycle-api.test.ts      |
| lifecycle-handlers    | Delegates getState to LifecycleApi                  | src/main/ipc/lifecycle-handlers.test.ts |
| lifecycle-handlers    | Delegates setup to LifecycleApi                     | src/main/ipc/lifecycle-handlers.test.ts |
| lifecycle-handlers    | Delegates quit to LifecycleApi                      | src/main/ipc/lifecycle-handlers.test.ts |
| App.svelte            | Shows setup screen when state is "setup"            | src/renderer/App.test.ts                |
| App.svelte            | Shows main view when state is "ready"               | src/renderer/App.test.ts                |
| App.svelte            | Handles setup progress events via on()              | src/renderer/App.test.ts                |
| App.svelte            | Handles setup success via Promise result            | src/renderer/App.test.ts                |
| App.svelte            | Handles setup error and retry via lifecycle.setup() | src/renderer/App.test.ts                |

### Integration Tests

| Test Case               | Description                                                                | File                   |
| ----------------------- | -------------------------------------------------------------------------- | ---------------------- |
| Bootstrap fresh setup   | Lifecycle handlers available, setup flow works                             | src/main/index.test.ts |
| Bootstrap already setup | startServices called immediately                                           | src/main/index.test.ts |
| Pre-startServices call  | Renderer can call lifecycle.getState() before startServices completes      | src/main/index.test.ts |
| No duplicate handlers   | Lifecycle handlers registered only once (not again in registerApiHandlers) | src/main/index.test.ts |
| Progress event emission | api:setup:progress events emitted to renderer during setup                 | src/main/index.test.ts |
| Complete bootstrap flow | bootstrap → setup → startServices end-to-end                               | src/main/index.test.ts |

### Manual Testing Checklist

- [ ] Fresh install: App shows setup screen, progress updates, completes successfully
- [ ] Fresh install with error: Error screen shows, retry works via lifecycle.setup()
- [ ] Already setup: App goes directly to main view
- [ ] Quit from setup error screen works via lifecycle.quit()
- [ ] Setup progress messages appear correctly via on("setup:progress")
- [ ] Concurrent setup calls are blocked (click retry rapidly)

## Dependencies

No new dependencies required.

## Documentation Updates

### Files to Update

| File                 | Changes Required                                                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AGENTS.md            | Update "App/MainView Split Pattern": replace legacy setup methods with v2 lifecycle API. Update "Main Process Startup Architecture": document LifecycleApi created in bootstrap, reused by CodeHydraApiImpl |
| docs/ARCHITECTURE.md | Update "Renderer Startup Flow" section: show v2 API usage with lifecycle.getState(), lifecycle.setup(), on("setup:progress")                                                                                |

### New Documentation Required

None.

## Definition of Done

- [x] All implementation steps complete (TDD approach followed)
- [x] `npm run validate:fix` passes
- [x] Documentation updated (AGENTS.md, docs/ARCHITECTURE.md)
- [x] User acceptance testing passed
- [x] Changes committed
