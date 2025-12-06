---
status: COMPLETED
last_updated: 2025-12-06
reviewers: [review-typescript, review-arch, review-testing, review-docs]
---

# Phase 2: App Services

## Overview

- **Problem**: The application needs core business logic services for git operations, code-server management, and project persistence - all independent of Electron.
- **Solution**: Implement pure Node.js services with clean abstractions, ported from the Tauri implementation.
- **Risks**:
  - Git library limitations → Mitigated by abstraction layer allowing future swap
  - Process management across platforms → Mitigated by using battle-tested `execa`
- **Alternatives Considered**:
  - `isomorphic-git`: Pure JS but NO worktree support - unusable
  - `nodegit`: libgit2 bindings but abandoned (last release 2020) - too risky
  - `simple-git`: Requires system git but actively maintained, full worktree support - **chosen**

**Out of Scope**: OpenCode Discovery and OpenCode Status Provider services are deferred to Phase 6 (Agent Integration).

## Architecture

```
src/services/
├── git/
│   ├── types.ts                           # Git-related types
│   ├── git-client.ts                      # Abstract interface for git operations
│   ├── simple-git-client.ts               # simple-git implementation
│   ├── simple-git-client.integration.test.ts  # Integration tests with real git
│   ├── workspace-provider.ts              # Abstract WorkspaceProvider interface
│   ├── git-worktree-provider.ts           # Git worktree implementation
│   └── git-worktree-provider.test.ts      # Unit tests with mocked IGitClient
├── code-server/
│   ├── types.ts                           # Code-server types
│   ├── code-server-manager.ts             # Start/stop, port management, URLs
│   └── code-server-manager.test.ts        # Unit tests with mocked execa
├── project/
│   ├── types.ts                           # Project types
│   ├── project-store.ts                   # Persist projects across sessions
│   └── project-store.test.ts              # Unit tests
├── platform/
│   ├── paths.ts                           # Platform-specific path utilities
│   ├── paths.test.ts                      # Unit tests
│   ├── process.ts                         # Process spawning utilities (execa)
│   └── process.test.ts                    # Unit tests
├── errors.ts                              # Service error definitions
├── errors.test.ts                         # Unit tests
├── test-utils.ts                          # Shared test helpers
├── index.ts                               # Public API exports
└── services.integration.test.ts           # End-to-end integration tests
```

### Abstraction Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    IWorkspaceProvider                        │
│    (Abstract interface for workspace operations)             │
│                                                              │
│  Properties:                                                 │
│  - readonly projectRoot: string                              │
│                                                              │
│  Methods:                                                    │
│  - discover(): Promise<readonly Workspace[]>                 │
│  - listBases(): Promise<readonly BaseInfo[]>                 │
│  - updateBases(): Promise<UpdateBasesResult>                 │
│  - createWorkspace(name, base): Promise<Workspace>           │
│  - removeWorkspace(path, deleteBase): Promise<RemovalResult> │
│  - isDirty(path): Promise<boolean>                           │
│  - isMainWorkspace(path): boolean                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   GitWorktreeProvider                        │
│    (Implementation using git worktrees)                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      IGitClient                              │
│    (Abstract interface for git operations)                   │
│                                                              │
│  Methods:                                                    │
│  - isGitRepository(path): Promise<boolean>                   │
│  - listWorktrees(repoPath): Promise<readonly WorktreeInfo[]> │
│  - addWorktree(repoPath, path, branch): Promise<void>        │
│  - removeWorktree(repoPath, path): Promise<void>             │
│  - pruneWorktrees(repoPath): Promise<void>                   │
│  - listBranches(repoPath): Promise<readonly BranchInfo[]>    │
│  - createBranch(repoPath, name, startPoint): Promise<void>   │
│  - deleteBranch(repoPath, name): Promise<void>               │
│  - getCurrentBranch(path): Promise<string | null>            │
│  - getStatus(path): Promise<StatusResult>                    │
│  - fetch(repoPath, remote?): Promise<void>                   │
│  - listRemotes(repoPath): Promise<readonly string[]>         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   SimpleGitClient                            │
│    (Implementation using simple-git library)                 │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow (including errors)

