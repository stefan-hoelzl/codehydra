---
status: COMPLETED
last_updated: 2025-12-15
reviewers: [review-typescript, review-arch, review-testing, review-docs]
---

# WORKSPACE_METADATA

## Overview

- **Problem**: The current implementation only stores `baseBranch` in git config. Users and future features may need arbitrary key/value metadata per workspace (e.g., notes, tags, last AI model used).
- **Solution**: Refactor `baseBranch` to be a regular metadata key (`base`) within a general-purpose `metadata: Record<string, string>` property on Workspace.
- **Risks**:
  - Git config key restrictions (no underscores, must start with letter) - mitigated by validation
  - Breaking change to Workspace type - mitigated by updating all consumers
- **Alternatives Considered**:
  - JSON file per workspace: Rejected - git config already works, keeps data in repo
  - Separate metadata service: Rejected - overengineered for current needs

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Git Repository                                │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                     .git/config                              │    │
│  │                                                              │    │
│  │  [branch "feature-x"]                                        │    │
│  │      codehydra.base = main           ← base branch           │    │
│  │      codehydra.note = WIP auth       ← arbitrary metadata    │    │
│  │      codehydra.model = claude-4      ← future use            │    │
│  │                                                              │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                       Data Flow                                      │
│                                                                      │
│  ┌──────────────┐     ┌───────────────────┐     ┌────────────────┐  │
│  │  IGitClient  │────►│ GitWorktreeProvider│────►│   Workspace    │  │
│  │              │     │                   │     │                │  │
│  │ getBranchConfigsByPrefix()             │     │ metadata: {    │  │
│  │ setBranchConfig()│ discover()          │     │   base: "main",│  │
│  │ unsetBranchConfig()│ setMetadata()     │     │   note: "WIP"  │  │
│  └──────────────┘     └───────────────────┘     │ }              │  │
│                                                 └────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### Metadata Key Validation

Git config subsection keys (after the second dot) can contain almost any character, but we restrict keys to `/^[A-Za-z][A-Za-z0-9-]*$/` for:

- Consistency with git config section name rules
- Avoiding shell escaping issues
- Simpler parsing

**Valid keys**: `base`, `note`, `model-name`, `AI-model`
**Invalid keys**: `_private` (leading underscore), `my_key` (underscore), `123note` (starts with digit), `note-` (trailing hyphen)

### Fallback Logic Centralization

The `base` fallback (`config.base ?? branch ?? name`) is applied ONLY in provider methods (`discover()` and `getMetadata()`). Consumers of `Workspace.metadata` should NOT replicate the fallback - they receive metadata with `base` already resolved.

**Rationale**: Fallback is a discovery-time concern. Centralizing it prevents divergence and ensures consistent behavior.

### Metadata Deletion

To delete a metadata key, call `setMetadata()` with `value: null`. This calls `unsetBranchConfig()` internally. Empty string `""` is a valid value (not deletion).

## Files Affected

### Service Layer

- `src/services/git/git-client.ts` - Add interface methods
- `src/services/git/simple-git-client.ts` - Implement new methods
- `src/services/git/simple-git-client.boundary.test.ts` - Boundary tests
- `src/services/git/types.ts` - Update Workspace type
- `src/services/git/workspace-provider.ts` - Add interface methods
- `src/services/git/git-worktree-provider.ts` - Implement new methods
- `src/services/git/git-worktree-provider.test.ts` - Unit tests
- `src/services/git/git-worktree-provider.integration.test.ts` - Integration tests

### Shared Layer

- `src/shared/api/types.ts` - Update Workspace type, add validation
- `src/shared/api/interfaces.ts` - Add API methods, event type
- `src/shared/ipc.ts` - Add IPC channel constants (NOT CreateWorkspacePayload - that stays as `baseBranch`)

### Main Process

- `src/main/api/codehydra-api.ts` - Implement API methods
- `src/main/api/codehydra-api.test.ts` - Unit tests
- `src/main/ipc/api-handlers.ts` - Add IPC handlers
- `src/main/ipc/api-handlers.test.ts` - Unit tests

### Renderer/Preload

- `src/preload/index.ts` - Add API methods
- `src/preload/index.test.ts` - Unit tests
- `src/renderer/lib/api/index.ts` - Add API methods

