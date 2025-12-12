---
status: COMPLETED
last_updated: 2025-12-12
reviewers:
  [review-typescript, review-electron, review-arch, review-senior, review-testing, review-docs]
---

# WORKSPACE_DELETION_CLEANUP

## Overview

- **Problem**: When deleting a workspace, `git worktree remove --force` can fail if code-server has files locked in the directory. This causes the entire deletion to fail, leaving users stuck. Additionally, if git unregisters the worktree but fails to delete the directory, orphaned directories accumulate in app-data.

- **Solution**:
  1. Make workspace removal resilient - if `git worktree remove` fails but the worktree was successfully unregistered, proceed with closing the workspace (directory will be cleaned up on next startup)
  2. Add startup cleanup in `AppState.openProject()` that scans for orphaned workspace directories and removes them (non-blocking)

- **Risks**:
  - Accidental deletion of valid directories → Mitigated by checking `git worktree list` AND re-checking before each deletion
  - Symlink attacks → Mitigated by skipping symlinks during cleanup
  - Path traversal → Mitigated by validating paths stay within workspacesDir
  - Cleanup fails silently forever → Acceptable, retries on each startup; logged for observability

- **Alternatives Considered**:
  - Force-kill code-server processes before deletion → Too aggressive, would disrupt user work
  - Separate WorkspaceDeletionService → Overkill for simple logic, integrated into GitWorktreeProvider instead
  - Add `isWorktreeRegistered()` to IGitClient → Unnecessary, `listWorktrees()` already provides this info

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DELETION FLOW (IMPROVED)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  User clicks Delete                                                          │
│        │                                                                     │
│        ▼                                                                     │
│  Dialog: isSubmitting=true (button shows "Removing...", inputs disabled)     │
│        │                                                                     │
│        ▼                                                                     │
│  workspace-handlers.ts → provider.removeWorkspace()                          │
│        │                                                                     │
│        ▼                                                                     │
│  GitWorktreeProvider.removeWorkspace()                                       │
│        │                                                                     │
│        ├──► gitClient.removeWorktree() [git worktree remove --force]         │
│        │           │                                                         │
│        │    ┌──────┴──────┐                                                  │
│        │    │             │                                                  │
│        │  success      error                                                 │
│        │    │             │                                                  │
│        │    │             ▼                                                  │
│        │    │    gitClient.listWorktrees() → check if still registered       │
│        │    │             │                                                  │
│        │    │      ┌──────┴──────┐                                           │
│        │    │      │             │                                           │
│        │    │   not found      found                                         │
│        │    │  (unregistered)  (still registered)                            │
│        │    │      │             │                                           │
│        │    │      ▼             ▼                                           │
│        │    │   log warning   re-throw error                                 │
│        │    │   & continue    (show in dialog)                               │
│        │    │      │                                                         │
│        └────┴──────┘                                                         │
│                 │                                                            │
│                 ▼                                                            │
│  Delete branch (if requested), prune worktrees                               │
│                 │                                                            │
│                 ▼                                                            │
│  Return success → appState.removeWorkspace() → closeDialog()                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                        STARTUP CLEANUP FLOW                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  AppState.openProject(projectPath)                                           │
│        │                                                                     │
│        ▼                                                                     │
│  Create GitWorktreeProvider (with FileSystemLayer)                           │
│        │                                                                     │
│        ▼                                                                     │
│  void provider.cleanupOrphanedWorkspaces()  ◄── NON-BLOCKING (fire & forget) │
│        │                                                                     │
│        ├──► gitClient.listWorktrees() → get registered paths                 │
│        │                                                                     │
│        ├──► fileSystemLayer.readdir(workspacesDir)                           │
│        │                                                                     │
│        ▼                                                                     │
│  For each entry in workspacesDir:                                            │
│        │                                                                     │
│        ├──► Skip if not directory OR is symlink (security)                   │
│        │                                                                     │
│        ├──► Skip if path escapes workspacesDir (security)                    │
│        │                                                                     │
│        ├──► Re-check: listWorktrees() to prevent TOCTOU race                 │
│        │                                                                     │
│        ├──► Skip if now registered (concurrent creation)                     │
│        │                                                                     │
│        ▼                                                                     │
│  fileSystemLayer.rm(orphanDir, { recursive: true, force: true })             │
│  (catch errors, log warning, continue to next)                               │
│        │                                                                     │
│        ▼                                                                     │
│  Return CleanupResult { removedCount, failedPaths }                          │
│                                                                              │
│  Continue with discover() and rest of openProject() (in parallel)            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Implementation Steps