```
┌──────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│ Electron IPC │ ◀──▶│ IWorkspaceProvider  │ ──▶ │ IGitClient       │
│ (Phase 3)    │     │ (GitWorktreeProvider)│     │ (SimpleGitClient)│
└──────────────┘     └─────────────────────┘     └──────────────────┘
       ▲                      │                          │
       │                      ▼                          ▼
       │             ┌─────────────────────┐     ┌──────────────────┐
       │             │ Platform Paths      │     │ GitError         │
       │             │ (worktree storage)  │     │ (serialized)     │
       │             └─────────────────────┘     └──────────────────┘
       │
       │  SerializedError { type, message, code? }
       │
┌──────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│ Electron IPC │ ◀──▶│ CodeServerManager   │ ──▶ │ execa            │
│ (Phase 3)    │     │                     │     │ (process spawn)  │
└──────────────┘     └─────────────────────┘     └──────────────────┘
       ▲                                                 │
       │                                                 ▼
       │                                         ┌──────────────────┐
       │                                         │ CodeServerError  │
       │                                         │ (serialized)     │
       │                                         └──────────────────┘
       │
┌──────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│ Electron IPC │ ◀──▶│ ProjectStore        │ ──▶ │ fs/promises      │
│ (Phase 3)    │     │                     │     │ (persistence)    │
└──────────────┘     └─────────────────────┘     └──────────────────┘
```

### Type Definitions

```typescript
// All properties are readonly for immutability

interface WorktreeInfo {
  readonly name: string;
  readonly path: string;
  readonly branch: string | null; // null = detached HEAD
  readonly isMain: boolean;
}

interface BranchInfo {
  readonly name: string;
  readonly isRemote: boolean;
}

interface StatusResult {
  readonly isDirty: boolean;
  readonly modifiedCount: number;
  readonly stagedCount: number;
  readonly untrackedCount: number;
}

interface Workspace {
  readonly name: string;
  readonly path: string;
  readonly branch: string | null; // null = detached HEAD (explicit, not optional)
}

interface BaseInfo {
  readonly name: string;
  readonly isRemote: boolean;
}

interface RemovalResult {
  readonly workspaceRemoved: boolean;
  readonly baseDeleted: boolean;
}

interface UpdateBasesResult {
  readonly fetchedRemotes: readonly string[];
  readonly failedRemotes: readonly { remote: string; error: string }[];
}

// String literal union for IPC serialization (not enum)
type InstanceState = "stopped" | "starting" | "running" | "stopping" | "failed";

interface CodeServerConfig {
  readonly runtimeDir: string;
  readonly extensionsDir: string;
  readonly userDataDir: string;
}

interface CodeServerInfo {
  readonly port: number;
  readonly url: string;
}

interface ProjectConfig {
  readonly version: number;
  readonly path: string;
}

// Error serialization format for IPC
interface SerializedError {
  readonly type: "git" | "workspace" | "code-server" | "project-store";
  readonly message: string;
  readonly code?: string;
}
```

## Implementation Steps

**TDD Workflow**: For each step, follow: (1) Write failing tests, (2) Implement feature, (3) Verify tests pass.

### Step 0: Setup

- [x] **0.1: Install dependencies**
  - Run: `pnpm add simple-git execa`
  - Files: `package.json` (auto-updated)
  - Test criteria: Dependencies installed, `pnpm install` succeeds

- [x] **0.2: Configure vitest for Node.js services**
  - Services need `environment: "node"` (not `happy-dom`)
  - Option A: Add `// @vitest-environment node` comment to each service test file
  - Option B: Create separate `vitest.node.config.ts` for services
  - Files: Service test files or new config
  - Test criteria: Service tests run in Node environment

- [x] **0.3: Create test utilities**
  - `createTempDir()` - create temp directory, return cleanup function
  - `createTestGitRepo(options)` - init git repo with optional worktrees, branches, dirty state
  - `withTempRepo(fn)` - helper that creates repo, runs fn, cleans up
  - Files: `src/services/test-utils.ts`
  - Test criteria: Helpers work, cleanup runs even on test failure