### Test Fixtures

- `src/main/api/test-utils.ts`
- `src/renderer/lib/test-fixtures.ts`
- `src/renderer/lib/utils/domain-events.test.ts`
- `src/renderer/lib/integration.test.ts`

### Documentation

- `docs/ARCHITECTURE.md`

## Implementation Steps

### Phase 1: GitClient Interface Extensions

- [x] **Step 1: Write failing tests for `getBranchConfigsByPrefix()`**
  - Add unit tests in `simple-git-client.test.ts`:
    - `getBranchConfigsByPrefix parses git output correctly`
    - `getBranchConfigsByPrefix returns empty object when no configs`
    - `getBranchConfigsByPrefix handles values with spaces`
    - `getBranchConfigsByPrefix handles values with equals signs`
  - Files: `src/services/git/simple-git-client.test.ts`
  - Test criteria: Tests fail (RED)

- [x] **Step 2: Add `getBranchConfigsByPrefix()` and `unsetBranchConfig()` to IGitClient**
  - Add method signatures:
    ```typescript
    getBranchConfigsByPrefix(repoPath: string, branch: string, prefix: string): Promise<Readonly<Record<string, string>>>;
    unsetBranchConfig(repoPath: string, branch: string, key: string): Promise<void>;
    ```
  - Returns all config values under `branch.<branch>.<prefix>.*`
  - Example: prefix `codehydra` returns `{ base: "main", note: "WIP" }` (keys without prefix)
  - Add JSDoc with parameter descriptions, throws, and examples
  - Files: `src/services/git/git-client.ts`
  - Test criteria: Interface compiles

- [x] **Step 3: Implement `getBranchConfigsByPrefix()` and `unsetBranchConfig()` in SimpleGitClient**
  - Use `git config --get-regexp` to get all matching keys
  - Parse output format: `branch.<branch>.codehydra.<key> <value>` (value is everything after first space)
  - Handle edge cases: empty output, values with spaces, values with `=`
  - `unsetBranchConfig()` uses `git config --unset`
  - Files: `src/services/git/simple-git-client.ts`
  - Test criteria: Unit tests pass (GREEN)

- [x] **Step 4: Write and run boundary tests for new GitClient methods**
  - Add tests in `simple-git-client.boundary.test.ts`:
    - `getBranchConfigsByPrefix returns all codehydra.* configs`
    - `getBranchConfigsByPrefix handles special characters in values`
    - `getBranchConfigsByPrefix handles empty result when no configs`
    - `getBranchConfigsByPrefix handles git command failure (non-existent repo)`
    - `unsetBranchConfig removes config key`
    - `unsetBranchConfig handles non-existent key gracefully`
  - Files: `src/services/git/simple-git-client.boundary.test.ts`
  - Test criteria: Boundary tests pass

### Phase 2: Shared Types and Validation

- [x] **Step 5: Add metadata key validation to shared types**
  - Add to `src/shared/api/types.ts`:
    ```typescript
    export const METADATA_KEY_REGEX = /^[A-Za-z][A-Za-z0-9-]*$/;
    export function isValidMetadataKey(key: string): boolean {
      return (
        key.length > 0 && key.length <= 64 && METADATA_KEY_REGEX.test(key) && !key.endsWith("-")
      );
    }
    ```
  - Add tests in `src/shared/api/types.test.ts`:
    - `isValidMetadataKey accepts valid keys (base, note, model-name)`
    - `isValidMetadataKey rejects underscore keys`
    - `isValidMetadataKey rejects leading digit`
    - `isValidMetadataKey rejects empty key`
    - `isValidMetadataKey rejects trailing hyphen`
    - `isValidMetadataKey rejects keys over 64 chars`
  - Files: `src/shared/api/types.ts`, `src/shared/api/types.test.ts`
  - Test criteria: Validation tests pass

