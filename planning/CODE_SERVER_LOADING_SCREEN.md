---
status: COMPLETED
last_updated: 2024-12-31
reviewers: [review-arch, review-testing, review-docs]
---

# CODE_SERVER_LOADING_SCREEN

## Overview

- **Problem**: After setup completes (or when no setup is needed), the app shows a white/empty screen while code-server starts (up to 10 seconds). Services currently start from two different code paths.
- **Solution**: Add a "loading" lifecycle state that shows the loading screen while services start. Consolidate service startup into a single explicit call.
- **Risks**:
  - Breaking existing setup flow - mitigated by preserving setup() behavior, only removing service start from it
  - Race conditions if startServices() called multiple times - mitigated by idempotent guard
- **Alternatives Considered**:
  - Event-based approach (emit "services:ready") - rejected because Promise-based is simpler for error handling
  - Auto-start when getState() returns "loading" - rejected because side effects in getters are confusing
- **Timing Change**: This deliberately moves service startup to AFTER UI loads so the UI can display a loading screen. The current code pre-starts services before UI loads to minimize perceived delay - the new approach shows a loading screen during service start. This is intentional UX improvement.

## Architecture

### State Machine

Both paths converge to the "loading" state before reaching "ready":

```
Path A (setup needed):
  getState() → "setup" → setup() → success → appMode="loading" → startServices() → "ready"

Path B (no setup needed):
  getState() → "loading" → startServices() → "ready"
```

**Key invariant**: The renderer ALWAYS goes through "loading" before "ready". Services ONLY start when the renderer calls `startServices()`.

### Flow Diagrams

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CURRENT FLOW                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  bootstrap()                                                             │
│      │                                                                   │
│      ├── preflight()                                                     │
│      │                                                                   │
│      ├── if (setupComplete) ──► startServices() ◄── BLOCKS              │
│      │                                                                   │
│      └── Load UI                                                         │
│              │                                                           │
│              ▼                                                           │
│      Renderer: getState() ──► "ready" or "setup"                         │
│              │                                                           │
│              ├── "ready" ──► MainView (WHITE SCREEN if services slow)    │
│              │                                                           │
│              └── "setup" ──► setup() ──► onSetupComplete()               │
│                                               │                          │
│                                               └──► startServices() ◄─────│
│                                                                          │
│  PROBLEM: Services start from TWO places, UI can't show loading screen  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                            NEW FLOW                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  bootstrap()                                                             │
│      │                                                                   │
│      ├── preflight()                                                     │
│      │                                                                   │
│      └── Load UI (services NOT started)                                  │
│              │                                                           │
│              ▼                                                           │
│      Renderer: getState() ──► "loading" or "setup"                       │
│              │                                                           │
│              ├── "setup" ──► SetupScreen ──► setup()                     │
│              │                                   │                       │
│              │                                   ▼                       │
│              │                              returns success              │
│              │                              (NO service start)           │
│              │                                   │                       │
│              │                                   ▼                       │
│              │                         Renderer: appMode = "loading"     │
│              │                                   │                       │
│              └── "loading" ◄─────────────────────┘                       │
│                      │                                                   │
│                      ▼                                                   │
│              SetupScreen ("Starting services...")                        │
│                      │                                                   │
│                      ▼                                                   │
│              result = await startServices()  ◄── SINGLE ENTRY POINT     │
│                      │                                                   │
│                      ├── success ──► appMode = "ready" ──► MainView      │
│                      │                                                   │
│                      └── failure ──► SetupError (Retry/Quit)             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Implementation Steps

- [x] **Step 1: Add "loading" to AppState type**
  - File: `src/shared/api/types.ts`
  - Change: `export type AppState = "setup" | "ready";` → `export type AppState = "setup" | "loading" | "ready";`
  - Test criteria: TypeScript compiles

- [x] **Step 2: Add LIFECYCLE_START_SERVICES IPC channel**
  - File: `src/shared/ipc.ts`
  - Add: `LIFECYCLE_START_SERVICES: "api:lifecycle:start-services"` to ApiIpcChannels
  - Test criteria: TypeScript compiles

- [x] **Step 3: Add startServices() to ILifecycleApi interface**
  - File: `src/shared/api/interfaces.ts`
  - Add with JSDoc:
    ```typescript
    /**
     * Start application services (code-server, OpenCode, etc.).
     *
     * Idempotent - second call returns success without side effects.
     * Called by renderer after getState() returns "loading" or after setup() succeeds.
     *
     * @returns Success result, or failure with error message
     */
    startServices(): Promise<SetupResult>;
    ```
  - Test criteria: TypeScript compiles