### Step 1: Platform Utilities

- [x] **1.1: Platform paths module**
  - Write tests first for each function
  - `getDataRootDir(): string`
    - Dev detection: `process.env.NODE_ENV !== 'production'`
    - Dev: `./app-data/` relative to process.cwd()
    - Prod Linux: `~/.local/share/codehydra/`
    - Prod macOS: `~/Library/Application Support/Codehydra/`
    - Prod Windows: `%APPDATA%\Codehydra\`
  - `getDataProjectsDir(): string` - `<dataRoot>/projects/`
  - `getProjectWorkspacesDir(projectPath: string): string` - `<projectsDir>/<name>-<hash>/workspaces/`
  - `sanitizeWorkspaceName(name: string): string` - replace `/` with `%`
  - `unsanitizeWorkspaceName(sanitized: string): string` - replace `%` with `/`
  - `encodePathForUrl(path: string): string` - percent-encode special chars
  - Platform testing: use `path.posix`/`path.win32` explicitly, mock `process.platform`
  - Files: `src/services/platform/paths.ts`, `src/services/platform/paths.test.ts`
  - Test criteria: All functions work on Linux, macOS, Windows; roundtrip sanitize/unsanitize

- [x] **1.2: Process utilities module**
  - Write tests first
  - `findAvailablePort(): Promise<number>` - use Node.js `net` module (port 0)
  - `spawnProcess(command, args, options): ExecaChildProcess`
    - Wrapper around `execa` with cleanup options
    - Cleanup: terminate child on parent exit, handle SIGTERM/SIGINT
    - Use `execa`'s `cleanup: true` option
  - Files: `src/services/platform/process.ts`, `src/services/platform/process.test.ts`
  - Test criteria: Port finding works; process cleanup on exit
  - Error tests: Port finding when all ports busy (edge case)

- [x] **1.3: Error types module**
  - Write tests first
  - Base class with serialization:

    ```typescript
    abstract class ServiceError extends Error {
      abstract readonly type: SerializedError['type'];
      readonly code?: string;

      toJSON(): SerializedError {
        return { type: this.type, message: this.message, code: this.code };
      }

      static fromJSON(json: SerializedError): ServiceError { ... }
    }
    ```

  - `GitError extends ServiceError` - type: 'git'
  - `WorkspaceError extends ServiceError` - type: 'workspace'
  - `CodeServerError extends ServiceError` - type: 'code-server'
  - `ProjectStoreError extends ServiceError` - type: 'project-store'
  - Type guard: `isServiceError(e: unknown): e is ServiceError`
  - Files: `src/services/errors.ts`, `src/services/errors.test.ts`
  - Test criteria: Serialize/deserialize roundtrip; type guards work; instanceof works before serialization

### Step 2: Git Abstraction Layer

- [x] **2.1: Git types**
  - Define all readonly interfaces as shown in Type Definitions section
  - Files: `src/services/git/types.ts`
  - Test criteria: Types compile, TypeScript strict mode passes

- [x] **2.2: IGitClient interface**
  - Define abstract interface with JSDoc including `@throws` annotations:

    ```typescript
    interface IGitClient {
      /**
       * Check if path is a git repository.
       * @throws GitError if path doesn't exist or is inaccessible
       */
      isGitRepository(path: string): Promise<boolean>;

      /**
       * List all worktrees in repository.
       * @throws GitError if not a git repository
       */
      listWorktrees(repoPath: string): Promise<readonly WorktreeInfo[]>;

      // ... etc with full JSDoc
    }
    ```

  - Files: `src/services/git/git-client.ts`
  - Test criteria: Interface documented, compiles

- [x] **2.3: SimpleGitClient implementation (INTEGRATION TESTS ONLY)**
  - Implement `IGitClient` using `simple-git` library
  - Map `simple-git` errors to `GitError`
  - **Testing strategy**: Integration tests with real git repos only (no mocking simple-git)
  - Test file uses real temp git repos created with test-utils
  - Files: `src/services/git/simple-git-client.ts`, `src/services/git/simple-git-client.integration.test.ts`
  - Test criteria: All methods work with real repos
  - Error tests: Non-existent path, not a git repo, permission denied, corrupt repo

### Step 3: Workspace Provider

- [x] **3.1: Workspace types and interface**
  - `IWorkspaceProvider` interface with readonly properties
  - Include `UpdateBasesResult` for fetch result reporting
  - Files: `src/services/git/types.ts` (add to existing), `src/services/git/workspace-provider.ts`
  - Test criteria: Interface compiles

- [x] **3.2: GitWorktreeProvider - Constructor and validation**
  - Write unit tests first with mocked `IGitClient`
  - `GitWorktreeProvider.create(projectRoot: string, gitClient: IGitClient): Promise<GitWorktreeProvider>`
  - Async factory that validates:
    - Path is absolute (throw `WorkspaceError`)
    - Path exists (throw `WorkspaceError`)
    - Path is git repository via `gitClient.isGitRepository()` (throw `WorkspaceError`)
  - Files: `src/services/git/git-worktree-provider.ts`, `src/services/git/git-worktree-provider.test.ts`
  - Test criteria: Rejects relative paths, non-existent paths, non-git dirs
  - Error tests: Each validation failure throws correct error type

- [x] **3.3: GitWorktreeProvider - discover()**
  - Write unit tests first with mocked `IGitClient`
  - Find all worktrees **EXCLUDING main directory**
  - Return `readonly Workspace[]` with name, path, branch
  - Handle detached HEAD: `branch: null`
  - Skip invalid/deleted worktrees gracefully (log warning, don't throw)
  - Files: `src/services/git/git-worktree-provider.ts`
  - Test criteria: Finds worktrees, excludes main dir, handles detached HEAD
  - Error tests: Graceful handling of corrupted worktree entries

- [x] **3.4: GitWorktreeProvider - listBases() and updateBases()**
  - Write unit tests first with mocked `IGitClient`
  - `listBases(): Promise<readonly BaseInfo[]>` - list local and remote branches
  - `updateBases(): Promise<UpdateBasesResult>` - fetch from all remotes
    - Return success/failure per remote (don't throw on fetch failures)
    - `{ fetchedRemotes: ['origin'], failedRemotes: [{ remote: 'backup', error: 'timeout' }] }`
  - Files: `src/services/git/git-worktree-provider.ts`
  - Test criteria: Returns branches, updateBases returns partial success info
  - Error tests: Network failure during fetch returns in failedRemotes (not thrown)

- [x] **3.5: GitWorktreeProvider - createWorkspace()**
  - Write unit tests first with mocked `IGitClient`
  - `createWorkspace(name: string, baseBranch: string): Promise<Workspace>`
  - Steps:
    1. Sanitize name for filesystem (`/` → `%`)
    2. Compute path in `getProjectWorkspacesDir()`
    3. Create branch from base via `gitClient.createBranch()`
    4. Create worktree via `gitClient.addWorktree()`
    5. On worktree failure: rollback branch via `gitClient.deleteBranch()`
  - Files: `src/services/git/git-worktree-provider.ts`
  - Test criteria: Creates worktree, sanitizes name, rollback on failure
  - Error tests: Branch already exists, worktree path collision, rollback succeeds
  - Concurrency test: Two simultaneous creates with same name - one succeeds, other throws

- [x] **3.6: GitWorktreeProvider - removeWorkspace()**
  - Write unit tests first with mocked `IGitClient`
  - `removeWorkspace(workspacePath: string, deleteBase: boolean): Promise<RemovalResult>`
  - Validation: Cannot remove main worktree (throw `WorkspaceError`)
  - Steps:
    1. Get branch name before removal
    2. Remove worktree via `gitClient.removeWorktree()`
    3. Prune via `gitClient.pruneWorktrees()`
    4. If `deleteBase`: delete branch via `gitClient.deleteBranch()`
  - Return `{ workspaceRemoved: true, baseDeleted: true/false }`
  - Files: `src/services/git/git-worktree-provider.ts`
  - Test criteria: Removes worktree, optional branch delete, rejects main
  - Error tests: Trying to remove main worktree, worktree not found

- [x] **3.7: GitWorktreeProvider - isDirty() and isMainWorkspace()**
  - Write unit tests first with mocked `IGitClient`
  - `isDirty(workspacePath: string): Promise<boolean>`
    - Use `gitClient.getStatus()`
    - Return true if modified > 0 OR staged > 0 OR untracked > 0
  - `isMainWorkspace(workspacePath: string): boolean`
    - Compare normalized paths: `workspacePath === this.projectRoot`
  - Files: `src/services/git/git-worktree-provider.ts`
  - Test criteria: Detects modified, staged, untracked; identifies main correctly

### Step 4: Code Server Manager

- [x] **4.1: Types and state machine**
  - Use string literal union: `type InstanceState = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed'`
  - Define `CodeServerConfig`, `CodeServerInfo` as readonly interfaces
  - Files: `src/services/code-server/types.ts`
  - Test criteria: Types compile

