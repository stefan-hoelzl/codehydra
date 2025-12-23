---
status: COMPLETED
last_updated: 2025-12-23
reviewers: [review-arch, review-typescript, review-testing, review-docs]
---

# SINGLE_OPENCODE_SERVER

## Overview

- **Problem**: Each time a user runs `opencode` in a workspace terminal, a new OpenCode server spawns. With multiple workspaces, this leads to many redundant server processes consuming resources (memory, MCP server cold boot times, etc.).

- **Solution**: CodeHydra manages one `opencode serve` instance per workspace. When users (or the VS Code extension) invoke `opencode`, a wrapper script redirects to `opencode attach` connecting to the managed server. Since we manage the servers, we know the ports directly - no discovery/scanning needed.

- **Risks**:
  - Wrapper script complexity for cross-platform support
  - Graceful handling when server isn't ready yet (mitigated by health check before writing ports file)
  - VS Code extension expects to control the port (we ignore `--port` arg, extension may timeout polling its requested port)

- **Alternatives Considered**:
  - **Per-project server**: Rejected because OpenCode server operates in a single directory; different worktrees need different server instances
  - **Global server with directory header**: OpenCode's TUI doesn't wire `--dir` to SDK's `x-opencode-directory` header (infrastructure exists but not connected)
  - **Environment variable for port**: Rejected because there's one code-server for all workspaces, so env var would be the same for all
  - **Keep DiscoveryService**: Rejected because we manage servers ourselves and know ports directly - no scanning needed

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CodeHydra Main Process                          │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    OpenCodeServerManager                         │   │
│  │                    implements IDisposable                        │   │
│  │                                                                   │   │
│  │  servers: Map<workspacePath, { port, process, startPromise }>   │   │
│  │                                                                   │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │   │
│  │  │ Workspace A  │  │ Workspace B  │  │ Workspace C  │           │   │
│  │  │ port: 14001  │  │ port: 14002  │  │ port: 14003  │           │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘           │   │
│  │                                                                   │   │
│  │  Writes: <app-data>/opencode/ports.json                          │   │
│  │  Format: { "workspaces": { "/path": { "port": 14001 } } }       │   │
│  │                                                                   │   │
│  │  onServerStarted(callback) ─────────────────────────────────────┼───┐
│  │  onServerStopped(callback) ─────────────────────────────────────┼───┤
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                    │   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                         AppState                                 │◄──┘
│  │                    (Lifecycle Coordinator)                       │
│  │                                                                   │
│  │  Owns both OpenCodeServerManager and AgentStatusManager          │
│  │  Routes callbacks to prevent circular dependencies:              │
│  │                                                                   │
│  │  serverManager.onServerStarted((path, port) =>                   │
│  │      agentStatusManager.initWorkspace(path, port))               │
│  │  serverManager.onServerStopped((path) =>                         │
│  │      agentStatusManager.removeWorkspace(path))                   │
│  │                                                                   │
│  │  Lifecycle Hooks:                                                │
│  │  ├─ addWorkspace() ─────────► startServer(workspacePath)        │
│  │  ├─ removeWorkspace() ──────► stopServer(workspacePath) [KILL]  │
│  │  └─ closeProject() ─────────► stopAllForProject(path) [KILL]    │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    AgentStatusManager                            │   │
│  │                                                                   │   │
│  │  Receives port directly from AppState (via callback routing)    │   │
│  │  No dependency on OpenCodeServerManager (no circular deps)      │   │
│  │                                                                   │   │
│  │  initWorkspace(path, port) ──► Creates OpenCodeClient            │   │
│  │  removeWorkspace(path) ──────► Disposes OpenCodeClient           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  REMOVED: DiscoveryService, InstanceProbe (no longer needed)           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

File System:
┌─────────────────────────────────────────────────────────────────────────┐
│  <app-data>/                                                            │
│  ├── bin/                                                               │
│  │   ├── opencode          # Wrapper script (Unix)                     │
│  │   └── opencode.cmd      # Wrapper script (Windows)                  │
│  └── opencode/                                                          │
│      ├── 1.0.163/          # OpenCode binary (version directory)       │
│      │   └── opencode                                                   │
│      └── ports.json        # Central ports file (JSON format)          │
└─────────────────────────────────────────────────────────────────────────┘

