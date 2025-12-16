---
status: COMPLETED
last_updated: 2025-12-16
reviewers: [review-ui, review-typescript, review-arch, review-testing, review-docs]
---

# LOGGING

## Overview

- **Problem**: Cannot trace issues from user machines; no visibility into boundary operations, API calls, or UI events
- **Solution**: Comprehensive logging system using electron-log, wrapped in our own abstraction for testability in both main and renderer processes
- **Risks**:
  - Log file growth if not managed → mitigated by per-session files (user manages cleanup)
  - Performance impact from excessive logging → mitigated by level filtering at log site
  - Sensitive data exposure → mitigated by logging operation metadata, not content
- **Alternatives Considered**:
  - Custom implementation from scratch → rejected; electron-log handles complex IPC, file rotation, platform paths
  - Direct electron-log usage without abstraction → rejected; need testability and boundary isolation

## Required Approvals

This plan introduces new boundary abstractions:

| Interface        | Purpose                                       | Approved |
| ---------------- | --------------------------------------------- | -------- |
| `Logger`         | Abstraction over electron-log for testability | [x]      |
| `LoggingService` | Main process logging service factory          | [x]      |

**Justification**: Logging is infrastructure needed across all layers. Unlike filesystem/network boundaries, existing interfaces don't cover this use case. The abstraction enables testing without writing to real log files and follows the established pattern (interface + implementation + mock factory + boundary tests).

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LOGGING ARCHITECTURE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Environment Variables                                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  CODEHYDRA_LOGLEVEL=debug|info|warn|error  (override default level)     ││
│  │  CODEHYDRA_PRINT_LOGS=<any>                (print to stdout/stderr)     ││
│  │  CODEHYDRA_LOGGER=process,network          (filter by logger name)      ││
│  │                                                                          ││
│  │  Precedence: ENV var > BuildInfo.isDevelopment default                  ││
│  │  - Development (isDevelopment=true): DEBUG                              ││
│  │  - Production (isDevelopment=false): WARN                               ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  MAIN PROCESS                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                     LoggingService (interface)                           ││
│  │  - createLogger(name: LoggerName): Logger                               ││
│  │  - initialize(): void  (enables renderer logging via IPC)               ││
│  │  - dispose(): void                                                      ││
│  │                              │                                           ││
│  │                              │ implements                                ││
│  │                              ▼                                           ││
│  │              ElectronLogService (boundary impl)                          ││
│  │  - Wraps electron-log/main                                              ││
│  │  - Configures file path: <app-data>/logs/<datetime>-<uuid>.log          ││
│  │  - Sets level based on BuildInfo + env var                              ││
│  │  - Configures console transport based on env var                        ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  RENDERER PROCESS (via IPC)                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  window.api.log (exposed via preload)                                   ││
│  │  - debug(logger: string, msg: string, context?: LogContext): void       ││
│  │  - info(logger: string, msg: string, context?: LogContext): void        ││
│  │  - warn(logger: string, msg: string, context?: LogContext): void        ││
│  │  - error(logger: string, msg: string, context?: LogContext): void       ││
│  │                              │                                           ││
│  │                              │ IPC to main                               ││
│  │                              ▼                                           ││
│  │              LoggingService.createLogger(name).method(msg, context)     ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  SHARED TYPES                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  LogLevel = "debug" | "info" | "warn" | "error"  (const + union type)   ││
│  │                                                                          ││
│  │  LoggerName = "process" | "network" | "fs" | "git" | "opencode" |       ││
│  │               "code-server" | "pidtree" | "keepfiles" | "api" |         ││
│  │               "window" | "view" | "app" | "ui"                          ││
│  │                                                                          ││
│  │  LogContext = Record<string, string | number | boolean | null>          ││
│  │               (constrained - no nested objects, functions, symbols)     ││
│  │                                                                          ││
│  │  Logger (interface)                                                      ││
│  │  - debug(msg: string, context?: LogContext): void                       ││
│  │  - info(msg: string, context?: LogContext): void                        ││
│  │  - warn(msg: string, context?: LogContext): void                        ││
│  │  - error(msg: string, context?: LogContext, error?: Error): void        ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