- [x] **4.2: URL generation**
  - Write unit tests first
  - `urlForFolder(port: number, folderPath: string): string`
  - Format: `http://localhost:${port}/?folder=${encodedPath}`
  - Handle path encoding for special characters (spaces, unicode)
  - Handle Windows: `C:\Users\...` → `/C:/Users/...`
  - Files: `src/services/code-server/code-server-manager.ts`, `src/services/code-server/code-server-manager.test.ts`
  - Test criteria: Valid URLs, special chars encoded, Windows paths work
  - Platform testing: Test Windows path conversion on all platforms

- [x] **4.3: Process lifecycle (MOCK EXECA)**
  - Write unit tests first with mocked `execa`
  - `ensureRunning(): Promise<number>` - returns port
    - If already running: return current port
    - Find available port via `findAvailablePort()`
    - Spawn code-server with `spawnProcess()`
    - Health check: GET `/healthz` with retries (30 attempts × 100ms = 3s timeout)
    - State transitions: stopped → starting → running
  - `stop(): Promise<void>`
    - Graceful shutdown with SIGTERM
    - Wait for process exit (timeout 5s)
    - Force kill with SIGKILL if needed
    - State: running → stopping → stopped
  - Files: `src/services/code-server/code-server-manager.ts`
  - Test criteria: State transitions correct, health check retries, cleanup on stop
  - Error tests: Health check timeout, process crash during start
  - Concurrency test: Two simultaneous `ensureRunning()` calls return same port