Wrapper Script Flow:
┌─────────────────────────────────────────────────────────────────────────┐
│  User runs: opencode                                                    │
│  VS Code extension runs: opencode --port 54321                         │
│                              │                                          │
│                              ▼                                          │
│  Wrapper reads: ../opencode/ports.json (relative path)                 │
│                              │                                          │
│                              ▼                                          │
│  Finds git root: git rev-parse --show-toplevel                         │
│                              │                                          │
│                              ▼                                          │
│  Parses JSON, looks up port by git root path                           │
│                              │                                          │
│              ┌───────────────┴───────────────┐                          │
│              ▼                               ▼                          │
│         Port found                      Port not found                  │
│              │                               │                          │
│              ▼                               ▼                          │
│  opencode attach http://127.0.0.1:$PORT     opencode "$@"              │
│  (NO args passed - attach doesn't          (standalone mode)            │
│   accept same args as standalone)                                       │
│                                                                         │
│  If attach fails immediately (exit != 0 within 2s):                    │
│  Fall back to standalone mode                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

## Type Definitions

```typescript
// Callback types for OpenCodeServerManager
type ServerStartedCallback = (workspacePath: string, port: number) => void;
type ServerStoppedCallback = (workspacePath: string) => void;

// Ports file JSON structure
interface PortsFile {
  workspaces: Record<string, { port: number }>;
}

// Server entry in the manager's internal map
interface ServerEntry {
  port: number;
  process: SpawnedProcess;
  startPromise: Promise<number> | null; // Track pending starts
}
```

## Implementation Steps

- [x] **Step 1: Write failing tests for OpenCodeServerManager**

- Create test file: `src/services/opencode/opencode-server-manager.test.ts`
- Write failing tests for:
  - `startServer allocates port and spawns process`
  - `startServer writes to ports.json after health check passes`
  - `startServer fires onServerStarted callback with path and port`
  - `startServer throws when port allocation fails`
  - `startServer throws when opencode binary not found (ENOENT)`
  - `startServer cleans up on spawn failure`
  - `startServer cleans up on health check timeout`
  - `stopServer kills process gracefully (SIGTERM then SIGKILL)`
  - `stopServer removes entry from ports.json`
  - `stopServer fires onServerStopped callback`
  - `stopServer awaits pending startServer before killing`
  - `stopServer handles already-dead processes gracefully`
  - `stopAllForProject kills all workspace servers for project`
  - `concurrent starts get unique ports`
  - `getPort returns correct port for workspace`
  - `dispose stops all servers`
- Use mock factories: `createMockProcessRunner()`, `createMockPortManager()`, `createMockFileSystemLayer()`
- Files: `opencode-server-manager.test.ts`
- Test criteria: All tests fail (red phase)

- [x] **Step 2: Implement OpenCodeServerManager service**

- New service: `src/services/opencode/opencode-server-manager.ts`
- Implements `IDisposable` interface
- Constructor dependencies (injected):
  - `ProcessRunner` - for spawning `opencode serve`
  - `PortManager` - for `findFreePort()`
  - `FileSystemLayer` - for ports.json read/write
  - `HttpClient` - for health check probe
  - `PathProvider` - for resolving `appDataDir`
  - `Logger` - for structured logging
- Methods:
  - `startServer(workspacePath): Promise<number>` - allocates port, spawns process, waits for health check, writes ports.json, fires callback
  - `stopServer(workspacePath): Promise<void>` - awaits pending start, kills process (SIGTERM→5s→SIGKILL), removes from ports.json, fires callback
  - `stopAllForProject(projectPath): Promise<void>` - stops all servers whose path starts with projectPath
  - `getPort(workspacePath): number | undefined` - lookup port
  - `onServerStarted(callback: ServerStartedCallback): Unsubscribe`
  - `onServerStopped(callback: ServerStoppedCallback): Unsubscribe`
  - `dispose(): Promise<void>` - stops all servers
- Internal state:
  - `servers: Map<string, ServerEntry>` - tracks running servers and pending starts