Abstraction Pattern:
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│   Services (receive Logger interface - REQUIRED, not optional)               │
│        │                                                                     │
│        │ constructor(logger: Logger, ...)                                    │
│        ▼                                                                     │
│   Logger (interface) ◄─────── createMockLogger() for tests                  │
│        │                                                                     │
│        │ implements                                                          │
│        ▼                                                                     │
│   ElectronLogLogger (wraps electron-log scope)                              │
│        │                                                                     │
│        │ delegates to                                                        │
│        ▼                                                                     │
│   electron-log (external library)                                            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

Process Output Logging (via LoggingProcessRunner decorator):
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  LoggingProcessRunner wraps ProcessRunner to add logging:                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  [process] Spawned command=code-server pid=12345                        ││
│  │  [process] [code-server 12345] stdout: Listening on http://...          ││
│  │  [process] [code-server 12345] stderr: Warning: deprecated...           ││
│  │  [process] [code-server 12345] Exited exitCode=0                        ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  - Base ProcessRunner (ExecaProcessRunner) remains pure, no logging deps    │
│  - LoggingProcessRunner decorates it, adds logging to spawn/stdout/stderr   │
│  - Lines are logged AND captured in ProcessResult for callers               │
│  - All spawned processes get stdout/stderr logged automatically             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

Log Entry Format:
┌─────────────────────────────────────────────────────────────────────────────┐
│  Main process example:                                                       │
│  [2025-12-16 10:30:00.123] [info] [process] Spawned command=code-server ... │
│   │                        │      │         │                               │
│   │                        │      │         └─ message with context         │
│   │                        │      └─ logger name (scope)                    │
│   │                        └─ level                                         │
│   └─ timestamp                                                              │
│                                                                              │
│  Renderer example (via IPC):                                                 │
│  [2025-12-16 10:30:00.456] [debug] [ui] Dialog opened type=create-workspace │
└─────────────────────────────────────────────────────────────────────────────┘

File Location:
┌─────────────────────────────────────────────────────────────────────────────┐
│  Development:  ./app-data/logs/2025-12-16T10-30-00-abc123.log               │
│  Linux:        ~/.local/share/codehydra/logs/2025-12-16T10-30-00-abc123.log │
│  macOS:        ~/Library/Application Support/Codehydra/logs/...             │
│  Windows:      %APPDATA%\Codehydra\logs\...                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Logging Points Reference

**Implementation Specification**: The following tables define ALL log points that must be implemented. Each Phase 3-6 step implements the log points for its respective module. When implementing a logger for a module, reference this table to ensure all operations and error cases are logged at the correct level with the specified message format.

**Message Format Conventions**:

- Placeholders in angle brackets (e.g., `<cmd>`, `<pid>`, `<path>`) are replaced with runtime values
- Use key=value format for structured context (e.g., `command=code-server pid=12345`)
- Context object is for machine-parseable data; message string is human-readable description

### Platform Boundaries

#### `[process]` - LoggingProcessRunner (decorator over ProcessRunner)

| Level | When                     | Message Format                            |
| ----- | ------------------------ | ----------------------------------------- |
| DEBUG | After spawn succeeds     | `Spawned command=<cmd> pid=<pid>`         |
| DEBUG | stdout line received     | `[<cmd> <pid>] stdout: <line>`            |
| DEBUG | stderr line received     | `[<cmd> <pid>] stderr: <line>`            |
| DEBUG | Process exits cleanly    | `[<cmd> <pid>] Exited exitCode=<code>`    |
| WARN  | Process killed by signal | `[<cmd> <pid>] Killed signal=<signal>`    |
| ERROR | Spawn fails (ENOENT etc) | `Spawn failed command=<cmd> error=<msg>`  |
| WARN  | Wait timeout             | `[<cmd> <pid>] Wait timeout after <ms>ms` |

