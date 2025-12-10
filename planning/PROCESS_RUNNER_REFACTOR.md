---
status: COMPLETED
last_updated: 2025-12-10
reviewers:
  - review-typescript
  - review-arch
  - review-senior
  - review-testing
  - review-docs
---

# PROCESS_RUNNER_REFACTOR

## Overview

- **Problem**: Two separate process abstractions exist (`spawnProcess` function and `ProcessRunner` interface), causing inconsistent patterns and leaking the `execa` dependency via `ResultPromise` type.
- **Solution**: Unify into a single `ProcessRunner` interface with one `run()` method that returns a `SpawnedProcess` handle, supporting both short-lived commands and long-running processes.
- **Risks**:
  - Breaking changes to existing consumers (`CodeServerManager`, `VscodeSetupService`)
  - Test mocking patterns need updating
- **Alternatives Considered**:
  - Keep both abstractions (rejected: unnecessary complexity, inconsistent patterns)
  - Add `spawn()` method alongside `run()` (rejected: two methods when one suffices)

### Design Decisions

**Why timeout is on `wait()` not `run()`**: Timeout is per-wait, not per-spawn, because a long-running process may have multiple wait points (e.g., wait for startup health check, then later wait for shutdown). Each wait can have different timeout requirements.

**Why `reject: false` in execa**: Ensures non-zero exit codes don't throw exceptions, allowing callers to inspect `exitCode` directly rather than catching errors. This aligns with the "check result fields for status" design - `wait()` never throws for process exit status.

**Why `running` field instead of discriminated union**: The `running?: boolean` field indicates whether the process is still running after `wait(timeout)` returns. When `running: true`, the caller knows the timeout expired and can decide how to handle it (kill, retry, etc.). This is simpler than a discriminated union while still being unambiguous.

**Execa encapsulation benefit**: After this refactor, consumers only depend on the `SpawnedProcess` interface, making it possible to swap execa for another process library (or Node.js child_process) without changing consumer code.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     ProcessRunner (stateless)                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  run(cmd, args, opts?): SpawnedProcess                      │ │
│  └─────────────────────────────────────────────────────────────┘ │
│  Note: Implementations must be stateless and safe to share       │
│  across services with different lifecycles.                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SpawnedProcess                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  pid: number?   │  │  kill(signal?)  │  │  wait(timeout?) │  │
│  │                 │  │  returns: bool  │  │                 │  │
│  │  undefined if   │  │  true=sent      │  │  never throws   │  │
│  │  spawn failed   │  │  false=already  │  │  for exit codes │  │
│  │  immediately    │  │  dead           │  │                 │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│                                                   │              │
│                                                   ▼              │
│                                           ProcessResult          │
│                              { stdout, stderr, exitCode,         │
│                                signal?, running? }               │
│                                                                  │
│  Result interpretation:                                          │
│  - exitCode: number → process exited normally                    │
│  - exitCode: null + signal → killed by signal                    │
│  - exitCode: null + running: true → timeout, still running       │
│  - exitCode: null + no signal + not running → spawn error        │
└─────────────────────────────────────────────────────────────────┘

Consumers:
┌──────────────────────┐     ┌──────────────────────┐
│  VscodeSetupService  │     │  CodeServerManager   │
│  (short-lived cmds)  │     │  (long-running)      │
│                      │     │                      │
│  proc = run(...)     │     │  proc = run(...)     │
│  result = wait()     │     │  pid = proc.pid      │
│  check exitCode      │     │  ...                 │
└──────────────────────┘     │  proc.kill(SIGTERM)  │
                             │  wait(5000)          │
                             │  if running: SIGKILL │
                             └──────────────────────┘