Note: Each step follows TDD - write failing test first, then implement.

- [x] **Step 1: Add path normalization helper to GitWorktreeProvider**
  - Add private method: `private normalizeWorktreePath(p: string): string`
  - Implementation: `return path.normalize(p).replace(/[/\\]$/, '');`
  - Import `path` from `node:path`
  - Files: `src/services/git/git-worktree-provider.ts`
  - TDD: Write test first in `git-worktree-provider.test.ts` verifying normalization behavior

- [x] **Step 2: Add CleanupResult type**
  - Add to `src/services/git/types.ts`:
    ```typescript
    export interface CleanupResult {
      removedCount: number;
      failedPaths: Array<{ path: string; error: string }>;
    }
    ```
  - Files: `src/services/git/types.ts`
  - Test: Type-only, no test needed

- [x] **Step 3: Inject FileSystemLayer into GitWorktreeProvider (required parameter)**
  - Add `fileSystemLayer: FileSystemLayer` as required 4th parameter to constructor
  - Import `FileSystemLayer` from `../platform/filesystem`
  - Update `GitWorktreeProvider.create()` factory to accept required `fileSystemLayer` parameter
  - Update `createGitWorktreeProvider()` helper to accept and pass through `fileSystemLayer`
  - Files: `src/services/git/git-worktree-provider.ts`, `src/services/git/index.ts` (or wherever factory is)
  - TDD: Update existing tests to pass mock FileSystemLayer; verify it's stored correctly

- [x] **Step 4: Update removeWorkspace() to handle directory deletion failures**
  - Wrap `gitClient.removeWorktree()` in try-catch
  - On error: call `gitClient.listWorktrees()` and check if workspacePath is still registered
  - Use `normalizeWorktreePath()` for path comparison: `worktrees.some(wt => this.normalizeWorktreePath(wt.path) === this.normalizeWorktreePath(workspacePath))`
  - If NOT found (unregistered): log warning and continue
  - If still found (registered): re-throw the original error
  - Log format: `console.warn(\`Worktree unregistered but directory remains: ${workspacePath}. Will be cleaned up on next startup.\`)`
  - Files: `src/services/git/git-worktree-provider.ts`
  - TDD:
    1. Write failing test: `removeWorkspace succeeds when unregistered after error`
    2. Write failing test: `removeWorkspace throws when still registered after error`
    3. Implement to make tests pass

- [x] **Step 5: Add cleanupOrphanedWorkspaces() method to GitWorktreeProvider**
  - Add method with JSDoc:
    ```typescript
    /**
     * Removes workspace directories that are not registered with git.
     * Handles cases where `git worktree remove` unregistered a worktree
     * but failed to delete its directory (e.g., due to locked files).
     *
     * Runs at project startup (non-blocking). Errors are logged but not thrown,
     * allowing cleanup to retry on next startup.
     *
     * Security: Skips symlinks and validates paths stay within workspacesDir.
     *
     * @returns Result indicating how many directories were removed and any failures
     */
    async cleanupOrphanedWorkspaces(): Promise<CleanupResult>
    ```
  - Implementation:
    1. Get registered worktrees: `const worktrees = await this.gitClient.listWorktrees(this.projectRoot)`
    2. Build normalized path set: `const registeredPaths = new Set(worktrees.map(wt => this.normalizeWorktreePath(wt.path)))`
    3. Read workspacesDir: `const entries = await this.fileSystemLayer.readdir(this.workspacesDir)` (catch ENOENT → return early with empty result)
    4. For each entry:
       - Skip if `!entry.isDirectory()` (files)
       - Skip if `entry.isSymbolicLink?.()` (symlinks - security)
       - Build fullPath: `path.join(this.workspacesDir, entry.name)`
       - Validate path: skip if `!this.normalizeWorktreePath(fullPath).startsWith(this.normalizeWorktreePath(this.workspacesDir))`
       - Skip if in registeredPaths
       - **Re-check before delete (TOCTOU protection)**: `const currentWorktrees = await this.gitClient.listWorktrees(this.projectRoot)`; skip if now registered
       - Try `await this.fileSystemLayer.rm(fullPath, { recursive: true, force: true })`
       - Catch errors: log warning, add to failedPaths, continue
    5. Return `{ removedCount, failedPaths }`
  - Files: `src/services/git/git-worktree-provider.ts`
  - TDD: Write failing tests first for each behavior (see Testing Strategy)

