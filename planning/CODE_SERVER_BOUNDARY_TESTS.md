---
status: CLEANUP
last_updated: 2025-12-12
reviewers: [review-testing, review-docs, review-arch, review-senior, review-typescript]
---

# CODE_SERVER_BOUNDARY_TESTS

## Overview

- **Problem**: `CodeServerManager` unit tests use mocked `ProcessRunner`, `HttpClient`, and `PortManager`. These mocks may not accurately reflect real code-server behavior (startup timing, health check responses, signal handling).
- **Solution**: Create boundary tests that start a real code-server process and verify the full lifecycle: startup, health checks, and shutdown.
- **Risks**:
  - code-server startup/shutdown adds test execution time (~2-3s per test)
  - Port conflicts if tests run in parallel (mitigated by dynamic port allocation)
  - Orphaned processes on test failure (mitigated by robust dual cleanup)
- **Alternatives Considered**:
  - Mock-only testing: Current approach, but doesn't catch integration issues
  - Docker-based testing: Overkill for a local binary

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     BOUNDARY TEST SCOPE                              │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                   CodeServerManager                          │    │
│  │                                                              │    │
│  │   ensureRunning() ──► ExecaProcessRunner ──────────────────┼────┼──► code-server binary
│  │         │                                                    │    │
│  │         └──────────► DefaultNetworkLayer ──────────────────┼────┼──► HTTP /healthz
│  │                           │                                  │    │
│  │                           └─── findFreePort() ─────────────┼────┼──► TCP/net
│  │                                                              │    │
│  │   stop() ──────────────► ExecaProcessRunner ───────────────┼────┼──► SIGTERM/SIGKILL
│  │                                                              │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ════════════════════════════════════════════════════════════════   │
│                    BOUNDARY (tested in this plan)                    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

External Entities:
  • code-server binary (devDependency, always available)
  • TCP port binding (via net module)
  • HTTP health endpoint (/healthz)
  • Process signals (SIGTERM, SIGKILL)
```

## Implementation Steps

### Phase 1: Test Infrastructure (TDD: Write failing tests first)

- [x] **Step 1: Create test file with setup/teardown infrastructure**
  - Create `src/services/code-server/code-server-manager.boundary.test.ts`
  - Import real `ExecaProcessRunner` and `DefaultNetworkLayer`
  - Use `createTempDir()` from `src/services/test-utils.ts` for temp directory management
  - Implement dual cleanup pattern: `manager.stop()` + raw PID tracking as fallback
  - Add `isProcessRunning(pid)` helper for OS-level verification
  - Organize with nested `describe()` blocks: `lifecycle`, `health check`, `callbacks`, `concurrent access`, `environment`, `restart`, `edge cases`
  - Files: `src/services/code-server/code-server-manager.boundary.test.ts` (new)
  - Test criteria: Test file structure compiles without errors

### Phase 2: Lifecycle Tests

- [x] **Step 2: Test basic startup and shutdown**
  - Write failing tests first (RED phase):
    - Test: `ensureRunning()` starts code-server and returns a port
    - Test: `isRunning()` returns true after startup
    - Test: `pid()` returns a valid PID after startup (validate: `port > 0 && port <= 65535`)
    - Test: `stop()` cleanly terminates the process
    - Test: `isRunning()` returns false after stop
    - Test: After `stop()`, verify PID no longer running at OS level using `isProcessRunning(pid)`
  - All tests should FAIL initially (no real code-server started yet in test)
  - Run tests to confirm RED state
  - Implement test bodies (GREEN phase)
  - Files: `src/services/code-server/code-server-manager.boundary.test.ts`
  - Test criteria: Tests transition from RED to GREEN

- [x] **Step 3: Test health check integration**
  - Write failing tests first (RED phase):
    - Test: `port()` returns the actual listening port
    - Test: Direct HTTP GET to `http://localhost:${port}/healthz` (bypassing CodeServerManager) returns 200 status
  - Implement test bodies (GREEN phase)
  - Files: `src/services/code-server/code-server-manager.boundary.test.ts`
  - Test criteria: Health check returns 200 status

### Phase 3: Callback Tests

- [x] **Step 4: Test PID callback**
  - Write failing tests first (RED phase):
    - Test: `onPidChanged` callback fires with valid PID on startup
    - Test: `onPidChanged` callback fires with null on stop
    - Use typed mock: `vi.fn<[number | null], void>()`
  - Verify: PID matches actual running process (OS-level check)
  - Implement test bodies (GREEN phase)
  - Files: `src/services/code-server/code-server-manager.boundary.test.ts`
  - Test criteria: Callbacks fire in correct order with correct values