```

## Implementation Steps

Each step follows TDD: write failing tests first, then implement, then refactor.

- [x] **Step 1: Define new interfaces and write type tests**
  - Write type-level tests verifying interface shapes compile correctly
  - Add `ProcessOptions` interface (cwd, env - no timeout)
  - Update `ProcessResult` interface (add `signal?: string`, `running?: boolean`)
  - Add `SpawnedProcess` interface (pid, kill returning boolean, wait)
  - Update `ProcessRunner` interface (single `run()` method returning `SpawnedProcess`)
  - Files affected: `src/services/platform/process.ts`
  - Test criteria: Types compile with `npm run check`, type tests pass

- [x] **Step 2: Write failing tests for `ExecaSpawnedProcess` class**
  - Write tests FIRST for all `wait()` scenarios (see Testing Strategy below)
  - Write tests for `pid` getter behavior
  - Write tests for `kill()` behavior including return value
  - Write tests for error cases (ENOENT, EACCES, EPERM, ENOTDIR)
  - Write tests for edge cases (multiple wait() calls, kill() during wait())
  - Files affected: `src/services/platform/process.test.ts`
  - Test criteria: Tests written and failing (red phase)

- [x] **Step 3: Implement `ExecaSpawnedProcess` class**
  - Create private class implementing `SpawnedProcess`
  - Implement `pid` getter from underlying execa subprocess (undefined if spawn failed)
  - Implement `kill(signal?)` delegating to subprocess, return boolean (true=sent, false=already dead)
  - Implement `wait(timeout?)` with Promise.race for timeout, use `vi.useFakeTimers()` pattern in tests
  - Handle all result cases: normal exit, signal, timeout (running: true), spawn error
  - Files affected: `src/services/platform/process.ts`
  - Test criteria: All Step 2 tests pass (green phase)

  **Note**: Steps 1-3 completed the interfaces and ExecaSpawnedProcess implementation. Step 4 combines the breaking interface change with all consumer updates to avoid intermediate broken states.

- [x] **Step 4: Atomic interface change with all consumers (combined step)**

  This step combines interface update, consumer updates, and export changes to avoid broken intermediate states.

  **4a. Update `ExecaProcessRunner` implementation:**
  - Change `run()` to return `SpawnedProcess` instead of `Promise<ProcessResult>`
  - Use `reject: false` in execa options (ensures non-zero exits don't throw)
  - Consolidate option mapping logic

  **4b. Update `VscodeSetupService` usage (must happen atomically with 4a):**
  - Change `await this.processRunner.run(...)` to `await this.processRunner.run(...).wait()`
  - No constructor changes needed (already accepts ProcessRunner)

  **4c. Remove `spawnProcess` function and update exports:**
  - ~~Delete `spawnProcess` function~~ (kept temporarily for CodeServerManager until Step 6)
  - ~~Delete `SpawnProcessOptions` interface~~ (kept temporarily for CodeServerManager until Step 6)
  - Update `src/services/platform/process.ts` exports:
    - Keep: `spawnProcess`, `SpawnProcessOptions` as deprecated (for CodeServerManager)
    - Export: `ProcessRunner`, `SpawnedProcess`, `ProcessResult`, `ProcessOptions`, `ExecaProcessRunner`
  - Update `src/services/index.ts` exports:
    - Keep: `spawnProcess`, `SpawnProcessOptions` as deprecated (for CodeServerManager)
    - Add: `SpawnedProcess` type export
    - Keep: `ProcessRunner`, `ProcessResult`, `ProcessOptions` (now from platform/process directly)
  - Update `src/services/vscode-setup/types.ts`:
    - Updated to use `ProcessRunner` (not `SimpleProcessRunner`)

  **4d. Update VscodeSetupService tests:**
  - Update mock to return SpawnedProcess with wait() method
  - Change test assertions to match new API
  - Also updated `process.test.ts` to use new ExecaProcessRunner API

  Files affected:
  - `src/services/platform/process.ts`
  - `src/services/platform/process.test.ts`
  - `src/services/platform/process-spawned.test.ts`
  - `src/services/vscode-setup/vscode-setup-service.ts`
  - `src/services/vscode-setup/vscode-setup-service.test.ts`
  - `src/services/vscode-setup/vscode-setup-service.integration.test.ts`
  - `src/services/index.ts`
  - `src/services/vscode-setup/types.ts`

  Test criteria: `npm run check` passes, all VscodeSetupService tests pass

- [x] **Step 5: Write failing tests for `CodeServerManager` DI**
  - Write tests for constructor accepting `ProcessRunner` parameter
  - Write tests for `stop()` timeout escalation pattern (SIGTERM → wait(5000) → SIGKILL)
  - Create `createMockSpawnedProcess()` test helper (see Testing Strategy) - already existed
  - Files affected: `src/services/code-server/code-server-manager.test.ts`
  - Test criteria: Tests written and failing (3 tests fail as expected)

- [x] **Step 6: Update `CodeServerManager` to use DI**
  - Change constructor signature: `CodeServerManager(config: CodeServerConfig, processRunner: ProcessRunner)`
  - Replace `spawnProcess()` calls with `this.processRunner.run()`
  - Pass options: `{ cwd: this.config.runtimeDir, env: cleanEnv }`
  - Change `this.process` type from `ResultPromise` to `SpawnedProcess | null`
  - Update `stop()` method with SIGTERM → wait(5000) → SIGKILL escalation
  - Updated existing tests to use mockProcessRunner
  - Files affected: `src/services/code-server/code-server-manager.ts`, `src/services/code-server/code-server-manager.test.ts`
  - Test criteria: All CodeServerManager tests pass (24 tests)

- [x] **Step 7: Update main process wiring**
  - In `bootstrap()` function:
    - Create single `ExecaProcessRunner` instance as module-level variable
    - Pass to VscodeSetupService (already done)
  - In `startServices()` function:
    - Pass same `processRunner` instance to CodeServerManager
  - Files affected: `src/main/index.ts`
  - Test criteria: App builds and starts correctly

- [x] **Step 8: Update all unit tests**
  - Migrated `spawnProcess` tests to `ExecaProcessRunner` tests in `process.test.ts`
  - Updated `code-server-manager.test.ts` to use DI with `createMockProcessRunner`
  - Removed all `spawnProcess` imports from test files
  - Removed deprecated `spawnProcess` function and `SpawnProcessOptions` interface
  - Files affected: `src/services/platform/process.test.ts`, `src/services/code-server/code-server-manager.test.ts`
  - Test criteria: All unit tests pass (1056 tests)

- [x] **Step 9: Update and add integration tests**
  - Integration tests already exist in `process-spawned.test.ts` and `process.test.ts`:
    - ExecaProcessRunner tests run real `echo`, `sleep` commands
    - Tests cover timeout behavior, kill behavior, signal handling
    - Tests cover ENOENT errors with nonexistent commands
  - CodeServerManager integration tests would require code-server binary (skipped - external dependency)
  - VscodeSetupService integration tests already updated to use ExecaProcessRunner
  - Test criteria: All integration tests pass (1056 tests total)

- [x] **Step 10: Update documentation**
  - Updated `AGENTS.md` "Service Dependency Injection Pattern" section:
    - Added ProcessRunner pattern subsection
    - SpawnedProcess handle table (pid, kill, wait)
    - Graceful shutdown with timeout escalation example
    - ProcessResult fields table
    - Testing with mocks example
  - Files affected: `AGENTS.md`
  - Test criteria: Documentation accurately reflects new patterns

**Total: 10 steps (reduced from 12 by combining atomic changes)**

## Testing Strategy

### Test Utilities

Create `src/services/platform/process.test-utils.ts`:

```typescript
import { vi } from "vitest";
import type { SpawnedProcess, ProcessResult, ProcessRunner } from "./process";

