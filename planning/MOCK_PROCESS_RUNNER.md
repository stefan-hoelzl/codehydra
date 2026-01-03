---
status: COMPLETED
last_updated: 2026-01-03
reviewers: []
---

# MOCK_PROCESS_RUNNER

## Overview

- **Problem**: The current `createMockProcessRunner()` uses simple `vi.fn()` mocks without behavioral state tracking, making tests rely on vitest internals (`.mock.calls`) and lacking domain-specific assertions.
- **Solution**: Migrate to the behavioral mock `mock.$` pattern with state tracking and custom matchers.
- **Risks**: Many test files use the current mock; migration must be incremental.
- **Alternatives Considered**:
  - Keep current pattern: Rejected because it doesn't follow the behavioral mock pattern established in `BEHAVIOR_DRIVEN_TESTING.md`
  - Complex async simulation (streaming output, real timeouts): Rejected because tests don't need this - processes complete immediately with configured results

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      MockProcessRunner                          │
│  implements ProcessRunner & MockWithState<ProcessRunnerState>   │
├─────────────────────────────────────────────────────────────────┤
│  run(command, args, options) → MockSpawnedProcess               │
│  $: ProcessRunnerMockState                                      │
│    ├─ spawned(index) → MockSpawnedProcess                       │
│    ├─ spawned({command}) → MockSpawnedProcess                   │
│    ├─ snapshot() → Snapshot                                     │
│    └─ toString() → string                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ returns
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     MockSpawnedProcess                          │
│  implements SpawnedProcess & MockWithState<SpawnedProcessState> │
├─────────────────────────────────────────────────────────────────┤
│  pid: number | undefined                                        │
│  wait(timeout?) → Promise<ProcessResult>                        │
│  kill(termTimeout?, killTimeout?) → Promise<KillResult>         │
│  $: SpawnedProcessMockState                                     │
│    ├─ readonly command: string                                  │
│    ├─ readonly args: readonly string[]                          │
│    ├─ readonly cwd: string | undefined                          │
│    ├─ readonly env: NodeJS.ProcessEnv | undefined               │
│    ├─ readonly killCalls: ReadonlyArray<{termTimeout, killTimeout}> │
│    ├─ snapshot() → Snapshot                                     │
│    └─ toString() → string                                       │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Steps

> **Note**: This implementation follows the State Mock Pattern documented in `docs/TESTING.md` (State Mock Pattern section).

- [x] **Step 1: Create state interfaces and types**
  - Create `src/services/platform/process.state-mock.ts`
  - Define `SpawnRecord` interface with optional properties for partial matching:
    ```typescript
    interface SpawnRecord {
      readonly command?: string;
      readonly args?: readonly string[];
      readonly cwd?: string;
      readonly env?: NodeJS.ProcessEnv;
    }
    ```
  - Define `SpawnedProcessMockState` interface extending `MockState`:
    ```typescript
    interface SpawnedProcessMockState extends MockState {
      readonly command: string;
      readonly args: readonly string[];
      readonly cwd: string | undefined;
      readonly env: NodeJS.ProcessEnv | undefined;
      readonly killCalls: ReadonlyArray<{ termTimeout?: number; killTimeout?: number }>;
    }
    ```
  - Define `ProcessRunnerMockState` interface extending `MockState`:
    ```typescript
    interface ProcessRunnerMockState extends MockState {
      spawned(index: number): MockSpawnedProcess;
      spawned(filter: { command: string }): MockSpawnedProcess;
    }
    ```
  - Define `MockSpawnedProcess` interface (exported) extending `SpawnedProcess` and `MockWithState<SpawnedProcessMockState>`
  - Define `MockProcessRunner` interface (exported) extending `ProcessRunner` and `MockWithState<ProcessRunnerMockState>`
  - Implementation classes (`MockSpawnedProcessImpl`, `MockProcessRunnerImpl`) are private (not exported)
  - Test criteria: Types compile, interfaces match existing patterns

- [x] **Step 2: Implement MockSpawnedProcess**
  - Create `MockSpawnedProcessImpl` class (private)
  - Implement `pid` property (configurable, undefined for spawn failure)
  - Implement `wait()` - returns configured result immediately
  - Implement `kill()` - tracks call in state, returns configured result
  - Implement `$` state accessor with `killCalls` tracking (all properties readonly)
  - Implement `snapshot()` and `toString()` for state
  - Test criteria: Can create mock, call wait/kill, inspect state