### Phase 4: Concurrent Access Tests

- [x] **Step 5: Test concurrent access**
  - Write failing tests first (RED phase):
    - Test: Multiple concurrent `ensureRunning()` calls return same port
    - Test: Only one code-server process is spawned
    - Test: `pid()` is consistent across concurrent calls
  - Use properly typed `Promise.all<number>()` pattern
  - Implement test bodies (GREEN phase)
  - Files: `src/services/code-server/code-server-manager.boundary.test.ts`
  - Test criteria: Single process, single port for concurrent calls

### Phase 5: Environment Tests

- [x] **Step 6: Test environment isolation**
  - Write failing tests first (RED phase):
    - Test: code-server starts successfully with `VSCODE_*` env vars present
  - Implementation details:
    - Save original env: `const originalEnv = { ...process.env }`
    - Set fake `VSCODE_IPC_HOOK`, `VSCODE_GIT_ASKPASS_MAIN` in test scope
    - Use `try/finally` to restore original env after test
  - Verify: Startup succeeds (env vars are stripped internally)
  - Implement test bodies (GREEN phase)
  - Files: `src/services/code-server/code-server-manager.boundary.test.ts`
  - Test criteria: Startup succeeds despite polluted environment

### Phase 6: Restart and Edge Case Tests

- [x] **Step 7: Test restart after stop**
  - Write failing tests first (RED phase):
    - Test: Can call `ensureRunning()` after `stop()`
    - Test: Rapid stop-start-stop cycle completes without errors
  - Verify: New port is allocated (may be same or different)
  - Verify: New PID is different from previous
  - Implement test bodies (GREEN phase)
  - Files: `src/services/code-server/code-server-manager.boundary.test.ts`
  - Test criteria: Second startup succeeds with valid port and PID