- [x] **Step 4: Update LifecycleModule dependencies**
  - File: `src/main/modules/lifecycle/index.ts`
  - Remove: `onSetupComplete` from LifecycleModuleDeps
  - Add: `doStartServices: () => Promise<void>` to LifecycleModuleDeps
  - Add: `private servicesStarted = false;` field
  - Test criteria: TypeScript compiles (will have errors until Step 5)

- [x] **Step 5: Implement startServices() in LifecycleModule**
  - File: `src/main/modules/lifecycle/index.ts`
  - Register new method: `lifecycle.startServices`
  - Implementation:
    ```typescript
    private async startServices(): Promise<SetupResult> {
      if (this.servicesStarted) {
        return { success: true }; // Idempotent
      }
      this.servicesStarted = true;
      try {
        await this.deps.doStartServices();
        return { success: true };
      } catch (error) {
        return { success: false, message: getErrorMessage(error), code: "SERVICE_START_ERROR" };
      }
    }
    ```
  - Note: Service startup can take 10+ seconds. The renderer shows a static "Starting services..." message. Consider adding progress feedback in a future iteration if this feels slow to users.
  - Test criteria: Method registered with IPC channel

- [x] **Step 6: Modify getState() to return "loading" instead of "ready"**
  - File: `src/main/modules/lifecycle/index.ts`
  - Change: getState() logic should be:
    - If no vscodeSetup service exists → return `"loading"` (dev mode, skip setup)
    - If preflight fails → return `"setup"` (need to run setup)
    - If preflight succeeds AND setup needed → return `"setup"`
    - If preflight succeeds AND no setup needed → return `"loading"`
  - Key: getState() should NEVER return `"ready"` before startServices() is called
  - Test criteria: getState() returns "loading" when no setup needed, "setup" when setup needed

- [x] **Step 7: Modify setup() to NOT start services**
  - File: `src/main/modules/lifecycle/index.ts`
  - Remove: All calls to `this.deps.onSetupComplete()`
  - Keep: Setup logic (preflight, vscodeSetup.setup())
  - Change: Return `{ success: true }` after setup completes without starting services
  - Test criteria: setup() returns without starting services

- [x] **Step 8: Update main index.ts to use new LifecycleModule deps**
  - File: `src/main/index.ts`
  - Change `onSetupComplete` to `doStartServices` in lifecycleDeps
  - `doStartServices` should be the existing `startServices` function
  - Remove: `if (setupComplete) { await startServices(); }` block in bootstrap()
  - **Intent**: This deliberately delays service startup until after UI loads so the loading screen can be displayed. This is a UX improvement, not just a refactor.
  - Test criteria: Services only start when renderer calls lifecycle.startServices()

- [x] **Step 8.5: Verify no service startup in bootstrap()**
  - File: `src/main/index.ts`
  - Verify: bootstrap() contains NO service startup logic (no startServices calls)
  - Verify: Services only start when LifecycleModule.startServices() is called via IPC from renderer
  - Test criteria: Code review confirms clean separation

- [x] **Step 9: Add startServices to preload**
  - File: `src/preload/index.ts`
  - Add: `startServices` method to lifecycle object that invokes IPC channel
  - Test criteria: Method available on window.api.lifecycle

- [x] **Step 10: Update renderer API re-exports**
  - File: `src/renderer/lib/api/index.ts`
  - Update doc comment to mention startServices():
    ```typescript
    /**
     * Renderer API layer.
     * Re-exports window.api for mockability in tests.
     *
     * Setup operations use lifecycle API:
     * - lifecycle.getState() returns "setup" | "loading"
     * - lifecycle.setup() runs setup and returns success/failure (does NOT start services)
     * - lifecycle.startServices() starts services and returns success/failure
     * - lifecycle.quit() quits the app
     */
    ```
  - Test criteria: lifecycle.startServices() accessible from renderer

- [x] **Step 11: Add message prop to SetupScreen**
  - File: `src/renderer/lib/components/SetupScreen.svelte`
  - Add: `message` prop (default: "Setting up CodeHydra")
  - Add: `subtitle` prop (default: "This is only required on first startup.")
  - Note: These defaults are for the setup flow. The loading flow in App.svelte will override with message="Starting services..." and subtitle=""
  - Use props in template
  - Test criteria: Component renders with both default and overridden messages

- [x] **Step 12: Update App.svelte for "loading" state**
  - File: `src/renderer/App.svelte`
  - Add `"loading"` to AppMode type
  - Handle `"loading"` state from getState()
  - When in "loading" state:
    1. Show SetupScreen with message="Starting services..." and subtitle=""
    2. Call `await api.lifecycle.startServices()`
    3. On success: transition to "ready"
    4. On failure: show SetupError component with:
       - Error message from result.message
       - Retry button calls `await api.lifecycle.startServices()` again
       - Quit button calls `api.lifecycle.quit()`
  - When setup() succeeds: transition to "loading" (not "ready")
  - Test criteria: Loading screen shown during service startup; error screen shows Retry and Quit buttons