- [x] **Step 3: Implement MockProcessRunner**
  - Create `ProcessRunnerMockStateImpl` class (private)
  - Implement `spawned(index)` method - returns MockSpawnedProcess by index
    - Throws descriptive error if index out of bounds: `"No spawned process at index N. Only M processes were spawned."`
  - Implement `spawned({command})` method - returns MockSpawnedProcess by command match
    - Throws descriptive error if no match: `"No spawned process with command 'X'. Spawned commands: A, B, C"`
  - Create `MockProcessRunnerImpl` class (private)
  - Implement `run()` - creates MockSpawnedProcess, stores in state, returns it
  - Implement `$` state accessor
  - Implement `snapshot()` and `toString()` for state
  - Test criteria: Can spawn multiple processes, retrieve by index/command

- [x] **Step 4: Create factory function**
  - Implement `createMockProcessRunner(options?)` factory
  - Support `defaultResult` option for default exit code/stdout/stderr
  - Support `onSpawn` callback for per-spawn customization
    - When `onSpawn` returns `void` or `undefined`, the `defaultResult` is used
  - Handle spawn failure simulation (pid = undefined)
  - Test criteria: Factory creates working mock with all options

- [x] **Step 5: Implement custom matchers**
  - Implement `toHaveSpawned(expected: SpawnRecord[])` matcher on MockProcessRunner
  - Support partial matching (missing fields not checked)
  - Support `expect.arrayContaining()` for args
  - Implement `toHaveBeenKilled()` matcher on MockSpawnedProcess
  - Implement `toHaveBeenKilledWith(termTimeout, killTimeout)` matcher
  - Matcher error messages must include actual state via `toString()`:
    ```typescript
    message: () => `Expected: ${JSON.stringify(expected)}\nActual: ${received.$.toString()}`;
    ```
  - Register matchers in `src/test/setup-matchers.ts`:
    - Import `{ processRunnerMatchers }` from the state-mock file
    - Call `expect.extend({ ...processRunnerMatchers })`
  - Test criteria: Matchers produce correct pass/fail with good error messages

- [x] **Step 6: Migrate existing tests (code-server-manager)**
  - Update `code-server-manager.test.ts` to use new mock
  - Update `code-server-manager.integration.test.ts` to use new mock
  - Replace `vi.fn()` assertions with custom matchers
  - Test criteria:
    - All tests pass with new mock
    - Tests verify behavior outcomes (server started, process killed) not implementation details
    - Tests use custom matchers (`toHaveSpawned`, `toHaveBeenKilled`) not state inspection
    - No direct access to `$.killCalls` or vitest-specific `.toHaveBeenCalled()`

- [x] **Step 7: Migrate existing tests (opencode-server-manager)**
  - Update `opencode-server-manager.test.ts` to use new mock
  - Update `opencode-server-manager.integration.test.ts` to use new mock
  - Test criteria:
    - All tests pass with new mock
    - Tests verify behavior outcomes not implementation details
    - Tests use custom matchers not state inspection

- [x] **Step 8: Migrate existing tests (vscode-setup-service)**
  - Update `vscode-setup-service.test.ts` to use new mock
  - Update `vscode-setup-service.integration.test.ts` to use new mock
  - Remove local `createMockSpawnedProcess` definitions
  - Test criteria:
    - All tests pass with new mock
    - Tests verify behavior outcomes not implementation details
    - Tests use custom matchers not state inspection

- [x] **Step 9: Migrate existing tests (workspace-lock-handler)**
  - Update `workspace-lock-handler.test.ts` to use new mock
  - Remove local `createMockProcessRunner` definition
  - Test criteria:
    - All tests pass with new mock
    - Tests verify behavior outcomes not implementation details
    - Tests use custom matchers not state inspection

- [x] **Step 10: Deprecate old mock utilities**
  - Add deprecation comments to `process.test-utils.ts` for `createMockProcessRunner()` and `createMockSpawnedProcess()`
  - Update any remaining usages
  - Test criteria: No usages of old mock remain

## Testing Strategy

### Manual Testing Checklist

- [x] Run `pnpm test` - all tests pass (491 integration + 2715 legacy)
- [ ] Run `pnpm validate:fix` - pre-existing svelte-check errors (unrelated to this feature)

## Dependencies