#### `[network]` - DefaultNetworkLayer

| Level | When                | Message Format                             |
| ----- | ------------------- | ------------------------------------------ |
| DEBUG | Fetch starts        | `Fetch url=<url> method=<method>`          |
| DEBUG | Fetch succeeds      | `Fetch complete url=<url> status=<status>` |
| WARN  | Fetch fails         | `Fetch failed url=<url> error=<msg>`       |
| DEBUG | Find free port      | `Found free port port=<port>`              |
| DEBUG | Get listening ports | `Scanned listening ports count=<n>`        |
| ERROR | Port scan fails     | `Port scan failed error=<msg>`             |

#### `[fs]` - DefaultFileSystemLayer

| Level | When              | Message Format                                     |
| ----- | ----------------- | -------------------------------------------------- |
| DEBUG | Read file         | `Read path=<path>`                                 |
| DEBUG | Write file        | `Write path=<path>`                                |
| DEBUG | Mkdir             | `Mkdir path=<path>`                                |
| DEBUG | Readdir           | `Readdir path=<path> count=<n>`                    |
| DEBUG | Unlink            | `Unlink path=<path>`                               |
| DEBUG | Rm                | `Rm path=<path> recursive=<bool>`                  |
| DEBUG | CopyTree starts   | `CopyTree src=<src> dest=<dest>`                   |
| DEBUG | CopyTree complete | `CopyTree complete copied=<n> skippedSymlinks=<n>` |
| WARN  | Operation fails   | `<Op> failed path=<path> code=<code> error=<msg>`  |

### Service Boundaries

#### `[git]` - SimpleGitClient

| Level | When            | Message Format                                  |
| ----- | --------------- | ----------------------------------------------- |
| DEBUG | Check repo      | `IsGitRepository path=<path> result=<bool>`     |
| DEBUG | List worktrees  | `ListWorktrees path=<path> count=<n>`           |
| DEBUG | Add worktree    | `AddWorktree path=<path> branch=<branch>`       |
| DEBUG | Remove worktree | `RemoveWorktree path=<path>`                    |
| DEBUG | List branches   | `ListBranches path=<path> local=<n> remote=<n>` |
| DEBUG | Get status      | `GetStatus path=<path> dirty=<bool>`            |
| DEBUG | Fetch           | `Fetch path=<path> remote=<remote>`             |
| WARN  | Git error       | `Git error op=<op> path=<path> error=<msg>`     |

#### `[opencode]` - OpenCodeClient

| Level | When             | Message Format                                  |
| ----- | ---------------- | ----------------------------------------------- |
| INFO  | Connect          | `Connecting port=<port>`                        |
| INFO  | Connected        | `Connected port=<port>`                         |
| DEBUG | SSE event        | `Event type=<type>`                             |
| DEBUG | Session status   | `Session status sessionId=<id> status=<status>` |
| INFO  | Disconnect       | `Disconnected port=<port>`                      |
| WARN  | Connection error | `Connection error port=<port> error=<msg>`      |
| WARN  | Reconnecting     | `Reconnecting port=<port> attempt=<n>`          |

#### `[code-server]` - CodeServerManager

| Level | When                | Message Format                      |
| ----- | ------------------- | ----------------------------------- |
| INFO  | Starting            | `Starting code-server`              |
| INFO  | Started             | `Started port=<port> pid=<pid>`     |
| DEBUG | Health check        | `Health check status=<status>`      |
| INFO  | Stopping            | `Stopping pid=<pid>`                |
| INFO  | Stopped             | `Stopped pid=<pid> exitCode=<code>` |
| ERROR | Start failed        | `Start failed error=<msg>`          |
| WARN  | Health check failed | `Health check failed error=<msg>`   |

#### `[pidtree]` - PidtreeProvider