- [x] **Step 6: Add concurrency guard to cleanupOrphanedWorkspaces()**
  - Add private field: `private cleanupInProgress = false`
  - At method start: if `cleanupInProgress`, return early with `{ removedCount: 0, failedPaths: [] }`
  - Set `cleanupInProgress = true` before work, reset in `finally` block
  - Files: `src/services/git/git-worktree-provider.ts`
  - TDD: Write test that concurrent calls return early

- [x] **Step 7: Update AppState to inject FileSystemLayer and call cleanup**
  - Import `DefaultFileSystemLayer` from `../services/platform/filesystem`
  - In `openProject()`, create FileSystemLayer: `const fileSystemLayer = new DefaultFileSystemLayer()`
  - Pass to `createGitWorktreeProvider(projectPath, workspacesDir, fileSystemLayer)`
  - After creating provider, call cleanup **non-blocking**:
    ```typescript
    void provider
      .cleanupOrphanedWorkspaces()
      .catch((err) => console.error("Workspace cleanup failed:", err));
    ```
  - Files: `src/main/app-state.ts`
  - TDD: Write test that openProject continues even if cleanup throws

- [x] **Step 8: Update documentation**
  - Update `docs/ARCHITECTURE.md`:
    - In "Services → Git" section (or create if needed): document `cleanupOrphanedWorkspaces()` method
    - Document resilient deletion behavior in workspace removal
    - Add note about non-blocking startup cleanup
  - Files: `docs/ARCHITECTURE.md`

- [x] **Step 9: Run validation and fix any issues**
  - Run `npm run validate:fix`
  - Ensure all tests pass

## Testing Strategy

### Unit Tests (vitest)

Follow TDD: write each test BEFORE implementing the corresponding feature.

| Test Case                                                                   | Description                                                                                      | File                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------- |
| `normalizeWorktreePath should remove trailing slashes`                      | `/path/workspace/` → `/path/workspace`                                                           | `git-worktree-provider.test.ts` |
| `normalizeWorktreePath should handle mixed separators`                      | Normalize `./` and `../`                                                                         | `git-worktree-provider.test.ts` |
| `removeWorkspace should succeed when unregistered after error`              | Mock removeWorktree error + listWorktrees returns empty → returns success                        | `git-worktree-provider.test.ts` |
| `removeWorkspace should throw when still registered after error`            | Mock removeWorktree error + listWorktrees returns workspace → throws                             | `git-worktree-provider.test.ts` |
| `removeWorkspace should log warning on partial success`                     | Verify console.warn called with correct message                                                  | `git-worktree-provider.test.ts` |
| `cleanupOrphanedWorkspaces should remove orphaned directories`              | Mock fs with extra dirs not in worktree list → rm called with `{ recursive: true, force: true }` | `git-worktree-provider.test.ts` |
| `cleanupOrphanedWorkspaces should skip registered workspaces`               | Mock fs with dirs that ARE in worktree list → rm NOT called                                      | `git-worktree-provider.test.ts` |
| `cleanupOrphanedWorkspaces should skip symlinks`                            | Mock entry with `isSymbolicLink: true` → rm NOT called                                           | `git-worktree-provider.test.ts` |
| `cleanupOrphanedWorkspaces should skip files`                               | Mock entry with `isDirectory: false` → rm NOT called                                             | `git-worktree-provider.test.ts` |
| `cleanupOrphanedWorkspaces should validate paths stay within workspacesDir` | Mock entry name `../../../etc` → rm NOT called                                                   | `git-worktree-provider.test.ts` |
| `cleanupOrphanedWorkspaces should re-check registration before delete`      | Mock first listWorktrees returns empty, second returns workspace → rm NOT called                 | `git-worktree-provider.test.ts` |
| `cleanupOrphanedWorkspaces should return CleanupResult with counts`         | Verify removedCount and failedPaths populated correctly                                          | `git-worktree-provider.test.ts` |
| `cleanupOrphanedWorkspaces should fail silently on rm error`                | Mock rm to throw → no exception propagates, error in failedPaths                                 | `git-worktree-provider.test.ts` |
| `cleanupOrphanedWorkspaces should fail silently when listWorktrees throws`  | Mock listWorktrees to throw → returns empty result, no exception                                 | `git-worktree-provider.test.ts` |
| `cleanupOrphanedWorkspaces should handle missing workspacesDir`             | Mock readdir ENOENT → returns empty result                                                       | `git-worktree-provider.test.ts` |
| `cleanupOrphanedWorkspaces should handle empty workspacesDir`               | Mock readdir returns [] → returns empty result                                                   | `git-worktree-provider.test.ts` |
| `cleanupOrphanedWorkspaces should return early if already in progress`      | Call twice concurrently → second returns immediately with empty result                           | `git-worktree-provider.test.ts` |
| `cleanupOrphanedWorkspaces should normalize paths when comparing`           | Mock worktree with trailing slash, dir without → NOT deleted                                     | `git-worktree-provider.test.ts` |
| `openProject should continue if cleanupOrphanedWorkspaces fails`            | Mock cleanup to throw → project still opens                                                      | `app-state.test.ts`             |