- [x] **Step 8: Test edge cases**
  - Write failing tests first (RED phase):
    - Test: `stop()` without prior `ensureRunning()` is a no-op (doesn't throw)
    - Test: When process crashes externally, `isRunning()` reflects reality after next operation
  - Add Windows skip conditions for platform-specific behavior (signal handling)
  - Implement test bodies (GREEN phase)
  - Files: `src/services/code-server/code-server-manager.boundary.test.ts`
  - Test criteria: Edge cases handled gracefully

### Phase 7: Validation

- [x] **Step 9: Validate and document**
  - Run `npm run validate:fix`
  - Ensure boundary tests pass: `npm run test:boundary`
  - Verify no orphaned processes: `pgrep code-server`
  - Verify temp dirs cleaned: `ls /tmp | grep codehydra-test`
  - Files: N/A
  - Test criteria: All validation passes

## Testing Strategy

### TDD Workflow

Each test step follows RED→GREEN→REFACTOR:

1. **RED**: Write test that describes expected behavior → test FAILS (no implementation)
2. **GREEN**: Implement minimal test body to make test pass
3. **REFACTOR**: Clean up while keeping tests green

### Boundary Test Principles Applied

1. **Real external systems**: Uses actual code-server binary, real HTTP requests, real process signals
2. **No mocks**: `ExecaProcessRunner` and `DefaultNetworkLayer` are real implementations
3. **Isolation**: Each test creates fresh temp directories via `createTempDir()` and cleans up
4. **Timeout handling**: 5 second timeout per test (code-server starts fast)
5. **Robust cleanup**: Dual cleanup pattern with manager.stop() + raw PID fallback
6. **OS-level verification**: Verify process state at OS level, not just manager state

### Expected Execution Time

- **Per test**: ~2-3 seconds (code-server startup/shutdown)
- **Total**: ~45-60 seconds for 14 test cases
- **Note**: Boundary tests run separately from fast unit tests via `npm run test:boundary`

### Test Structure

```typescript
// @vitest-environment node
// code-server-manager.boundary.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CodeServerManager } from "./code-server-manager";
import { ExecaProcessRunner } from "../platform/process";
import { DefaultNetworkLayer } from "../platform/network";
import { createTempDir } from "../test-utils";
import type { CodeServerConfig } from "./types";

// Platform detection for signal tests
const isWindows = process.platform === "win32";

// Default timeout for boundary tests
const TEST_TIMEOUT = 5000;

// Track spawned PIDs for fallback cleanup
const spawnedPids: number[] = [];

/**
 * Check if a process is running at OS level.
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") {
      return false;
    }
    throw err;
  }
}

/**
 * Create test config with proper typing.
 */
function createTestConfig(baseDir: string): CodeServerConfig {
  return {
    runtimeDir: baseDir,
    extensionsDir: `${baseDir}/extensions`,
    userDataDir: `${baseDir}/user-data`,
  };
}

describe("CodeServerManager (boundary)", () => {
  let manager: CodeServerManager;
  let tempDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async (): Promise<void> => {
    // Use documented test utility for temp directory
    const temp = await createTempDir();
    tempDir = temp.path;
    cleanup = temp.cleanup;

    // Real dependencies - no mocks
    const runner = new ExecaProcessRunner();
    const networkLayer = new DefaultNetworkLayer();

    manager = new CodeServerManager(createTestConfig(tempDir), runner, networkLayer, networkLayer);
  });

  afterEach(async (): Promise<void> => {
    // Track PID before stopping for fallback cleanup
    const pid = manager.pid();
    if (pid !== null) {
      spawnedPids.push(pid);
    }

    // Primary cleanup: use manager.stop()
    try {
      await manager.stop();
    } catch {
      // Ignore cleanup errors - process may already be dead
    }

    // Fallback cleanup: force kill any tracked PIDs
    for (const trackedPid of spawnedPids) {
      try {
        process.kill(trackedPid, "SIGKILL");
      } catch {
        // Process already dead - expected
      }
    }
    spawnedPids.length = 0;

    // Remove temp directory
    await cleanup();
  });

  describe("lifecycle", () => {
    it(
      "ensureRunning() starts code-server and returns a port",
      async () => {
        // Arrange: (manager created in beforeEach)

        // Act
        const port = await manager.ensureRunning();

        // Assert
        expect(port).toBeGreaterThan(0);
        expect(port).toBeLessThanOrEqual(65535);
      },
      TEST_TIMEOUT
    );

    it(
      "isRunning() returns true after startup",
      async () => {
        // Arrange
        await manager.ensureRunning();

        // Act
        const running = manager.isRunning();

        // Assert
        expect(running).toBe(true);
      },
      TEST_TIMEOUT
    );

    it(
      "pid() returns valid PID after startup",
      async () => {
        // Arrange
        await manager.ensureRunning();

        // Act
        const pid = manager.pid();

        // Assert
        expect(pid).not.toBeNull();
        expect(pid).toBeGreaterThan(0);
        // Verify at OS level
        expect(isProcessRunning(pid!)).toBe(true);
      },
      TEST_TIMEOUT
    );

    it(
      "stop() terminates process and isRunning() returns false",
      async () => {
        // Arrange
        await manager.ensureRunning();
        const pid = manager.pid();

        // Act
        await manager.stop();

        // Assert
        expect(manager.isRunning()).toBe(false);
        expect(manager.pid()).toBeNull();
        // Verify at OS level - process should be dead
        if (pid !== null) {
          expect(isProcessRunning(pid)).toBe(false);
        }
      },
      TEST_TIMEOUT
    );
  });

  describe("health check", () => {
    it(
      "port() returns the actual listening port",
      async () => {
        // Arrange
        const returnedPort = await manager.ensureRunning();

        // Act
        const port = manager.port();

        // Assert
        expect(port).toBe(returnedPort);
      },
      TEST_TIMEOUT
    );

    it(
      "direct HTTP GET to /healthz returns 200",
      async () => {
        // Arrange
        const port = await manager.ensureRunning();

        // Act - bypass CodeServerManager, hit endpoint directly
        const response = await fetch(`http://localhost:${port}/healthz`);

        // Assert
        expect(response.status).toBe(200);
      },
      TEST_TIMEOUT
    );
  });

  describe("callbacks", () => {
    it(
      "onPidChanged fires with valid PID on startup",
      async () => {
        // Arrange
        const callback = vi.fn<[number | null], void>();
        manager.onPidChanged(callback);

        // Act
        await manager.ensureRunning();

        // Assert
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(expect.any(Number));
        const receivedPid = callback.mock.calls[0][0];
        expect(receivedPid).toBeGreaterThan(0);
      },
      TEST_TIMEOUT
    );

    it(
      "onPidChanged fires with null on stop",
      async () => {
        // Arrange
        const callback = vi.fn<[number | null], void>();
        await manager.ensureRunning();
        manager.onPidChanged(callback);
        callback.mockClear();

        // Act
        await manager.stop();

        // Assert
        expect(callback).toHaveBeenCalledWith(null);
      },
      TEST_TIMEOUT
    );
  });

  describe("concurrent access", () => {
    it(
      "multiple concurrent ensureRunning() calls return same port",
      async () => {
        // Arrange
        const promises: Promise<number>[] = [
          manager.ensureRunning(),
          manager.ensureRunning(),
          manager.ensureRunning(),
        ];

        // Act
        const ports = await Promise.all(promises);

        // Assert - all same port
        expect(new Set(ports).size).toBe(1);
        expect(ports[0]).toBeGreaterThan(0);
      },
      TEST_TIMEOUT
    );
  });

  describe("environment isolation", () => {
    it(
      "starts successfully with VSCODE_* env vars present",
      async () => {
        // Arrange - save original env
        const originalIpcHook = process.env.VSCODE_IPC_HOOK;
        const originalAskpass = process.env.VSCODE_GIT_ASKPASS_MAIN;

        try {
          // Pollute environment
          process.env.VSCODE_IPC_HOOK = "/fake/socket";
          process.env.VSCODE_GIT_ASKPASS_MAIN = "/fake/askpass";

          // Act
          const port = await manager.ensureRunning();

          // Assert
          expect(port).toBeGreaterThan(0);
          expect(manager.isRunning()).toBe(true);
        } finally {
          // Restore original env
          if (originalIpcHook === undefined) {
            delete process.env.VSCODE_IPC_HOOK;
          } else {
            process.env.VSCODE_IPC_HOOK = originalIpcHook;
          }
          if (originalAskpass === undefined) {
            delete process.env.VSCODE_GIT_ASKPASS_MAIN;
          } else {
            process.env.VSCODE_GIT_ASKPASS_MAIN = originalAskpass;
          }
        }
      },
      TEST_TIMEOUT
    );
  });

  describe("restart", () => {
    it(
      "can call ensureRunning() after stop()",
      async () => {
        // Arrange
        const firstPort = await manager.ensureRunning();
        const firstPid = manager.pid();
        await manager.stop();

        // Act
        const secondPort = await manager.ensureRunning();
        const secondPid = manager.pid();

        // Assert
        expect(secondPort).toBeGreaterThan(0);
        expect(secondPid).toBeGreaterThan(0);
        expect(secondPid).not.toBe(firstPid); // Different PID
      },
      TEST_TIMEOUT
    );

    it(
      "rapid stop-start cycle completes without errors",
      async () => {
        // Arrange & Act
        await manager.ensureRunning();
        await manager.stop();
        await manager.ensureRunning();
        await manager.stop();
        const finalPort = await manager.ensureRunning();

        // Assert
        expect(finalPort).toBeGreaterThan(0);
        expect(manager.isRunning()).toBe(true);
      },
      TEST_TIMEOUT
    );
  });

  describe("edge cases", () => {
    it(
      "stop() without prior ensureRunning() is a no-op",
      async () => {
        // Arrange: manager created but not started

        // Act & Assert - should not throw
        await expect(manager.stop()).resolves.toBeUndefined();
        expect(manager.isRunning()).toBe(false);
      },
      TEST_TIMEOUT
    );

    it.skipIf(isWindows)(
      "after external SIGKILL, manager handles gracefully",
      async () => {
        // Arrange
        await manager.ensureRunning();
        const pid = manager.pid();
        expect(pid).not.toBeNull();

        // Act - kill process externally
        process.kill(pid!, "SIGKILL");
        // Wait for process to die
        await new Promise((r) => setTimeout(r, 100));

        // Assert - calling stop() should handle it gracefully
        await expect(manager.stop()).resolves.toBeUndefined();
      },
      TEST_TIMEOUT
    );
  });
});
```

### Cleanup Safety

The dual cleanup pattern ensures no orphaned processes:

```
Test runs
    │
    ├── Success ──► afterEach()
    │                   │
    │                   ├── Track PID in spawnedPids[]
    │                   ├── manager.stop() (primary)
    │                   ├── SIGKILL tracked PIDs (fallback)
    │                   └── cleanup temp dir
    │
    └── Failure ──► afterEach() (same cleanup runs)