- [x] **4.4: Status queries**
  - Write unit tests first
  - `isRunning(): boolean` - state === 'running'
  - `port(): number | null` - current port or null
  - `pid(): number | null` - process ID or null
  - Files: `src/services/code-server/code-server-manager.ts`
  - Test criteria: Accurate status in each state

### Step 5: Project Store

- [x] **5.1: Project config types**
  - `ProjectConfig` with version for migrations
  - Files: `src/services/project/types.ts`
  - Test criteria: Types compile

- [x] **5.2: Directory naming**
  - Write unit tests first
  - `projectDirName(projectPath: string): string`
  - Format: `<folder-name>-<8-char-sha256-hash>`
  - Hash computed from full absolute path (deterministic)
  - Files: `src/services/project/project-store.ts`, `src/services/project/project-store.test.ts`
  - Test criteria: Same path = same name; different paths = different names; handles unicode

- [x] **5.3: Save project**
  - Write unit tests first
  - `saveProject(projectPath: string): Promise<void>`
  - Create `<projectsDir>/<dirName>/config.json`
  - Config: `{ version: 1, path: projectPath }`
  - Overwrite if exists
  - Files: `src/services/project/project-store.ts`
  - Test criteria: Creates files, overwrites existing
  - Error tests: Permission denied, disk full

- [x] **5.4: Load projects**
  - Write unit tests first
  - `loadAllProjects(): Promise<readonly string[]>`
  - Read all `config.json` files in projects dir
  - Skip: non-existent paths, malformed JSON, missing config.json
  - Return empty array if projects dir doesn't exist
  - Files: `src/services/project/project-store.ts`
  - Test criteria: Loads valid, skips invalid, handles empty/missing dir