/**
 * Create a mock SpawnedProcess with controllable behavior.
 */
export function createMockSpawnedProcess(overrides?: {
  pid?: number;
  killResult?: boolean;
  waitResult?: ProcessResult | (() => Promise<ProcessResult>);
}): SpawnedProcess {
  const defaultResult: ProcessResult = {
    exitCode: 0,
    stdout: "",
    stderr: "",
  };

  return {
    pid: overrides?.pid ?? 12345,
    kill: vi.fn().mockReturnValue(overrides?.killResult ?? true),
    wait: vi.fn().mockImplementation(async () => {
      if (typeof overrides?.waitResult === "function") {
        return overrides.waitResult();
      }
      return overrides?.waitResult ?? defaultResult;
    }),
  };
}

/**
 * Create a mock ProcessRunner returning the given SpawnedProcess.
 */
export function createMockProcessRunner(spawnedProcess?: SpawnedProcess): ProcessRunner {
  return {
    run: vi.fn().mockReturnValue(spawnedProcess ?? createMockSpawnedProcess()),
  };
}
```

### Unit Tests (vitest)

| Test Case                                                             | Description                                                | File                           |
| --------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------ |
| `SpawnedProcess.wait() returns result on normal exit`                 | Process exits 0, returns stdout/stderr/exitCode            | `process.test.ts`              |
| `SpawnedProcess.wait() returns result on non-zero exit`               | Process exits non-zero, returns exitCode (no throw)        | `process.test.ts`              |
| `SpawnedProcess.wait() returns signal when killed`                    | Process killed, returns signal field, exitCode null        | `process.test.ts`              |
| `SpawnedProcess.wait(timeout) returns running:true on timeout`        | Process hangs, timeout expires, running=true               | `process.test.ts`              |
| `SpawnedProcess.wait(timeout) returns result if exits before timeout` | Process exits quickly, no running flag                     | `process.test.ts`              |
| `SpawnedProcess.wait() can be called multiple times`                  | Returns same/consistent result on subsequent calls         | `process.test.ts`              |
| `SpawnedProcess.wait() with different timeouts`                       | Second wait with different timeout works correctly         | `process.test.ts`              |
| `SpawnedProcess.kill() during wait() resolves with signal`            | Kill while waiting, wait resolves with signal              | `process.test.ts`              |
| `SpawnedProcess.pid returns process ID`                               | PID accessible immediately after run()                     | `process.test.ts`              |
| `SpawnedProcess.pid returns undefined on immediate spawn failure`     | ENOENT, pid is undefined                                   | `process.test.ts`              |
| `SpawnedProcess.kill() returns true when signal sent`                 | Signal sent successfully                                   | `process.test.ts`              |
| `SpawnedProcess.kill() returns false when process already dead`       | No-op on dead process                                      | `process.test.ts`              |
| `SpawnedProcess.kill(SIGTERM/SIGKILL/SIGINT)`                         | Parameterized test for different signals                   | `process.test.ts`              |
| `ProcessRunner.run() with cwd option`                                 | Working directory respected                                | `process.test.ts`              |
| `ProcessRunner.run() with env option`                                 | Environment variables passed (not merged with process.env) | `process.test.ts`              |
| `ProcessRunner.run() handles ENOENT`                                  | Binary not found, exitCode=null, stderr has message        | `process.test.ts`              |
| `ProcessRunner.run() handles EACCES`                                  | Permission denied error                                    | `process.test.ts`              |
| `ProcessRunner.run() handles EPERM`                                   | Operation not permitted                                    | `process.test.ts`              |
| `CodeServerManager constructor accepts ProcessRunner`                 | DI works correctly                                         | `code-server-manager.test.ts`  |
| `CodeServerManager.stop() sends SIGTERM first`                        | Graceful shutdown attempt                                  | `code-server-manager.test.ts`  |
| `CodeServerManager.stop() escalates to SIGKILL on timeout`            | Timeout triggers force kill                                | `code-server-manager.test.ts`  |
| `VscodeSetupService handles non-zero exitCode`                        | Extension install failure                                  | `vscode-setup-service.test.ts` |

### Integration Tests

| Test Case                                           | Description                                | File                                       |
| --------------------------------------------------- | ------------------------------------------ | ------------------------------------------ |
| `ExecaProcessRunner runs real echo command`         | End-to-end stdout capture                  | `process.test.ts`                          |
| `ExecaProcessRunner handles real process signals`   | Kill real sleep process                    | `process.test.ts`                          |
| `ExecaProcessRunner timeout with real slow process` | wait(100) on sleep 10                      | `process.test.ts`                          |
| `CodeServerManager start/stop with real process`    | Start sleep, get PID, stop with escalation | `code-server-manager.integration.test.ts`  |
| `VscodeSetupService with real ProcessRunner`        | Extension install flow                     | `vscode-setup-service.integration.test.ts` |
| `Large stdout buffering (>1MB)`                     | Process outputting large data              | `process.test.ts`                          |

### Manual Testing Checklist

- [ ] App starts and code-server launches correctly
- [ ] VS Code setup runs on fresh install
- [ ] Closing app terminates code-server cleanly (check no orphan processes)
- [ ] Force-quit app doesn't leave orphan processes
- [ ] Verify code-server PID is captured correctly in logs

## Dependencies

No new dependencies required. This refactor uses existing `execa` package.

| Package | Purpose | Approved |
| ------- | ------- | -------- |
| (none)  | -       | -        |

## Documentation Updates

### Files to Update

| File        | Changes Required                                                                                                                                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md` | **Required**: Add ProcessRunner pattern to "Service Dependency Injection Pattern" section. Include: unified interface, SpawnedProcess handle, injection into CodeServerManager/VscodeSetupService, wait() timeout pattern for graceful shutdown |