| Level | When         | Message Format                                |
| ----- | ------------ | --------------------------------------------- |
| DEBUG | Lookup       | `GetDescendants pid=<pid> count=<n>`          |
| WARN  | Lookup fails | `GetDescendants failed pid=<pid> error=<msg>` |

#### `[keepfiles]` - KeepFilesService

| Level | When          | Message Format                                  |
| ----- | ------------- | ----------------------------------------------- |
| DEBUG | Parse config  | `Parsed .keepfiles patterns=<n>`                |
| DEBUG | Copy starts   | `CopyKeepFiles src=<src> dest=<dest>`           |
| DEBUG | Copy complete | `CopyKeepFiles complete copied=<n> skipped=<n>` |
| DEBUG | No config     | `No .keepfiles found path=<path>`               |
| WARN  | Copy error    | `CopyKeepFiles failed error=<msg>`              |

### Electron Layer

#### `[api]` - IPC Handlers

| Level | When             | Message Format                               |
| ----- | ---------------- | -------------------------------------------- |
| DEBUG | Request received | `Request channel=<channel>`                  |
| DEBUG | Request complete | `Response channel=<channel> duration=<ms>ms` |
| WARN  | Request failed   | `Error channel=<channel> error=<msg>`        |

#### `[window]` - WindowManager

| Level | When     | Message Format                        |
| ----- | -------- | ------------------------------------- |
| INFO  | Create   | `Window created`                      |
| DEBUG | Resize   | `Window resized width=<w> height=<h>` |
| DEBUG | Maximize | `Window maximized`                    |
| INFO  | Close    | `Window closed`                       |

#### `[view]` - ViewManager

| Level | When         | Message Format                             |
| ----- | ------------ | ------------------------------------------ |
| DEBUG | Create view  | `View created workspace=<name>`            |
| DEBUG | Attach view  | `View attached workspace=<name>`           |
| DEBUG | Detach view  | `View detached workspace=<name>`           |
| DEBUG | Destroy view | `View destroyed workspace=<name>`          |
| DEBUG | Mode change  | `Mode changed mode=<mode> previous=<prev>` |
| DEBUG | Load URL     | `Loading URL workspace=<name>`             |

#### `[app]` - Application Lifecycle

| Level | When             | Message Format                                  |
| ----- | ---------------- | ----------------------------------------------- |
| INFO  | Bootstrap start  | `Bootstrap starting version=<ver> isDev=<bool>` |
| INFO  | Services started | `Services started`                              |
| INFO  | Setup required   | `Setup required`                                |
| INFO  | Setup complete   | `Setup complete`                                |
| INFO  | Shutdown         | `Shutdown initiated`                            |
| INFO  | Cleanup complete | `Cleanup complete`                              |
| ERROR | Fatal error      | `Fatal error=<msg>`                             |

### Renderer Layer

#### `[ui]` - UI Components (via api.log.\*)

| Level | When             | Message Format                            |
| ----- | ---------------- | ----------------------------------------- |
| DEBUG | Dialog open      | `Dialog opened type=<type>`               |
| DEBUG | Dialog close     | `Dialog closed type=<type>`               |
| DEBUG | Dialog submit    | `Dialog submitted type=<type>`            |
| DEBUG | Shortcut mode    | `Shortcut mode enabled=<bool>`            |
| DEBUG | Project select   | `Project selected projectId=<id>`         |
| DEBUG | Workspace select | `Workspace selected workspaceName=<name>` |
| DEBUG | Focus trap       | `Focus trap activated=<bool>`             |
| DEBUG | Store update     | `Store updated store=<name>`              |
| WARN  | UI error         | `UI error component=<name> error=<msg>`   |
| WARN  | IPC error        | `IPC error channel=<channel> error=<msg>` |

### Summary by Logger Name