- [x] **5.5: Remove project**
  - Write unit tests first
  - `removeProject(projectPath: string): Promise<void>`
  - Remove `config.json` only
  - Remove directory only if empty (preserve user data)
  - No error if project wasn't saved
  - Files: `src/services/project/project-store.ts`
  - Test criteria: Removes config, preserves other files, no error on missing

### Step 6: Integration and Exports

- [x] **6.1: Public API module**
  - Export all public types and interfaces
  - Export classes: `GitWorktreeProvider`, `SimpleGitClient`, `CodeServerManager`, `ProjectStore`
  - Export error classes and type guards
  - Export factory: `createGitWorktreeProvider(projectRoot: string): Promise<GitWorktreeProvider>`
  - Files: `src/services/index.ts`
  - Test criteria: All exports available, factory works

- [x] **6.2: Integration tests**
  - Full workflow with real git repos:
    1. Create project store, save project
    2. Create GitWorktreeProvider with SimpleGitClient
    3. Discover workspaces (empty initially)
    4. Create workspace from main branch
    5. Discover again (finds new workspace)
    6. Check isDirty (false)
    7. Remove workspace
    8. Discover again (empty)
  - Error recovery: workspace with uncommitted changes removal flow
  - Abstraction test: Verify `IWorkspaceProvider` works with mock `IGitClient`
  - Files: `src/services/services.integration.test.ts`
  - Test criteria: Full workflows pass, abstraction allows mocking

## Testing Strategy

### Test Environment

**Important**: Services require `environment: "node"` in vitest (not `happy-dom`).

Add to each service test file:

```typescript
// @vitest-environment node
```

### Test Utilities (`src/services/test-utils.ts`)

```typescript
/** Create temp directory with automatic cleanup */
function createTempDir(): Promise<{ path: string; cleanup: () => Promise<void> }>;

/** Create git repo with options */
function createTestGitRepo(options?: {
  worktrees?: string[]; // Create these worktrees
  dirty?: boolean; // Add uncommitted changes
  detached?: boolean; // Detach HEAD
}): Promise<{ path: string; cleanup: () => Promise<void> }>;

/** Run test with temp repo, auto-cleanup */
function withTempRepo(
  fn: (repoPath: string) => Promise<void>,
  options?: Parameters<typeof createTestGitRepo>[0]
): Promise<void>;
```

### Unit Tests (mock dependencies)

| Test File                                 | What to Mock                  | What to Test                          |
| ----------------------------------------- | ----------------------------- | ------------------------------------- |
| `platform/paths.test.ts`                  | `process.platform`            | Path generation per platform          |
| `platform/process.test.ts`                | None (real ports)             | Port finding, process helpers         |
| `errors.test.ts`                          | None                          | Serialization, type guards            |
| `git/git-worktree-provider.test.ts`       | `IGitClient`                  | Provider logic, validation, workflows |
| `code-server/code-server-manager.test.ts` | `execa`, `http`               | State machine, URL generation         |
| `project/project-store.test.ts`           | None (real fs with temp dirs) | Persistence logic                     |

### Integration Tests (real dependencies)

| Test File                                   | Uses Real   | Tests                                  |
| ------------------------------------------- | ----------- | -------------------------------------- |
| `git/simple-git-client.integration.test.ts` | git CLI     | All IGitClient methods with real repos |
| `services.integration.test.ts`              | git CLI, fs | Full service workflows                 |

### Test Cleanup

All tests using temp directories or processes MUST:

1. Use `beforeEach`/`afterEach` or `withTempRepo` helper for cleanup
2. Clean up even on test failure (use try/finally or helper)
3. Not leave orphaned processes

### Validation

Run `pnpm validate:fix` to auto-fix formatting/linting and validate:

- TypeScript compilation (zero errors)
- ESLint (zero errors, zero warnings)
- Prettier formatting
- All tests pass

## Dependencies