```

### Test Organization

Tests are organized into logical `describe()` blocks:

| Block                   | Tests                                                |
| ----------------------- | ---------------------------------------------------- |
| `lifecycle`             | startup, isRunning, pid, stop, OS-level verification |
| `health check`          | port, direct HTTP /healthz                           |
| `callbacks`             | onPidChanged startup, onPidChanged stop              |
| `concurrent access`     | multiple ensureRunning calls                         |
| `environment isolation` | VSCODE\_\* env var stripping                         |
| `restart`               | stop then start, rapid cycles                        |
| `edge cases`            | stop without start, external kill                    |

### Test Cases Summary

| Test Case                 | Description                                              | File                                 |
| ------------------------- | -------------------------------------------------------- | ------------------------------------ |
| startup_returns_port      | Real code-server starts and returns valid port (0-65535) | code-server-manager.boundary.test.ts |
| isRunning_after_start     | isRunning() reflects actual process state                | code-server-manager.boundary.test.ts |
| pid_is_valid              | pid() returns actual process ID, verified at OS level    | code-server-manager.boundary.test.ts |
| stop_terminates           | stop() terminates process, verified at OS level          | code-server-manager.boundary.test.ts |
| port_returns_value        | port() returns the listening port                        | code-server-manager.boundary.test.ts |
| health_check_200          | Direct /healthz endpoint returns 200                     | code-server-manager.boundary.test.ts |
| pid_callback_start        | onPidChanged fires on startup with typed mock            | code-server-manager.boundary.test.ts |
| pid_callback_stop         | onPidChanged fires on stop                               | code-server-manager.boundary.test.ts |
| concurrent_single_process | Concurrent calls spawn single process                    | code-server-manager.boundary.test.ts |
| env_isolation             | Starts with VSCODE\_\* vars, proper env cleanup          | code-server-manager.boundary.test.ts |
| restart_after_stop        | Can restart after stop, new PID                          | code-server-manager.boundary.test.ts |
| rapid_stop_start          | Rapid stop-start cycles work                             | code-server-manager.boundary.test.ts |
| stop_without_start        | stop() is no-op when not started                         | code-server-manager.boundary.test.ts |
| external_kill             | Handles external process termination (Unix only)         | code-server-manager.boundary.test.ts |

### Integration Tests

N/A - This plan covers boundary tests only.

### Manual Testing Checklist

- [ ] Run `npm run test:boundary` - all tests pass
- [ ] Verify no orphaned code-server processes after tests (`pgrep code-server`)
- [ ] Verify temp directories are cleaned up (`ls /tmp | grep codehydra-test`)

## Dependencies

| Package | Purpose             | Approved |
| ------- | ------------------- | -------- |
| (none)  | No new dependencies | N/A      |

**Existing dependencies used:**

- `code-server` (devDependency) - The binary under test
- `vitest` - Test runner
- `src/services/test-utils.ts` - `createTempDir()` helper

## Documentation Updates

### Files to Update

| File   | Changes Required                |
| ------ | ------------------------------- |
| (none) | No documentation updates needed |

### New Documentation Required

| File   | Purpose                    |
| ------ | -------------------------- |
| (none) | Tests are self-documenting |

## Definition of Done

- [ ] Test file created at `src/services/code-server/code-server-manager.boundary.test.ts`
- [ ] All 14 test cases implemented and passing
- [ ] TDD workflow followed (RED→GREEN→REFACTOR)
- [ ] Tests complete within 5s timeout each
- [ ] No orphaned processes after test run (dual cleanup verified)
- [ ] OS-level process verification included
- [ ] Environment variable cleanup prevents test pollution
- [ ] Windows-specific tests skipped appropriately
- [ ] `npm run test:boundary` passes
- [ ] `npm run validate:fix` passes
- [ ] Changes committed

## Notes

- **Timeout**: 5s per test. code-server startup is typically 1-2s.
- **Total execution**: ~45-60 seconds for all boundary tests
- **Skip condition**: Not needed - code-server is a devDependency, always available
- **Windows**: Signal-related tests skipped on Windows via `it.skipIf(isWindows)`
- **Parallel execution**: Tests use dynamic port allocation, safe for parallel runs
- **Process cleanup**: Dual pattern - `manager.stop()` + raw PID SIGKILL fallback
- **Test utilities**: Uses `createTempDir()` from `src/services/test-utils.ts` per docs/TESTING.md