### Integration Tests

| Test Case                                   | Description                                                           | File                                                   |
| ------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------ |
| `openProject cleans up orphaned workspaces` | Create orphan dir in temp workspacesDir, open project, verify deleted | `git-worktree-provider.test.ts` or `app-state.test.ts` |

### Manual Testing Checklist

- [ ] Delete a workspace while code-server has files open - should succeed, workspace disappears from UI
- [ ] Restart app after failed deletion - orphaned directory should be cleaned up on project load
- [ ] Delete a workspace normally (no lock) - should work as before
- [ ] Open a project with orphaned workspace directories - should clean them up silently
- [ ] Verify app startup is not blocked by cleanup (UI responsive immediately)

## Dependencies

No new dependencies required.

| Package | Purpose                                      | Approved |
| ------- | -------------------------------------------- | -------- |
| (none)  | Uses existing FileSystemLayer and simple-git | N/A      |

## Documentation Updates

### Files to Update

| File                   | Changes Required                                                                                                                                                                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/ARCHITECTURE.md` | Add "Workspace Cleanup" subsection in Services section documenting: (1) `cleanupOrphanedWorkspaces()` purpose and behavior, (2) resilient deletion - succeeds if worktree unregistered even if directory remains, (3) non-blocking startup cleanup, (4) security measures (symlink/path validation) |

### New Documentation Required

None required.

## Definition of Done

- [ ] All implementation steps complete
- [ ] `npm run validate:fix` passes
- [ ] Documentation updated
- [ ] User acceptance testing passed
- [ ] Changes committed

## Technical Notes

### Git Worktree Remove Behavior

`git worktree remove --force` operates in this order:

1. **Unregister**: Remove entry from `$GIT_DIR/worktrees/<name>/`
2. **Remove .git file**: Delete the `.git` file from worktree directory
3. **Delete directory**: Remove the worktree directory itself

If step 3 fails (e.g., permission denied due to locked files), steps 1 and 2 have already completed. This leaves:

- Directory exists on disk
- NOT in `git worktree list` output
- No `.git` file in directory
- Safe to delete with `rm -rf`

### Path Normalization

Consistent path normalization is critical for correct comparison. Use this pattern everywhere:

```typescript
private normalizeWorktreePath(p: string): string {
  return path.normalize(p).replace(/[/\\]$/, '');
}
```

This handles:

- Trailing slashes: `/path/workspace/` → `/path/workspace`
- Relative components: `/path/./workspace/../workspace` → `/path/workspace`
- Mixed separators (Windows): `path\\workspace` → `path/workspace`

### Security Considerations

1. **Symlink attacks**: Never follow symlinks during cleanup. A malicious symlink could point to system directories.
2. **Path traversal**: Validate that constructed paths stay within workspacesDir. Entry names like `../../../etc` must be rejected.
3. **TOCTOU races**: Re-check worktree registration immediately before each deletion to prevent deleting newly-created workspaces.

### Code Example: removeWorkspace Error Handling

```typescript
async removeWorkspace(workspacePath: string, deleteBase: boolean): Promise<RemovalResult> {
  // ... validation ...

  // Get branch name before removal
  const worktrees = await this.gitClient.listWorktrees(this.projectRoot);
  const worktree = worktrees.find(wt =>
    this.normalizeWorktreePath(wt.path) === this.normalizeWorktreePath(workspacePath)
  );
  const branchName = worktree?.branch;

  // Remove the worktree - handle partial failures
  try {
    await this.gitClient.removeWorktree(this.projectRoot, workspacePath);
  } catch (error) {
    // Check if worktree was unregistered despite error
    const currentWorktrees = await this.gitClient.listWorktrees(this.projectRoot);
    const stillRegistered = currentWorktrees.some(wt =>
      this.normalizeWorktreePath(wt.path) === this.normalizeWorktreePath(workspacePath)
    );

    if (stillRegistered) {
      throw error; // Truly failed - still registered
    }

    // Unregistered but directory remains - log and continue
    console.warn(
      `Worktree unregistered but directory remains: ${workspacePath}. ` +
      `Will be cleaned up on next startup.`
    );
  }

  // ... prune and delete branch ...
}
```