None - uses only existing project infrastructure.

## Documentation Updates

### Files to Update

| File                                          | Changes Required                                                                                                                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/TESTING.md`                             | Add ProcessRunner mock example to State Mock Pattern section (after FileSystem example, around line 470). Include factory usage and custom matcher examples (`toHaveSpawned`, `toHaveBeenKilled`). |
| `src/services/platform/process.test-utils.ts` | Add `@deprecated` JSDoc comments to `createMockProcessRunner()` and `createMockSpawnedProcess()` functions                                                                                         |

### New Documentation Required

None - mock follows established patterns documented in `docs/TESTING.md`.

## Definition of Done

- [x] All implementation steps complete
- [ ] `pnpm validate:fix` passes (blocked by pre-existing svelte-check errors)
- [x] Documentation updated
- [ ] User acceptance testing passed
- [ ] CI passed
- [ ] Merged to main

## API Reference

### Factory Function

```typescript
function createMockProcessRunner(options?: {
  /**
   * Default result for all spawned processes.
   * Can be overridden per-spawn via onSpawn.
   */
  defaultResult?: {
    exitCode?: number; // default: 0
    stdout?: string; // default: ""
    stderr?: string; // default: ""
  };

  /**
   * Called when run() is invoked. Return overrides for this spawn.
   * When this returns void or undefined, defaultResult is used.
   */
  onSpawn?: (
    command: string,
    args: readonly string[],
    cwd?: string,
    env?: NodeJS.ProcessEnv
  ) => {
    pid?: number; // undefined = spawn failure
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    signal?: string;
    killResult?: KillResult;
  } | void;
}): MockProcessRunner;
```

### Custom Matchers

```typescript
// On MockProcessRunner - verify spawned processes
expect(runner).toHaveSpawned([
  { command: "opencode", args: ["serve"], cwd: "/workspace" },
  { command: "taskkill", args: expect.arrayContaining(["/pid"]) },
]);

// On MockSpawnedProcess - verify kill was called
expect(runner.$.spawned(0)).toHaveBeenKilled();
expect(runner.$.spawned({ command: "opencode" })).toHaveBeenKilledWith(1000, 1000);
```

### State Access

```typescript
// Get spawned process by index (throws if out of bounds)
const proc = runner.$.spawned(0);

// Get spawned process by command (throws if not found)
const proc = runner.$.spawned({ command: "opencode" });

// Snapshot for unchanged assertions
const snapshot = runner.$.snapshot();
// ... do something ...
expect(runner).toBeUnchanged(snapshot);
```

### Usage Examples

```typescript
// Simple usage - all processes succeed
const runner = createMockProcessRunner();
const manager = new CodeServerManager(runner, ...);
await manager.ensureRunning();

expect(runner).toHaveSpawned([
  { command: "/path/to/code-server", args: expect.arrayContaining(["--port"]) },
]);

// Custom exit codes
const runner = createMockProcessRunner({
  defaultResult: { exitCode: 1, stderr: "error" },
});

// Per-spawn customization
const runner = createMockProcessRunner({
  onSpawn: (command) => {
    if (command.includes("code-server")) {
      return { exitCode: 0, stdout: "started" };
    }
    return { exitCode: 1, stderr: "not found" };
  },
});

// Spawn failure (ENOENT)
const runner = createMockProcessRunner({
  onSpawn: () => ({ pid: undefined, stderr: "spawn ENOENT" }),
});

// Verify kill behavior
await manager.stop();
expect(runner.$.spawned(0)).toHaveBeenKilledWith(1000, 1000);
```

### Anti-Patterns to Avoid

```typescript
// ❌ WRONG - inspects internal state directly
expect(runner.$.spawned(0).$.killCalls.length).toBe(1);

// ✅ CORRECT - uses custom matcher
expect(runner.$.spawned(0)).toHaveBeenKilled();

// ❌ WRONG - checks implementation details via state
const proc = runner.$.spawned({ command: "code-server" });
expect(proc.$.command).toBe("code-server");

// ✅ CORRECT - verifies behavior outcome
expect(runner).toHaveSpawned([{ command: "code-server" }]);

// ❌ WRONG - uses vitest internals
expect(mockProcess.kill).toHaveBeenCalled();

// ✅ CORRECT - uses domain-specific matcher
expect(runner.$.spawned(0)).toHaveBeenKilled();
```