- [x] **Step 6: Update Workspace type - replace `baseBranch` with `metadata`**
  - Change `baseBranch: string` to `metadata: Readonly<Record<string, string>>` in:
    - `src/services/git/types.ts` (service layer)
    - `src/shared/api/types.ts` (API layer)
  - Add JSDoc: "Metadata always contains `base` key after fallback is applied"
  - **Note**: `CreateWorkspacePayload.baseBranch` in `src/shared/ipc.ts` stays unchanged (creation input)
  - Files: `src/services/git/types.ts`, `src/shared/api/types.ts`
  - Test criteria: TypeScript compilation fails (expected - consumers need updating)

- [x] **Step 7: Add `workspace:metadata-changed` event to ApiEvents**
  - Add to `src/shared/api/interfaces.ts`:
    ```typescript
    "workspace:metadata-changed": (event: {
      readonly projectId: ProjectId;
      readonly workspaceName: WorkspaceName;
      readonly key: string;
      readonly value: string | null; // null means deleted
    }) => void;
    ```
  - Add IPC channel constants to `src/shared/ipc.ts`:
    ```typescript
    WORKSPACE_SET_METADATA: "api:workspace:set-metadata",
    WORKSPACE_GET_METADATA: "api:workspace:get-metadata",
    ```
  - Files: `src/shared/api/interfaces.ts`, `src/shared/ipc.ts`
  - Test criteria: Interface compiles

### Phase 3: Provider Implementation

- [x] **Step 8: Write failing tests for GitWorktreeProvider metadata methods**
  - Add unit tests in `git-worktree-provider.test.ts`:
    - `discover returns metadata with base from config`
    - `discover returns metadata with base fallback to branch when no config`
    - `discover returns metadata with base fallback to name when no branch`
    - `discover returns full metadata from config (multiple keys)`
    - `createWorkspace returns metadata.base`
    - `setMetadata validates key format (rejects invalid)`
    - `setMetadata calls setBranchConfig correctly`
    - `setMetadata with null value calls unsetBranchConfig`
    - `getMetadata applies base fallback`
    - `getMetadata returns all metadata keys`
  - Files: `src/services/git/git-worktree-provider.test.ts`
  - Test criteria: Tests fail (RED)

- [x] **Step 9: Add setMetadata() and getMetadata() to IWorkspaceProvider**
  - Add to interface:

    ```typescript
    /**
     * Set a metadata value for a workspace.
     * @param workspacePath Absolute path to the workspace
     * @param key Metadata key (must match /^[A-Za-z][A-Za-z0-9-]*$/)
     * @param value Value to set, or null to delete the key
     * @throws WorkspaceError with code "INVALID_METADATA_KEY" if key format invalid
     */
    setMetadata(workspacePath: string, key: string, value: string | null): Promise<void>;

    /**
     * Get all metadata for a workspace.
     * Always includes `base` key (with fallback if not in config).
     * @param workspacePath Absolute path to the workspace
     * @returns Metadata record with at least `base` key
     */
    getMetadata(workspacePath: string): Promise<Readonly<Record<string, string>>>;
    ```

  - Files: `src/services/git/workspace-provider.ts`
  - Test criteria: Interface compiles

- [x] **Step 10: Implement metadata methods in GitWorktreeProvider**
  - Add private helper method:
    ```typescript
    private applyBaseFallback(
      metadata: Record<string, string>,
      branch: string | null,
      name: string
    ): Record<string, string> {
      if (!metadata.base) {
        return { ...metadata, base: branch ?? name };
      }
      return metadata;
    }
    ```
  - Update `discover()`:
    - Replace `getBranchConfig()` with `getBranchConfigsByPrefix("codehydra")`
    - Apply `applyBaseFallback()` to result
    - Return `metadata` instead of `baseBranch`
  - Update `createWorkspace()`:
    - Return `metadata: { base: baseBranch }` instead of `baseBranch`
  - Implement `setMetadata()`:
    - Validate key with `isValidMetadataKey()` from shared types
    - Throw `WorkspaceError` with code `"INVALID_METADATA_KEY"` if invalid
    - Get branch name from worktree list
    - If `value` is null, call `unsetBranchConfig()`
    - Otherwise call `setBranchConfig(projectRoot, branch, 'codehydra.' + key, value)`
  - Implement `getMetadata()`:
    - Get branch name from worktree list
    - Call `getBranchConfigsByPrefix(projectRoot, branch, 'codehydra')`
    - Apply `applyBaseFallback()` to result
  - Files: `src/services/git/git-worktree-provider.ts`
  - Test criteria: Unit tests pass (GREEN)