| Package    | Purpose                | Approved |
| ---------- | ---------------------- | -------- |
| simple-git | Git operations via CLI | [x]      |
| execa      | Process spawning       | [x]      |

**Install command**: `pnpm add simple-git execa`

## Documentation Updates

### Files to Update

| File                   | Changes Required                                 |
| ---------------------- | ------------------------------------------------ |
| `AGENTS.md`            | Add services directory structure description     |
| `docs/ARCHITECTURE.md` | Add services layer details, abstraction diagrams |

### New Documentation Required

| File                     | Purpose                                       |
| ------------------------ | --------------------------------------------- |
| `src/services/README.md` | Services API documentation and usage examples |

## Definition of Done

- [ ] All implementation steps complete (TDD: tests written before implementation)
- [ ] `pnpm validate:fix` passes (0 errors, 0 warnings, all tests green)
- [ ] `IWorkspaceProvider` abstraction allows future implementations
- [ ] `IGitClient` abstraction allows swapping simple-git
- [ ] Main directory excluded from workspace discovery
- [ ] All services work without Electron dependencies
- [ ] Error serialization works for IPC
- [ ] Documentation updated
- [ ] Changes committed

---

## Appendix: Key Design Decisions

### Why Exclude Main Directory from Workspaces?

From `docs/ARCHITECTURE.md`:

> The main git directory is the **PROJECT** (container, not viewable). Only git worktrees are **WORKSPACES** (viewable in code-server).

This means:

- Opening `~/projects/myrepo` → PROJECT (not a workspace)
- Worktrees like `~/.local/share/codehydra/.../workspaces/feature` → WORKSPACE

Users work in worktrees, not the main directory. This keeps the main directory clean and avoids conflicts.

### Why Two Abstraction Layers?

1. **IWorkspaceProvider** - High-level abstraction
   - Allows different workspace strategies (not just git worktrees)
   - Future: could support plain directories, docker containers, etc.
   - API uses domain terms: "workspace", "base", "isDirty"

2. **IGitClient** - Low-level git abstraction
   - Allows swapping git libraries (simple-git → nodegit → isomorphic-git)
   - Isolates library-specific quirks
   - API uses git terms: "worktree", "branch", "status"

### Naming Convention: "Base" vs "Branch"

We use "base" instead of "branch" in the `IWorkspaceProvider` interface because:

- It's more generic (could apply to non-git implementations)
- It represents "what to base the new workspace on"
- The git-specific term "branch" is used in `IGitClient`

### Platform Path Strategy

| Platform       | Data Root                                  | Detection                       |
| -------------- | ------------------------------------------ | ------------------------------- |
| Development    | `./app-data/`                              | `NODE_ENV !== 'production'`     |
| Linux (prod)   | `~/.local/share/codehydra/`                | `process.platform === 'linux'`  |
| macOS (prod)   | `~/Library/Application Support/Codehydra/` | `process.platform === 'darwin'` |
| Windows (prod) | `%APPDATA%\Codehydra\`                     | `process.platform === 'win32'`  |

Projects directory is **shared across versions** so projects persist through updates.

### Port Finding Strategy

Use Node.js built-in `net` module - no external dependency needed:

```typescript
import { createServer } from "net";

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}
```

This is cross-platform (Linux, macOS, Windows) and reliable.

### Error Serialization for IPC

Errors must cross process boundaries (main ↔ renderer). Strategy:

1. All service errors extend `ServiceError` with `toJSON()` method
2. Serialized format: `{ type: 'git' | 'workspace' | ..., message: string, code?: string }`
3. Type guard `isServiceError()` for runtime checking
4. `ServiceError.fromJSON()` for deserialization

### Test Organization

- **Unit tests**: Co-located with source, mock external dependencies
- **Integration tests**:
  - `*.integration.test.ts` naming convention
  - Use real git CLI, real filesystem
  - `SimpleGitClient` only has integration tests (tests the adapter with real git)
  - `GitWorktreeProvider` has unit tests with mocked `IGitClient`
- **Test utilities**: Shared helpers in `test-utils.ts` for temp repos and cleanup