- [x] **Step 13: Update LifecycleModule tests**
  - File: `src/main/modules/lifecycle/index.test.ts`
  - Update tests for new deps interface (doStartServices instead of onSetupComplete)
  - Add tests for startServices() method (see Testing Strategy)
  - Update getState() tests to expect "loading" instead of "ready"
  - Update setup() tests to verify it returns success without changing app state
  - Add test: "After setup completes, getState still returns loading (not ready)"
  - Test criteria: All tests pass

- [x] **Step 14: Update App.svelte tests**
  - File: `src/renderer/App.test.ts`
  - Add tests for "loading" state handling
  - Test error handling in startServices()
  - Test setup→loading→ready transition flow
  - Test criteria: All tests pass

- [x] **Step 15: Run validate:fix**
  - Command: `npm run validate:fix`
  - Test criteria: All checks pass

## Testing Strategy

**Performance expectation**: Integration tests should target <50ms per test. The idempotent test should verify second call returns in <10ms.

### Integration Tests

Tests verify behavioral outcomes (return values, state changes) not implementation details (method calls).

| #   | Test Case                                                | Entry Point                       | Behavioral Mock State                                              | Behavior Verified                                                                       |
| --- | -------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| 1   | getState returns loading when no setup needed            | `LifecycleModule.getState()`      | vscodeSetup.preflight returns success, needsSetup=false            | Returns "loading" not "ready"                                                           |
| 2   | getState returns setup when setup needed                 | `LifecycleModule.getState()`      | vscodeSetup.preflight returns success, needsSetup=true             | Returns "setup"                                                                         |
| 3   | startServices succeeds and enables app functionality     | `LifecycleModule.startServices()` | doStartServices resolves successfully                              | Returns `{ success: true }`                                                             |
| 4   | startServices returns success immediately on second call | `LifecycleModule.startServices()` | doStartServices with 100ms delay                                   | First call takes ~100ms, second call returns in <10ms, both return success              |
| 5   | startServices returns failure with error message         | `LifecycleModule.startServices()` | doStartServices throws Error("Connection failed")                  | Returns `{ success: false, message: "Connection failed", code: "SERVICE_START_ERROR" }` |
| 6   | setup completes without transitioning to ready state     | `LifecycleModule.setup()`         | vscodeSetup.setup succeeds                                         | Returns success; subsequent getState() still returns "loading"                          |
| 7   | App shows loading screen for loading state               | `App.svelte`                      | api.lifecycle.getState returns "loading"                           | SetupScreen rendered with message="Starting services..."                                |
| 8   | App transitions to ready after startServices succeeds    | `App.svelte`                      | api.lifecycle.startServices returns success                        | MainView rendered                                                                       |
| 9   | App shows error with Retry/Quit on startServices failure | `App.svelte`                      | api.lifecycle.startServices returns failure                        | SetupError rendered with Retry and Quit buttons                                         |
| 10  | After setup completes, getState returns loading          | `LifecycleModule`                 | vscodeSetup.setup succeeds                                         | getState() returns "loading" not "ready" after setup                                    |
| 11  | Setup success transitions through loading to ready       | `App.svelte`                      | api.lifecycle.setup returns success, startServices returns success | setup() → appMode="loading" → startServices() → appMode="ready"                         |

### Manual Testing Checklist

- [ ] Fresh install: shows SetupScreen → "Starting services..." → MainView
- [ ] Second launch: shows "Starting services..." → MainView (no setup screen)
- [ ] Kill code-server during startup: error dialog appears with Retry and Quit buttons
- [ ] Quick startup: loading screen visible briefly, then MainView
- [ ] Test on Windows specifically (service startup times may vary)

## Dependencies

No new dependencies required.

## Documentation Updates

### Files to Update

| File                            | Changes Required                                                                                                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/ARCHITECTURE.md`          | Update "Main Process Startup Architecture" section to show new three-state flow: setup/loading/ready. Update diagram to show `startServices()` is called by renderer (not in bootstrap). Document that services NEVER start in bootstrap anymore. |
| `docs/API.md`                   | Add `startServices()` method to lifecycle API table in Private API section. Update `AppState` type definition to include "loading" state.                                                                                                         |
| `src/renderer/lib/api/index.ts` | Update doc comment for lifecycle API (covered in Step 10)                                                                                                                                                                                         |

### New Documentation Required

None required.

## Definition of Done

- [ ] All implementation steps complete
- [ ] `npm run validate:fix` passes
- [ ] Documentation updated
- [ ] User acceptance testing passed
- [ ] CI passed
- [ ] Merged to main