### Phase 4: API Layer

- [x] **Step 11: Write failing tests for CodeHydraApiImpl metadata methods**
  - Add unit tests in `codehydra-api.test.ts`:
    - `setMetadata resolves projectId and delegates to provider`
    - `setMetadata emits workspace:metadata-changed event`
    - `setMetadata throws when projectId not found`
    - `getMetadata resolves projectId and returns provider result`
    - `getMetadata throws when workspace not found`
  - Files: `src/main/api/codehydra-api.test.ts`
  - Test criteria: Tests fail (RED)

- [x] **Step 12: Update IWorkspaceApi interface with setMetadata/getMetadata**
  - Add methods to `src/shared/api/interfaces.ts`:
    ```typescript
    setMetadata(projectId: ProjectId, workspaceName: WorkspaceName, key: string, value: string | null): Promise<void>;
    getMetadata(projectId: ProjectId, workspaceName: WorkspaceName): Promise<Readonly<Record<string, string>>>;
    ```
  - Files: `src/shared/api/interfaces.ts`
  - Test criteria: Interface compiles

- [x] **Step 13: Implement setMetadata/getMetadata in CodeHydraApiImpl**
  - Resolve projectId → path, workspaceName → workspace path
  - Delegate to `provider.setMetadata()` / `provider.getMetadata()`
  - Emit `workspace:metadata-changed` event on setMetadata
  - Update workspace mapping to use `metadata` instead of `baseBranch`
  - Files: `src/main/api/codehydra-api.ts`
  - Test criteria: Unit tests pass (GREEN)

### Phase 5: IPC Layer

- [x] **Step 14: Write failing tests for IPC handlers**
  - Add unit tests in `api-handlers.test.ts`:
    - `api:workspace:set-metadata validates projectId format`
    - `api:workspace:set-metadata validates workspaceName format`
    - `api:workspace:set-metadata validates key format (rejects underscore)`
    - `api:workspace:set-metadata calls api.workspaces.setMetadata`
    - `api:workspace:get-metadata calls api.workspaces.getMetadata`
    - `api:workspace:set-metadata propagates ValidationError for invalid inputs`
  - Files: `src/main/ipc/api-handlers.test.ts`
  - Test criteria: Tests fail (RED)

- [x] **Step 15: Add IPC handlers for setMetadata/getMetadata**
  - Add handlers:
    - `api:workspace:set-metadata` → validate inputs, call `api.workspaces.setMetadata()`
    - `api:workspace:get-metadata` → validate inputs, call `api.workspaces.getMetadata()`
  - Validate projectId with `isProjectId()`, workspaceName with `isWorkspaceName()`, key with `isValidMetadataKey()`
  - Files: `src/main/ipc/api-handlers.ts`
  - Test criteria: Unit tests pass (GREEN)

- [x] **Step 16: Write failing tests for preload API**
  - Add unit tests in `preload/index.test.ts`:
    - `api.v2.workspaces.setMetadata calls ipcRenderer.invoke with correct channel`
    - `api.v2.workspaces.getMetadata returns parsed result from IPC`
  - Files: `src/preload/index.test.ts`
  - Test criteria: Tests fail (RED)

- [x] **Step 17: Update preload/renderer API for metadata**
  - Add to preload: `setMetadata()`, `getMetadata()`
  - Add to renderer `$lib/api`: same methods
  - Add `workspace:metadata-changed` event subscription
  - Files: `src/preload/index.ts`, `src/renderer/lib/api/index.ts`
  - Test criteria: Unit tests pass (GREEN), TypeScript compiles

### Phase 6: Consumer Migration

- [x] **Step 18: Update test fixtures first**
  - Update fixtures to use `metadata: { base: "..." }` instead of `baseBranch`:
    - `src/main/api/test-utils.ts`
    - `src/renderer/lib/test-fixtures.ts`
    - `src/renderer/lib/utils/domain-events.test.ts`
    - `src/renderer/lib/integration.test.ts`
  - Run `npm run check` to verify fixture changes
  - Files: Listed above
  - Test criteria: Fixtures updated, TypeScript errors guide remaining changes