| Logger          | Module                 | Log Points |
| --------------- | ---------------------- | ---------- |
| `[process]`     | LoggingProcessRunner   | 7          |
| `[network]`     | DefaultNetworkLayer    | 6          |
| `[fs]`          | DefaultFileSystemLayer | 9          |
| `[git]`         | SimpleGitClient        | 8          |
| `[opencode]`    | OpenCodeClient         | 7          |
| `[code-server]` | CodeServerManager      | 7          |
| `[pidtree]`     | PidtreeProvider        | 2          |
| `[keepfiles]`   | KeepFilesService       | 5          |
| `[api]`         | IPC Handlers           | 3          |
| `[window]`      | WindowManager          | 4          |
| `[view]`        | ViewManager            | 6          |
| `[app]`         | Application Lifecycle  | 7          |
| `[ui]`          | Renderer Components    | 10         |
| **Total**       |                        | **81**     |

## Implementation Steps

### Phase 1: Logging Infrastructure (Main Process)

- [x] **Step 1: Create logging interfaces and types**
  - Create `src/services/logging/` directory
  - `types.ts`:
    - `LogLevel` as const object + union type (not enum)
    - `LoggerName` as string literal union for type-safe logger names
    - `LogContext` as `Record<string, string | number | boolean | null>` (constrained)
    - `Logger` interface with debug/info/warn/error methods
    - `error()` method includes optional `Error` parameter for stack traces
    - `LoggingService` interface with createLogger/initialize/dispose
  - `index.ts`: exports
  - Files: `src/services/logging/types.ts`, `src/services/logging/index.ts`
  - Test criteria: Types compile correctly

- [x] **Step 2: Implement ElectronLogService (main process boundary)**
  - Create `electron-log-service.ts` wrapping electron-log/main
  - Constructor accepts: `buildInfo: BuildInfo`, `pathProvider: PathProvider`
  - Configure file transport with path: `pathProvider.dataRootDir + "/logs"`
  - Configure session-based filename: `<datetime>-<uuid>.log`
  - Read environment variables:
    - `CODEHYDRA_LOGLEVEL`: override default level
    - `CODEHYDRA_PRINT_LOGS`: enable console transport
  - Set default level: DEBUG (isDevelopment=true) / WARN (isDevelopment=false)
  - Handle invalid `CODEHYDRA_LOGLEVEL` gracefully (fall back to default)
  - Files: `src/services/logging/electron-log-service.ts`
  - Test criteria: Unit tests for configuration logic

- [x] **Step 3: Create mock logger utilities for testing**
  - Create `createMockLogger()` factory:
    - Returns object with vi.fn() spy methods (debug, info, warn, error)
    - Spies record all calls for assertion
  - Create `createMockLoggingService()` factory:
    - Returns service that creates mock loggers
    - Tracks all loggers created via `getCreatedLoggers()` method
  - Files: `src/services/logging/logging.test-utils.ts`
  - Test criteria: Mock factories work in tests

- [x] **Step 4: Add boundary tests for ElectronLogService**
  - Test file creation in temp directory
  - Test level filtering (DEBUG not written when level is WARN)
  - Test log format matches specification
  - Test session-based filename format: `YYYY-MM-DDTHH-MM-SS-<uuid>.log`
  - Test platform-specific log paths (mock PathProvider)
  - Test handles permission denied gracefully
  - Files: `src/services/logging/electron-log-service.boundary.test.ts`
  - Test criteria: Boundary tests pass

### Phase 2: Renderer Logging API

- [x] **Step 5: Add log API to preload and IPC**
  - Add `api.log` namespace to preload script with debug/info/warn/error methods
  - Each method accepts: `logger: string, msg: string, context?: LogContext`
  - Register IPC handlers in main process that delegate to LoggingService
  - IPC channels: `api:log:debug`, `api:log:info`, `api:log:warn`, `api:log:error`
  - Files: `src/preload/index.ts`, `src/shared/ipc.ts`, `src/main/ipc/log-handlers.ts`
  - Test criteria: Unit tests for IPC handlers