- Health check: probe `http://127.0.0.1:${port}/app` with timeout (use `HttpClient`)
- Ports file location: `PathProvider.appDataDir + '/opencode/ports.json'`
- Logging: use logger with name `opencode-server`, log start/stop events with timing
- Files: `opencode-server-manager.ts`
- Test criteria: All unit tests pass (green phase)

- [x] **Step 3: Implement ports.json file management**

- JSON format for robustness (handles special characters in paths):
  ```json
  {
    "workspaces": {
      "/home/user/project/.worktrees/feature-a": { "port": 14001 },
      "/home/user/project/.worktrees/feature-b": { "port": 14002 }
    }
  }
  ```
- Read: parse JSON, return empty object if file missing or corrupted
- Write: atomic write (write to `.ports.json.tmp`, rename to `ports.json`)
- Create parent directory if needed: `FileSystemLayer.mkdir()`
- Handle concurrent access: serialize writes within the manager
- Files: included in `opencode-server-manager.ts`
- Test criteria: File correctly updated on start/stop, handles missing/corrupted file

- [x] **Step 4: Implement graceful server shutdown**

- On `stopServer()`:
  1. Check for pending `startPromise`, await if exists
  2. Send SIGTERM via `process.kill('SIGTERM')` (ProcessRunner handles cross-platform)
  3. Wait up to 5 seconds for exit via `process.wait(5000)`
  4. If `result.running`, send SIGKILL via `process.kill('SIGKILL')`
  5. Await final termination
  6. Remove entry from ports.json
  7. Fire `onServerStopped` callback
- Files: `opencode-server-manager.ts`
- Test criteria: Servers are properly terminated on all platforms

- [x] **Step 5: Add stale entry cleanup on startup**

- New method: `cleanupStaleEntries(): Promise<void>`
- Called during service initialization (before any workspace starts)
- Read ports.json
- For each entry:
  - Probe `http://127.0.0.1:${port}/app` with short timeout (1s)
  - If probe fails, remove entry from ports.json
- Log cleanup actions: `[opencode-server] Cleaned stale entry path=/path port=14001`
- Files: `opencode-server-manager.ts`
- Test criteria: Stale entries are removed, valid entries preserved

- [x] **Step 6: Add boundary tests for OpenCodeServerManager**

- Create test file: `src/services/opencode/opencode-server-manager.boundary.test.ts`
- Tests (use real `opencode serve` process):
  - `opencode serve starts and listens on allocated port`
  - `health check to /app succeeds after startup`
  - `graceful shutdown terminates process`
  - `ports.json persists across test runs`
  - `cleanup removes entries for dead processes`
- Use `CI_TIMEOUT_MS` from `network.test-utils.ts` for health check waits
- Skip on CI if opencode binary not available
- Files: `opencode-server-manager.boundary.test.ts`
- Test criteria: Real process lifecycle works

- [x] **Step 7: Update wrapper script generation**

- Update `src/services/vscode-setup/bin-scripts.ts`:
  - Generate wrapper that uses `../opencode/<version>/opencode` (versioned path extracted from binary path)
  - Parse `../opencode/ports.json` (JSON format)
  - Use `git rev-parse --show-toplevel` to find workspace root
  - If port found: `exec opencode attach http://127.0.0.1:$PORT` with NO additional args
    - Attach command doesn't accept same args as standalone mode
    - User's args (including VS Code extension's `--port`) are intentionally ignored
  - If attach fails immediately (non-zero exit within 2 seconds): fall back to standalone
  - If port not found or not in git repo: `exec opencode "$@"` (standalone mode, pass all args)