- [x] **Step 19: Update all remaining `baseBranch` consumers**
  - Transform pattern: `workspace.baseBranch` → `workspace.metadata.base`
  - Files to update (verify with `npm run check`):
    - `src/main/api/codehydra-api.ts` (workspace mapping)
    - Any UI components accessing baseBranch
  - Verify: Run `npm run check` - should have zero `baseBranch` errors
  - Files: Multiple (guided by TypeScript errors)
  - Test criteria: All tests pass, no TypeScript errors

### Phase 7: Integration Tests

- [x] **Step 20: Add integration tests for metadata flow**
  - Add tests in `git-worktree-provider.integration.test.ts`:
    - `setMetadata persists and getMetadata retrieves`
    - `metadata survives provider recreation`
    - `base fallback applies in getMetadata for legacy workspace`
    - `invalid key format throws WorkspaceError with INVALID_METADATA_KEY code`
    - `setMetadata with null deletes the key`
    - `concurrent setMetadata calls for different keys both succeed`
  - Add test in `api-handlers.integration.test.ts`:
    - `setMetadata via IPC persists to git config and getMetadata via IPC retrieves it`
  - Files: `src/services/git/git-worktree-provider.integration.test.ts`, `src/main/ipc/api-handlers.integration.test.ts`
  - Test criteria: Integration tests pass

- [x] **Step 21: Add snapshot test for legacy migration**
  - Test with fixture repo that has old `codehydra.base` config (no other metadata)
  - Verify `discover()` returns it in `metadata.base`
  - Files: `src/services/git/git-worktree-provider.integration.test.ts`
  - Test criteria: Legacy migration test passes

### Phase 8: Documentation

- [x] **Step 22: Update documentation**
  - Update `docs/ARCHITECTURE.md`:
    - Change "Git Configuration Storage" section title to "Git Configuration Storage (Workspace Metadata)"
    - Update table to show general pattern: `branch.<name>.codehydra.<key>` with examples
    - Add "Metadata Key Restrictions" subsection documenting validation regex
    - Update fallback section to clarify it applies ONLY to `base` key
    - Add `workspace:metadata-changed` to API Events table with payload: `{ projectId, workspaceName, key, value }`
  - Files: `docs/ARCHITECTURE.md`
  - Test criteria: Documentation accurate and complete

- [x] **Step 23: Run full validation**
  - Run `npm run validate:fix`
  - Fix any remaining issues
  - Test criteria: All checks pass

## Testing Strategy

### Unit Tests (vitest)

| Test Case                                                       | Description                               | File                            |
| --------------------------------------------------------------- | ----------------------------------------- | ------------------------------- |
| `getBranchConfigsByPrefix parses git output correctly`          | Mock git config --get-regexp output       | `simple-git-client.test.ts`     |
| `getBranchConfigsByPrefix returns empty object when no configs` | Mock empty output                         | `simple-git-client.test.ts`     |
| `getBranchConfigsByPrefix handles values with spaces`           | Value parsing edge case                   | `simple-git-client.test.ts`     |
| `getBranchConfigsByPrefix handles values with equals signs`     | Value parsing edge case                   | `simple-git-client.test.ts`     |
| `unsetBranchConfig calls git config --unset`                    | Verify git command                        | `simple-git-client.test.ts`     |
| `isValidMetadataKey accepts valid keys`                         | Validation function                       | `types.test.ts`                 |
| `isValidMetadataKey rejects invalid keys`                       | Underscore, digit, empty, trailing hyphen | `types.test.ts`                 |
| `discover returns metadata with base from config`               | Config value used                         | `git-worktree-provider.test.ts` |
| `discover returns metadata with base fallback to branch`        | No config, has branch                     | `git-worktree-provider.test.ts` |
| `discover returns metadata with base fallback to name`          | No config, no branch                      | `git-worktree-provider.test.ts` |
| `discover returns full metadata from config`                    | Multiple keys                             | `git-worktree-provider.test.ts` |
| `createWorkspace returns metadata.base`                         | Verify return shape                       | `git-worktree-provider.test.ts` |
| `setMetadata validates key format`                              | Invalid keys throw                        | `git-worktree-provider.test.ts` |
| `setMetadata calls setBranchConfig correctly`                   | Verify mock call                          | `git-worktree-provider.test.ts` |
| `setMetadata with null calls unsetBranchConfig`                 | Deletion flow                             | `git-worktree-provider.test.ts` |
| `getMetadata applies base fallback`                             | No base config, verify fallback           | `git-worktree-provider.test.ts` |
| `setMetadata resolves projectId and delegates`                  | API layer                                 | `codehydra-api.test.ts`         |
| `setMetadata emits workspace:metadata-changed event`            | Event emission                            | `codehydra-api.test.ts`         |
| `getMetadata throws when workspace not found`                   | Error handling                            | `codehydra-api.test.ts`         |
| `api:workspace:set-metadata validates inputs`                   | IPC validation                            | `api-handlers.test.ts`          |
| `api:workspace:get-metadata calls API`                          | IPC delegation                            | `api-handlers.test.ts`          |
| `preload setMetadata calls ipcRenderer.invoke`                  | Preload layer                             | `preload/index.test.ts`         |