- [x] **Step 6: Create renderer logging helper**
  - Create `src/renderer/lib/logging/` directory
  - `index.ts`: Export `createLogger(name: LoggerName)` function
    - Returns object with debug/info/warn/error that call `api.log.*`
  - `logging.test-utils.ts`: Mock factory for renderer tests
  - Usage in components: `const logger = createLogger('ui')`
  - Files: `src/renderer/lib/logging/*`
  - Test criteria: Types compile, mocks work in renderer tests
  - Unit tests:
    - `creates logger with IPC transport`
    - `includes logger name in IPC calls`
    - `handles IPC errors gracefully` (logger never throws)

### Phase 3: Platform Boundary Integration

- [x] **Step 7: Create LoggingProcessRunner decorator**
  - Create `logging-process-runner.ts` that wraps `ProcessRunner` interface
  - Constructor: `new LoggingProcessRunner(inner: ProcessRunner, logger: Logger)`
  - Delegates all calls to inner runner
  - Adds logging: spawn, stdout lines, stderr lines, exit, errors
  - stdout/stderr lines logged AND passed through to ProcessResult
  - Keeps base `ExecaProcessRunner` pure (no logging dependency)
  - Files: `src/services/platform/logging-process-runner.ts`
  - Test criteria: Unit tests verify logging calls
  - Unit tests:
    - `logs process spawn with command and PID`
    - `logs stdout lines at DEBUG level`
    - `logs stderr lines at DEBUG level`
    - `logs process exit with exitCode`
    - `logs process kill with signal`
    - `logs spawn failures at ERROR level`

- [x] **Step 8: Add Logger to DefaultNetworkLayer**
  - Add `logger: Logger` to constructor (required)
  - Log: fetch start/complete/fail, port operations
  - Update all instantiation sites:
    - Search: `new DefaultNetworkLayer(`
    - Expected: `src/main/index.ts`
  - Update mock factory `createMockNetworkLayer()` to require logger
  - Files: `src/services/platform/network.ts`, `src/services/platform/network.test-utils.ts`
  - Test criteria: Existing tests pass

- [x] **Step 9: Add Logger to DefaultFileSystemLayer**
  - Add `logger: Logger` to constructor (required)
  - Log: all operations with paths, errors with codes
  - Update all instantiation sites:
    - Search: `new DefaultFileSystemLayer(`
    - Expected: `src/main/index.ts`
  - Update mock factory `createMockFileSystemLayer()` to require logger
  - Files: `src/services/platform/filesystem.ts`, `src/services/platform/filesystem.test-utils.ts`
  - Test criteria: Existing tests pass

### Phase 4: Service Boundary Integration

- [x] **Step 10: Add Logger to SimpleGitClient**
  - Add `logger: Logger` to constructor (required)
  - Log: all git operations per logging points table
  - Update all instantiation sites:
    - Search: `new SimpleGitClient(`
  - Files: `src/services/git/simple-git-client.ts`
  - Test criteria: Existing tests pass

- [x] **Step 11: Add Logger to OpenCodeClient**
  - Add `logger: Logger` to constructor (required)
  - Log: connect, events (type only), disconnect, errors
  - Files: `src/services/opencode/opencode-client.ts`
  - Test criteria: Existing tests pass

- [x] **Step 12: Add Logger to CodeServerManager**
  - Add `logger: Logger` to constructor (required)
  - Log: start, started, health, stop, stopped, errors
  - Note: stdout/stderr logged via LoggingProcessRunner (Step 7)
  - Files: `src/services/code-server/code-server-manager.ts`
  - Test criteria: Existing tests pass

- [x] **Step 13: Add Logger to remaining boundary services**
  - PidtreeProvider: `logger: Logger` for PID lookups
  - KeepFilesService: `logger: Logger` for copy operations
  - Files: `src/services/opencode/process-tree.ts`, `src/services/keepfiles/keepfiles-service.ts`
  - Test criteria: Existing tests pass

### Phase 5: Main Process Integration