- Note: Uses versioned path directly instead of symlink (symlinks don't work reliably on Windows without admin privileges)
- Files: `bin-scripts.ts`, `bin-scripts.test.ts`
- Test criteria: Generated scripts handle managed/standalone modes with versioned paths

- [x] **Step 8: Write failing tests for updated AgentStatusManager**

- Update test file: `src/services/opencode/agent-status-manager.test.ts`
- Change `initWorkspace(path)` → `initWorkspace(path, port)` in tests
- Add tests:
  - `initWorkspace creates OpenCodeClient with provided port`
  - `initWorkspace handles invalid port gracefully`
  - `removeWorkspace disposes OpenCodeClient`
- Remove tests that reference DiscoveryService
- Files: `agent-status-manager.test.ts`
- Test criteria: Tests fail due to signature mismatch (red phase)

- [x] **Step 9: Simplify AgentStatusManager**

- Update `src/services/opencode/agent-status-manager.ts`:
  - Remove `DiscoveryService` from constructor dependencies
  - Change signature: `initWorkspace(path: string, port: number): Promise<void>`
  - Create `OpenCodeClient` directly with provided port
  - `removeWorkspace(path)` disposes OpenCodeClient as before
- **Note**: This is an intentional breaking change to the interface
- Files: `agent-status-manager.ts`
- Test criteria: All tests pass (green phase)

- [x] **Step 10: Remove DiscoveryService and InstanceProbe**

- Delete files:
  - `src/services/opencode/discovery-service.ts`
  - `src/services/opencode/discovery-service.test.ts`
  - `src/services/opencode/instance-probe.ts`
  - `src/services/opencode/instance-probe.test.ts`
- Update `src/services/opencode/index.ts` exports
- Remove from service wiring in `src/main/index.ts`
- Remove `[discovery]` logger references from AGENTS.md
- Files: multiple deletions and updates
- Test criteria: No references to deleted files, build passes

- [x] **Step 11: Integrate with AppState lifecycle**

- Update `src/main/app-state.ts`:
  - Add `OpenCodeServerManager` as constructor dependency
  - In constructor/init, wire callbacks through AppState (not direct):
    ```typescript
    this.serverManager.onServerStarted((path, port) => {
      this.agentStatusManager.initWorkspace(path, port);
    });
    this.serverManager.onServerStopped((path) => {
      this.agentStatusManager.removeWorkspace(path);
    });
    ```
  - `addWorkspace()`: call `await this.serverManager.startServer(workspacePath)` before creating view
  - `removeWorkspace()`: call `await this.serverManager.stopServer(workspacePath)`
  - `closeProject()`: call `await this.serverManager.stopAllForProject(projectPath)`
- Update `src/main/index.ts` `startServices()`:
  - Create `OpenCodeServerManager` with dependencies
  - Call `await serverManager.cleanupStaleEntries()` before opening any projects
  - Inject into `AppState`
  - On app shutdown, call `serverManager.dispose()`
- Files: `app-state.ts`, `app-state.test.ts`, `index.ts`
- Test criteria: Servers start/stop at correct lifecycle points

- [x] **Step 12: Add integration tests**

- Create test file: `src/services/opencode/opencode-server-manager.integration.test.ts`
- Tests:
  - `workspace lifecycle: server starts on add, stops on remove`
  - `multiple workspaces: each gets own server and port`
  - `project close cleanup: all servers killed`
  - `ports.json consistency: file matches running servers`
  - `AgentStatusManager receives start/stop events correctly`
  - `rapid workspace add/remove cycles are stable`
  - `cleanup removes stale entries on startup`
- Files: `opencode-server-manager.integration.test.ts`
- Test criteria: Full lifecycle works

## Wrapper Scripts

### Unix (bin/opencode)

```bash
#!/bin/sh
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PORTS_FILE="$SCRIPT_DIR/../opencode/ports.json"
OPENCODE_BIN="$SCRIPT_DIR/../opencode/<version>/opencode"

GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)

# If in a git repo and ports file exists, try managed mode
if [ -n "$GIT_ROOT" ] && [ -f "$PORTS_FILE" ]; then
    # Parse JSON to find port for this workspace
    # Use grep/sed for portability (no jq dependency)
    # Format: "path": { "port": 14001 }
    PORT=$(grep -A1 "\"$GIT_ROOT\"" "$PORTS_FILE" 2>/dev/null | grep '"port"' | sed 's/.*: *\([0-9]*\).*/\1/')

    if [ -n "$PORT" ]; then
        # Managed mode: connect to existing server
        # NO args passed - attach doesn't accept same args as standalone
        # If attach fails quickly, fall back to standalone
        "$OPENCODE_BIN" attach "http://127.0.0.1:$PORT" &
        PID=$!
        sleep 2
        if kill -0 $PID 2>/dev/null; then
            # Process still running after 2s, attach succeeded
            wait $PID
            exit $?
        fi
        # Attach failed, fall through to standalone
    fi
fi

# Standalone mode: pass all args
exec "$OPENCODE_BIN" "$@"
```

### Windows (bin/opencode.cmd)

```cmd
@echo off
setlocal EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "PORTS_FILE=%SCRIPT_DIR%..\opencode\ports.json"
set "OPENCODE_BIN=%SCRIPT_DIR%..\opencode\<version>\opencode.exe"

for /f "tokens=*" %%i in ('git rev-parse --show-toplevel 2^>nul') do set "GIT_ROOT=%%i"

if defined GIT_ROOT if exist "%PORTS_FILE%" (
    REM Use PowerShell to parse JSON (available on all modern Windows)
    for /f "tokens=*" %%p in ('powershell -NoProfile -Command "(Get-Content '%PORTS_FILE%' | ConvertFrom-Json).workspaces.'%GIT_ROOT%'.port" 2^>nul') do set "PORT=%%p"

    if defined PORT (
        REM Managed mode: try to attach
        start /b "" "%OPENCODE_BIN%" attach "http://127.0.0.1:!PORT!"
        timeout /t 2 /nobreak >nul
        REM Check if process is still running (attach succeeded)
        tasklist /fi "imagename eq opencode.exe" 2>nul | find /i "opencode.exe" >nul
        if !errorlevel! equ 0 (
            REM Attach succeeded, wait for it
            "%OPENCODE_BIN%" attach "http://127.0.0.1:!PORT!"
            exit /b
        )
        REM Attach failed, fall through to standalone
    )
)

"%OPENCODE_BIN%" %*
```

## Testing Strategy

### Unit Tests (vitest)

| Test Case                                       | Description                                | File                              |
| ----------------------------------------------- | ------------------------------------------ | --------------------------------- |
| `startServer allocates port`                    | Manager finds free port and spawns process | `opencode-server-manager.test.ts` |
| `startServer writes ports.json`                 | Port entry added after health check        | `opencode-server-manager.test.ts` |
| `startServer fires callback`                    | onServerStarted called with path and port  | `opencode-server-manager.test.ts` |
| `startServer throws on port allocation failure` | Error propagated when no ports available   | `opencode-server-manager.test.ts` |
| `startServer throws on binary not found`        | ENOENT error handled                       | `opencode-server-manager.test.ts` |
| `startServer cleans up on spawn failure`        | No stale entries on failure                | `opencode-server-manager.test.ts` |
| `startServer cleans up on health check timeout` | Process killed if health check fails       | `opencode-server-manager.test.ts` |
| `stopServer kills process`                      | Graceful shutdown with SIGTERM/SIGKILL     | `opencode-server-manager.test.ts` |
| `stopServer awaits pending start`               | No race between start and stop             | `opencode-server-manager.test.ts` |
| `stopServer handles dead process`               | No error if already terminated             | `opencode-server-manager.test.ts` |
| `stopServer removes from ports.json`            | Entry removed from file                    | `opencode-server-manager.test.ts` |
| `stopServer fires callback`                     | onServerStopped called with path           | `opencode-server-manager.test.ts` |
| `stopAllForProject kills all`                   | All workspace servers stopped              | `opencode-server-manager.test.ts` |
| `concurrent starts get unique ports`            | No port collisions                         | `opencode-server-manager.test.ts` |
| `dispose stops all servers`                     | IDisposable cleanup works                  | `opencode-server-manager.test.ts` |
| `ports.json handles corrupted file`             | Graceful degradation                       | `opencode-server-manager.test.ts` |
| `ports.json atomic write prevents corruption`   | Temp file + rename                         | `opencode-server-manager.test.ts` |
| `cleanupStaleEntries removes dead entries`      | Startup cleanup works                      | `opencode-server-manager.test.ts` |
| `wrapper script managed mode`                   | Generated script parses JSON               | `bin-scripts.test.ts`             |
| `wrapper script standalone mode`                | Falls back when port not found             | `bin-scripts.test.ts`             |
| `wrapper script fallback on attach failure`     | Falls back if attach exits quickly         | `bin-scripts.test.ts`             |
| `AgentStatusManager.initWorkspace takes port`   | New signature works                        | `agent-status-manager.test.ts`    |
| `callback fires before startServer returns`     | Deterministic ordering                     | `opencode-server-manager.test.ts` |
| `callback fires after process terminated`       | Deterministic ordering                     | `opencode-server-manager.test.ts` |

### Boundary Tests

| Test Case                           | Description                        | File                                       |
| ----------------------------------- | ---------------------------------- | ------------------------------------------ |
| `opencode serve starts and listens` | Real process spawns and responds   | `opencode-server-manager.boundary.test.ts` |
| `health check succeeds`             | HTTP probe to /app works           | `opencode-server-manager.boundary.test.ts` |
| `graceful shutdown works`           | SIGTERM/SIGKILL terminates process | `opencode-server-manager.boundary.test.ts` |
| `ports.json survives restart`       | File persists                      | `opencode-server-manager.boundary.test.ts` |
| `cleanup removes stale entries`     | Dead process entries removed       | `opencode-server-manager.boundary.test.ts` |
| `wrapper script is executable`      | Script runs in terminal            | `opencode-server-manager.boundary.test.ts` |

### Integration Tests

| Test Case                        | Description                           | File                                          |
| -------------------------------- | ------------------------------------- | --------------------------------------------- |
| `workspace lifecycle`            | Server starts on add, stops on remove | `opencode-server-manager.integration.test.ts` |
| `multiple workspaces`            | Each gets own server and port         | `opencode-server-manager.integration.test.ts` |
| `project close cleanup`          | All servers killed                    | `opencode-server-manager.integration.test.ts` |
| `ports.json consistency`         | File matches running servers          | `opencode-server-manager.integration.test.ts` |
| `AgentStatusManager integration` | Receives events correctly             | `opencode-server-manager.integration.test.ts` |
| `rapid add/remove cycles`        | No race conditions                    | `opencode-server-manager.integration.test.ts` |
| `startup cleanup`                | Stale entries removed                 | `opencode-server-manager.integration.test.ts` |

### Manual Testing Checklist

Prerequisites:

- Ensure `opencode` binary is installed at `<app-data>/opencode/<version>/opencode`

Tests:

- [ ] Open a project with multiple workspaces
- [ ] Run `opencode` in first workspace terminal - TUI appears
- [ ] Check `<app-data>/opencode/ports.json` - entry exists with correct path/port
- [ ] Verify only one OpenCode process per workspace (`ps aux | grep opencode`)
- [ ] Run `opencode` again in same workspace - connects to same server (same TUI)
- [ ] Run `opencode` in second workspace terminal - different TUI instance
- [ ] Use VS Code extension keyboard shortcut (Cmd+Esc) - TUI opens (extension's --port ignored)
- [ ] Close workspace - verify server process terminates
- [ ] Check ports.json - entry removed
- [ ] Close project - verify all server processes terminate
- [ ] Check ports.json - all project entries removed
- [ ] Kill CodeHydra, restart - verify stale entries cleaned up

## Dependencies

| Package | Purpose                    | Approved |
| ------- | -------------------------- | -------- |
| (none)  | Uses existing dependencies | N/A      |

No new dependencies required. Uses existing:

- `ProcessRunner` for spawning/killing processes
- `PortManager` for port allocation
- `FileSystemLayer` for ports.json read/write
- `HttpClient` for health check probes
- `PathProvider` for app-data path resolution
- `Logger` for structured logging

## Documentation Updates

### Files to Update

| File                   | Changes Required                                                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`            | Add section on managed OpenCode servers, document ports.json location and format, remove `[discovery]` from Logger Names table, remove DiscoveryService from NetworkLayer usage examples |
| `docs/ARCHITECTURE.md` | Update OpenCode integration section: remove DiscoveryService/InstanceProbe, add OpenCodeServerManager, update architecture diagram, update services table                                |

### New Documentation Required

| File   | Purpose                                         |
| ------ | ----------------------------------------------- |
| (none) | Feature is internal, no user-facing docs needed |

## Definition of Done

- [ ] All implementation steps complete
- [ ] `npm run validate:fix` passes
- [ ] Documentation updated (AGENTS.md, ARCHITECTURE.md)
- [ ] User acceptance testing passed
- [ ] Changes committed