### Boundary Tests

| Test Case                                                       | Description       | File                                 |
| --------------------------------------------------------------- | ----------------- | ------------------------------------ |
| `getBranchConfigsByPrefix returns all codehydra.* configs`      | Real git repo     | `simple-git-client.boundary.test.ts` |
| `getBranchConfigsByPrefix handles special characters in values` | Spaces, quotes    | `simple-git-client.boundary.test.ts` |
| `getBranchConfigsByPrefix handles empty result`                 | No configs exist  | `simple-git-client.boundary.test.ts` |
| `getBranchConfigsByPrefix handles git command failure`          | Non-existent repo | `simple-git-client.boundary.test.ts` |
| `unsetBranchConfig removes config key`                          | Real deletion     | `simple-git-client.boundary.test.ts` |
| `unsetBranchConfig handles non-existent key`                    | Graceful handling | `simple-git-client.boundary.test.ts` |

### Integration Tests

| Test Case                                         | Description               | File                                        |
| ------------------------------------------------- | ------------------------- | ------------------------------------------- |
| `setMetadata persists and getMetadata retrieves`  | Full round-trip           | `git-worktree-provider.integration.test.ts` |
| `metadata survives provider recreation`           | New provider reads config | `git-worktree-provider.integration.test.ts` |
| `base fallback applies in getMetadata`            | Legacy workspace          | `git-worktree-provider.integration.test.ts` |
| `invalid key format throws WorkspaceError`        | Error code verification   | `git-worktree-provider.integration.test.ts` |
| `setMetadata with null deletes key`               | Deletion flow             | `git-worktree-provider.integration.test.ts` |
| `concurrent setMetadata calls succeed`            | Race condition check      | `git-worktree-provider.integration.test.ts` |
| `legacy codehydra.base migrates to metadata.base` | Snapshot test             | `git-worktree-provider.integration.test.ts` |
| `full IPC flow: set and get metadata`             | End-to-end                | `api-handlers.integration.test.ts`          |

### Manual Testing Checklist

- [ ] Create workspace with base branch "main" - verify `metadata.base` is "main"
- [ ] Create workspace from existing branch - verify `metadata.base` fallback works
- [ ] Close and reopen app - metadata persists
- [ ] Set custom metadata via console: `api.v2.workspaces.setMetadata(projectId, name, 'note', 'test')`
- [ ] Get metadata via console: verify custom key returned
- [ ] Delete metadata via console: `api.v2.workspaces.setMetadata(projectId, name, 'note', null)`
- [ ] Attempt invalid key (e.g., `my_key`) - verify error

## Dependencies

No new dependencies required.

## Documentation Updates

### Files to Update

| File                   | Changes Required                                                   |
| ---------------------- | ------------------------------------------------------------------ |
| `docs/ARCHITECTURE.md` | Update Git Configuration Storage section (see Step 22 for details) |

### New Documentation Required

None - existing docs updated in place.

## Definition of Done

- [ ] All implementation steps complete
- [ ] `npm run validate:fix` passes
- [ ] Documentation updated
- [ ] User acceptance testing passed
- [ ] Changes committed