- [x] **Step 14: Initialize LoggingService in main process**
  - Create ElectronLogService in `bootstrap()` (BEFORE loadFile, so available during setup)
  - Call `initialize()` to enable renderer logging via IPC
  - Create LoggingProcessRunner wrapping ExecaProcessRunner
  - Pass loggers to all services via constructor DI
  - Add [app] logger for lifecycle events in index.ts
  - Files: `src/main/index.ts`
  - Test criteria: App starts, logs appear in file

- [x] **Step 15: Add logging to IPC handlers**
  - Add [api] logger to api-handlers.ts
  - Log: incoming requests (channel), responses/errors with duration
  - Do NOT log full payloads (privacy)
  - Files: `src/main/ipc/api-handlers.ts`
  - Test criteria: Existing tests pass

- [x] **Step 16: Add logging to WindowManager and ViewManager**
  - Add `logger: Logger` to constructors (required)
  - WindowManager [window]: create, resize, maximize, close
  - ViewManager [view]: create/attach/detach/destroy, mode changes, URL load
  - Files: `src/main/managers/window-manager.ts`, `src/main/managers/view-manager.ts`
  - Test criteria: Existing tests pass

### Phase 6: Renderer Integration

- [x] **Step 17: Add logging to renderer components**
  - Import `createLogger` from `$lib/logging`
  - **Svelte 5 guidance**: Call logger methods in event handlers and lifecycle hooks (onMount, onDestroy), NOT inside `$effect()` or `$derived()` runes
  - App.svelte [ui]: shortcut mode changes, errors
  - Dialog components [ui]: open/close/submit
  - Sidebar.svelte [ui]: project/workspace selection
  - Focus trap [ui]: activation/deactivation
  - Store updates [ui]: when stores receive IPC updates
  - Files: `src/renderer/App.svelte`, dialog components, `Sidebar.svelte`
  - Test criteria: Component tests verify logger calls
  - Test pattern:
    ```typescript
    vi.mock("$lib/logging", () => ({
      createLogger: () => mockLogger,
    }));
    expect(mockLogger.debug).toHaveBeenCalledWith("Dialog opened", { type: "create-workspace" });
    ```

### Phase 7: Documentation

- [x] **Step 18: Update ARCHITECTURE.md**
  - Add "Logging System" section after "Theming System" (before "OpenCode Integration")
  - Include subsections:
    - "Architecture Overview" (simplified diagram)
    - "Configuration" (environment variables, default levels, precedence)
    - "Logger Names/Scopes" (the logger name table)
    - "Log File Location" (per-platform paths)
    - "Usage in Services" (constructor injection pattern, required logger)
    - "Usage in Renderer" (api.log.\* pattern, Svelte 5 guidance)
  - Files: `docs/ARCHITECTURE.md`
  - Test criteria: N/A (documentation)

- [x] **Step 19: Update AGENTS.md**
  - Add to Environment Variables table:
    - `CODEHYDRA_LOGLEVEL`: debug|info|warn|error, override default level
    - `CODEHYDRA_PRINT_LOGS`: true, print logs to stdout/stderr
  - Files: `AGENTS.md`
  - Test criteria: N/A (documentation)

## Testing Strategy

### Unit Tests (vitest)