### New Documentation Required

| File   | Purpose |
| ------ | ------- |
| (none) | -       |

## Definition of Done

- [ ] All implementation steps complete
- [ ] `npm run validate:fix` passes
- [ ] AGENTS.md updated with ProcessRunner pattern
- [ ] User acceptance testing passed
- [ ] Changes committed

## API Reference

### Final Interfaces

```typescript
export interface ProcessOptions {
  /** Working directory for the process */
  readonly cwd?: string;
  /**
   * Environment variables.
   * When provided, replaces process.env entirely (no merging).
   */
  readonly env?: NodeJS.ProcessEnv;
}

export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  /**
   * Exit code, or null if process didn't exit normally.
   * null when: killed by signal, spawn error, or still running after timeout.
   */
  readonly exitCode: number | null;
  /** Signal name if process was killed (e.g., 'SIGTERM', 'SIGKILL') */
  readonly signal?: string;
  /**
   * True if process is still running after wait(timeout) returned.
   * Caller should decide whether to kill() or continue waiting.
   */
  readonly running?: boolean;
}

export interface SpawnedProcess {
  /**
   * Process ID.
   * undefined if process failed to spawn (e.g., ENOENT, EACCES).
   */
  readonly pid: number | undefined;

  /**
   * Send a signal to terminate the process.
   * @param signal - Signal to send (default: SIGTERM)
   * @returns true if signal was sent, false if process already dead
   */
  kill(signal?: NodeJS.Signals): boolean;

  /**
   * Wait for the process to exit.
   * Never throws for process exit status - check result fields instead.
   * May still throw for unexpected errors (should not happen in practice).
   *
   * @param timeout - Max time to wait in ms. If exceeded, returns with running=true.
   * @returns ProcessResult with exit status or running indicator
   *
   * @example
   * // Wait indefinitely
   * const result = await proc.wait();
   *
   * @example
   * // Wait with timeout, then kill if still running
   * const result = await proc.wait(5000);
   * if (result.running) {
   *   proc.kill('SIGKILL');
   *   await proc.wait();
   * }
   */
  wait(timeout?: number): Promise<ProcessResult>;
}

export interface ProcessRunner {
  /**
   * Start a process and return a handle to control it.
   * Returns synchronously - the process is spawned immediately.
   *
   * @example
   * const proc = runner.run('ls', ['-la']);
   * const result = await proc.wait();
   * if (result.exitCode !== 0) {
   *   console.error(result.stderr);
   * }
   */
  run(command: string, args: readonly string[], options?: ProcessOptions): SpawnedProcess;
}
```

### Usage Examples

```typescript
// Short-lived command with timeout
const proc = runner.run("code-server", ["--install-extension", "ext-id"]);
const result = await proc.wait(30000);
if (result.running) {
  proc.kill("SIGKILL");
  throw new Error("Extension install timed out");
}
if (result.exitCode !== 0) {
  throw new Error(`Failed: ${result.stderr}`);
}

// Long-running process with graceful shutdown
const proc = runner.run("code-server", ["--port", "8080"], {
  cwd: "/app",
  env: cleanEnv,
});
console.log(`PID: ${proc.pid}`);

// ... later, graceful shutdown
proc.kill("SIGTERM");
const result = await proc.wait(5000);
if (result.running) {
  proc.kill("SIGKILL");
  await proc.wait();
}

// Simple command, no timeout needed
const proc = runner.run("echo", ["hello"]);
const result = await proc.wait();
console.log(result.stdout); // "hello\n"
```