| Test Case                                | Description                            | File                             |
| ---------------------------------------- | -------------------------------------- | -------------------------------- |
| `creates logger with scope`              | Logger includes name in output         | `electron-log-service.test.ts`   |
| `uses DEBUG level in dev mode`           | Default level when isDevelopment=true  | `electron-log-service.test.ts`   |
| `uses WARN level in packaged mode`       | Default level when isDevelopment=false | `electron-log-service.test.ts`   |
| `respects CODEHYDRA_LOGLEVEL`            | Env var overrides default              | `electron-log-service.test.ts`   |
| `handles invalid CODEHYDRA_LOGLEVEL`     | Falls back to default                  | `electron-log-service.test.ts`   |
| `enables console when PRINT_LOGS=true`   | Env var enables console transport      | `electron-log-service.test.ts`   |
| `disables console by default`            | Console transport off unless env var   | `electron-log-service.test.ts`   |
| `formats context as key=value`           | Context object serialized correctly    | `electron-log-service.test.ts`   |
| `includes Error stack in error logs`     | Error.stack preserved                  | `electron-log-service.test.ts`   |
| `handles circular references in context` | Doesn't throw/hang                     | `electron-log-service.test.ts`   |
| `logs process spawn with PID`            | Spawn logged after PID available       | `logging-process-runner.test.ts` |
| `logs stdout at DEBUG`                   | stdout lines logged                    | `logging-process-runner.test.ts` |
| `logs stderr at DEBUG`                   | stderr lines logged                    | `logging-process-runner.test.ts` |
| `logs exit with code`                    | Exit logged                            | `logging-process-runner.test.ts` |
| `logs spawn failures`                    | ENOENT etc logged at ERROR             | `logging-process-runner.test.ts` |
| `renderer logger calls IPC`              | api.log.\* called                      | `logging.test.ts` (renderer)     |
| `renderer logger handles IPC failure`    | Never throws                           | `logging.test.ts` (renderer)     |

### Boundary Tests (vitest)

| Test Case                      | Description                                   | File                                    |
| ------------------------------ | --------------------------------------------- | --------------------------------------- |
| `creates log directory`        | Missing logs/ directory created               | `electron-log-service.boundary.test.ts` |
| `writes to log file`           | Log entries appear in file                    | `electron-log-service.boundary.test.ts` |
| `uses session-based filename`  | Filename matches YYYY-MM-DDTHH-MM-SS-uuid.log | `electron-log-service.boundary.test.ts` |
| `filters by level`             | DEBUG not written when level is WARN          | `electron-log-service.boundary.test.ts` |
| `uses dev path in development` | Logs to app-data/logs                         | `electron-log-service.boundary.test.ts` |
| `handles permission denied`    | Graceful fallback or error                    | `electron-log-service.boundary.test.ts` |

### Integration Tests (vitest)

| Test Case                      | Description                                                                       | File                           |
| ------------------------------ | --------------------------------------------------------------------------------- | ------------------------------ |
| `services receive logger`      | DI wiring correct for NetworkLayer, FileSystemLayer, GitClient, CodeServerManager | `services.integration.test.ts` |
| `renderer logs appear in file` | IPC flow works end-to-end                                                         | `logging.integration.test.ts`  |

### Manual Testing Checklist

- [ ] Start app in dev mode → logs at DEBUG level to `./app-data/logs/`
- [ ] Start packaged app → logs at WARN level to platform-specific path
- [ ] Set `CODEHYDRA_LOGLEVEL=debug` on packaged → logs at DEBUG
- [ ] Set `CODEHYDRA_PRINT_LOGS=true` → logs print to terminal
- [ ] Open project → see [git] operations logged
- [ ] Create workspace → see [process] stdout/stderr logged with `[code-server <pid>]`
- [ ] Click in UI → see [ui] events logged (renderer via IPC)
- [ ] Error scenario → see ERROR level entry with stack trace

## Dependencies

| Package        | Purpose                                                 | Approved |
| -------------- | ------------------------------------------------------- | -------- |
| `electron-log` | Logging with file/console transports, main/renderer IPC | [x]      |

## Documentation Updates

### Files to Update

| File                   | Changes Required                                               |
| ---------------------- | -------------------------------------------------------------- |
| `docs/ARCHITECTURE.md` | Add "Logging System" section (see Step 18 for structure)       |
| `AGENTS.md`            | Add CODEHYDRA_LOGLEVEL, CODEHYDRA_PRINT_LOGS to env vars table |

### New Documentation Required

| File   | Purpose                              |
| ------ | ------------------------------------ |
| (none) | All documentation in ARCHITECTURE.md |

## Definition of Done

- [ ] All implementation steps complete
- [ ] `npm run validate:fix` passes
- [ ] Documentation updated
- [ ] User acceptance testing passed
- [ ] Changes committed
