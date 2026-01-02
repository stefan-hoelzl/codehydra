---
status: COMPLETED
last_updated: 2026-01-02
reviewers: [review-testing, review-typescript, review-arch, review-docs, review-platform]
---

# FILESYSTEM_MOCK

## Overview

- **Problem**: The current `createMockFileSystemLayer()` is a call-tracking mock that returns static values. It doesn't maintain state, so tests can't verify behavioral outcomes like "file was created" or "directory structure matches expected".
- **Solution**: Migrate to a behavioral mock following the `mock.$` pattern with in-memory state that simulates real filesystem behavior.
- **Risks**:
  - Tests using the old mock will break (mitigated by deleting old mock and updating all usages in same PR)
  - Edge case behavior differences from real filesystem (mitigated by boundary tests defining the contract)
- **Alternatives Considered**:
  - Keep both old and new mocks → rejected (confusing, maintenance burden)
  - Add state to existing mock → rejected (cleaner to implement new pattern from scratch)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     MockFileSystemLayer                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────┐     ┌────────────────────────────────────────┐ │
│  │   FileSystemLayer   │     │      FileSystemMockState ($)           │ │
│  │     Interface       │     │                                         │ │
│  ├─────────────────────┤     │  entries: Map<string, Entry>           │ │
│  │ readFile()          │────►│    Entry = FileEntry                   │ │
│  │ writeFile()         │     │          | DirectoryEntry              │ │
│  │ mkdir()             │     │          | SymlinkEntry                │ │
│  │ readdir()           │     │                                         │ │
│  │ unlink()            │     │  + setEntry(path, entry)               │ │
│  │ rm()                │     │  + snapshot(): Snapshot                │ │
│  │ copyTree()          │     │  + toString(): string                  │ │
│  │ makeExecutable()    │     └────────────────────────────────────────┘ │
│  │ writeFileBuffer()   │                                                │
│  │ symlink()           │     Entry Types:                               │
│  │ rename()            │     ┌────────────────────────────────────────┐ │
│  └─────────────────────┘     │ FileEntry:                             │ │
│                              │   type: 'file'                         │ │
│                              │   content: string | Buffer             │ │
│                              │   executable?: boolean                 │ │
│                              │   error?: FileSystemErrorCode          │ │
│                              ├────────────────────────────────────────┤ │
│                              │ DirectoryEntry:                        │ │
│                              │   type: 'directory'                    │ │
│                              │   error?: FileSystemErrorCode          │ │
│                              ├────────────────────────────────────────┤ │
│                              │ SymlinkEntry:                          │ │
│                              │   type: 'symlink'                      │ │
│                              │   target: string                       │ │
│                              │   error?: FileSystemErrorCode          │ │
│                              └────────────────────────────────────────┘ │
│                                                                          │
│  Path Normalization: All paths normalized via Path class                │
│  - Keys stored as normalized strings via new Path(input).toString()     │
│  - Ensures cross-platform consistency (Windows backslashes, case)       │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                     Custom Vitest Matchers                              │
├─────────────────────────────────────────────────────────────────────────┤
│  expect(mock).toHaveFile(path, content?)                               │
│  expect(mock).toHaveDirectory(path)                                    │
│  expect(mock).toHaveFileContaining(path, pattern)                      │
│  expect(mock).toHaveSymlink(path, target?)                             │
│  expect(mock).toBeExecutable(path)                                     │
│  expect(mock).toBeUnchanged(snapshot)  ← from base MockWithState       │
└─────────────────────────────────────────────────────────────────────────┘
```

## Implementation Steps

- [x] **Step 1: Create entry types and state interface**
  - Create `src/services/platform/filesystem.state-mock.ts`
  - Define `FileEntry`, `DirectoryEntry`, `SymlinkEntry` types
  - Define `FileSystemMockState` interface extending `MockState`
  - Define `MockFileSystemLayer` type
  - Files affected: `src/services/platform/filesystem.state-mock.ts`

- [x] **Step 2: Implement entry helper functions**
  - Implement `file(content, options?)` helper using `as const` for literal types
  - Implement `directory(options?)` helper
  - Implement `symlink(target, options?)` helper
  - Files affected: `src/services/platform/filesystem.state-mock.ts`

- [x] **Step 3: Implement state class**
  - Implement `FileSystemMockStateImpl` class
  - Implement `entries` getter (readonly Map)
  - Implement `setEntry(path, entry)` - normalizes path via `new Path(input).toString()`, auto-creates parent directories for convenience
  - Implement `snapshot()` returning `Snapshot`
  - Implement `toString()` with sorted, deterministic output
  - Note: `setEntry` is a test helper that auto-creates parents. The FileSystemLayer methods follow real filesystem semantics.
  - Files affected: `src/services/platform/filesystem.state-mock.ts`

- [x] **Step 4: Implement createFileSystemMock factory**
  - Implement `createFileSystemMock(options?)` factory
  - Normalize all entry keys via `new Path(k).toString()` for consistent lookup
  - Files affected: `src/services/platform/filesystem.state-mock.ts`

- [x] **Step 5: Implement read methods**
  - Implement `readFile` - return content as string, throw ENOENT/EISDIR/configured error
  - Implement `readdir` - return DirEntry array with `isFile`, `isDirectory`, `isSymbolicLink`
  - Note: Mock does NOT follow symlinks on readFile (only supports absolute normalized targets)
  - Files affected: `src/services/platform/filesystem.state-mock.ts`

- [x] **Step 6: Implement write methods**
  - Implement `writeFile` - create/overwrite file, throw ENOENT if parent missing, EISDIR if path is directory
  - Implement `writeFileBuffer` - same as writeFile but stores Buffer
  - Implement `mkdir` - create directory, handle recursive option (recursive=true default)
  - Files affected: `src/services/platform/filesystem.state-mock.ts`

- [x] **Step 7: Implement delete methods**
  - Implement `unlink` - remove file, throw ENOENT/EISDIR
  - Implement `rm` - handle recursive/force options, throw ENOENT/ENOTEMPTY
  - Files affected: `src/services/platform/filesystem.state-mock.ts`

- [x] **Step 8: Implement utility methods**
  - Implement `copyTree` - deep copy files/dirs/symlinks, create dest parents, overwrite existing
  - Implement `symlink` - create symlink entry, remove existing symlink first
  - Implement `rename` - atomic move
  - Implement `makeExecutable` - set executable flag (no-op on Windows per `process.platform`)
  - Files affected: `src/services/platform/filesystem.state-mock.ts`

- [x] **Step 9: Implement custom matchers**
  - Implement `toHaveFile(path, content?)` - string comparison or `Buffer.equals()` for Buffer
  - Implement `toHaveDirectory(path)`
  - Implement `toHaveFileContaining(path, pattern)` - substring or regex match
  - Implement `toHaveSymlink(path, target?)`
  - Implement `toBeExecutable(path)`
  - Add Vitest type augmentation for matchers
  - Files affected: `src/services/platform/filesystem.state-mock.ts`

- [x] **Step 10: Register matchers**
  - Import and register filesystem matchers in setup-matchers.ts
  - Files affected: `src/test/setup-matchers.ts`

- [x] **Step 11: Identify affected test files**
  - Search for `createMockFileSystemLayer` and `createSpyFileSystemLayer` usages
  - Document the count and file paths
  - For each file, determine the conversion strategy (what entries are needed)
  - Files affected: None (research step)
  - **Findings**: 7 test files + 1 re-export file:
    - `src/services/vscode-setup/wrapper-script-generation-service.test.ts` (1 usage)
    - `src/services/vscode-setup/vscode-setup-service.test.ts` (37 usages)
    - `src/services/vscode-setup/extension-utils.test.ts` (15 usages)
    - `src/services/services.integration.test.ts` (1 usage)
    - `src/services/project/project-store.test.ts` (14 usages)
    - `src/services/keepfiles/keepfiles-service.test.ts` (8 usages)
    - `src/services/git/git-worktree-provider.test.ts` (12 usages)
    - `src/services/index.ts` (re-export - needs update)

- [x] **Step 12: Update existing tests to use new mock**
  - Update tests to use `createFileSystemMock` with appropriate entries
  - Replace call-tracking assertions with behavioral assertions using matchers
  - This step implicitly verifies the mock works correctly—if all tests pass, the mock properly replicates filesystem behavior
  - Files affected: All test files identified in Step 11

- [x] **Step 13: Delete old mock file**
  - Delete `src/services/platform/filesystem.test-utils.ts`
  - Files affected: `src/services/platform/filesystem.test-utils.ts`

- [x] **Step 14: Update documentation**
  - Update `docs/TESTING.md` with new filesystem mock example
  - Update `docs/PATTERNS.md` to replace old mock example with new behavioral mock
  - Update `docs/ARCHITECTURE.md` to reference new mock (also had reference to old mock)
  - Files affected: `docs/TESTING.md`, `docs/PATTERNS.md`, `docs/ARCHITECTURE.md`

## Testing Strategy

The mock is verified through:

1. **Contract verification**: Existing `filesystem.boundary.test.ts` defines the behavioral contract the mock must replicate
2. **Implicit verification**: Step 12 migrates all existing tests to use the new mock, which verifies it works correctly in real usage
3. **No dedicated test file**: Test infrastructure does not need its own test suite

### Manual Testing Checklist

- [ ] Create mock with files, verify `toHaveFile` passes
- [ ] Create mock with directories, verify `toHaveDirectory` passes
- [ ] Write file via mock method, verify state updated
- [ ] Configure error on entry, verify error thrown on access
- [ ] Snapshot before action, verify `toBeUnchanged` after failed action
- [ ] Binary content (Buffer) round-trips correctly
- [ ] Symlink entries work with `toHaveSymlink`
- [ ] `makeExecutable` sets flag on Unix, no-op on Windows
- [ ] All existing tests pass after migration

## Behavioral Contract (from Boundary Tests)

The mock must replicate these behaviors:

| Method            | Success Behavior                                                                | Error Cases                                                                                |
| ----------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `readFile`        | Returns file content as UTF-8 string                                            | `ENOENT` if missing, `EISDIR` if directory                                                 |
| `writeFile`       | Creates/overwrites file                                                         | `ENOENT` if parent missing, `EISDIR` if path is directory                                  |
| `mkdir`           | Creates dir + parents (recursive=true default), no-op if directory exists       | `EEXIST` if **file** at path (not directory), `ENOENT` if parent missing (recursive=false) |
| `readdir`         | Returns `DirEntry[]` with `isFile`, `isDirectory`, `isSymbolicLink`             | `ENOENT` if missing, `ENOTDIR` if not directory                                            |
| `unlink`          | Removes file                                                                    | `ENOENT` if missing, `EISDIR` if directory                                                 |
| `rm`              | Removes file/dir, handles `recursive`/`force`                                   | `ENOENT` (unless force), `ENOTEMPTY` (unless recursive)                                    |
| `copyTree`        | Deep copy, creates dest parents, overwrites existing                            | `ENOENT` if source missing                                                                 |
| `makeExecutable`  | Sets executable flag (no-op on Windows per `process.platform`)                  | `ENOENT` if missing                                                                        |
| `writeFileBuffer` | Same as writeFile but stores Buffer                                             | Same as writeFile                                                                          |
| `symlink`         | Creates symlink entry (absolute normalized target only), removes existing first | `ENOENT` if parent missing                                                                 |
| `rename`          | Atomic move                                                                     | `ENOENT` if source missing                                                                 |

## API Reference

### Entry Types

```typescript
interface FileEntry {
  readonly type: "file";
  readonly content: string | Buffer;
  readonly executable?: boolean;
  readonly error?: FileSystemErrorCode;
}

interface DirectoryEntry {
  readonly type: "directory";
  readonly error?: FileSystemErrorCode;
}

interface SymlinkEntry {
  readonly type: "symlink";
  readonly target: string;
  readonly error?: FileSystemErrorCode;
}

type Entry = FileEntry | DirectoryEntry | SymlinkEntry;
```

### Entry Helpers

```typescript
function file(
  content: string | Buffer,
  options?: {
    executable?: boolean;
    error?: FileSystemErrorCode;
  }
): FileEntry;

function directory(options?: { error?: FileSystemErrorCode }): DirectoryEntry;

function symlink(
  target: string,
  options?: {
    error?: FileSystemErrorCode;
  }
): SymlinkEntry;
```

### State Interface

```typescript
interface FileSystemMockState extends MockState {
  readonly entries: ReadonlyMap<string, Entry>;
  setEntry(path: string | Path, entry: Entry): void;
  snapshot(): Snapshot;
  toString(): string;
}

type MockFileSystemLayer = FileSystemLayer & MockWithState<FileSystemMockState>;
```

### Factory

```typescript
interface MockFileSystemOptions {
  entries?: Map<string, Entry> | Record<string, Entry>;
}

function createFileSystemMock(options?: MockFileSystemOptions): MockFileSystemLayer;
```

### Matchers

```typescript
interface FileSystemMatchers {
  toHaveFile(path: string | Path, content?: string | Buffer): void;
  toHaveDirectory(path: string | Path): void;
  toHaveFileContaining(path: string | Path, pattern: string | RegExp): void;
  toHaveSymlink(path: string | Path, target?: string | Path): void;
  toBeExecutable(path: string | Path): void;
}
```

**Implementation notes:**

- `toHaveFile` uses `Buffer.equals()` for Buffer content comparison
- All matchers normalize paths via `Path` class before lookup

## Usage Examples

### Basic Setup

```typescript
const mock = createFileSystemMock({
  entries: {
    "/app": directory(),
    "/app/config.json": file('{"debug": true}'),
    "/app/bin/run.sh": file("#!/bin/bash\necho hi", { executable: true }),
    "/app/current": symlink("/app/v1"),
  },
});
```

### Behavioral Assertions

```typescript
// Verify file exists with content
expect(mock).toHaveFile("/app/config.json", '{"debug": true}');

// Verify directory exists
expect(mock).toHaveDirectory("/app");

// Verify file contains pattern
expect(mock).toHaveFileContaining("/app/config.json", "debug");
expect(mock).toHaveFileContaining("/app/config.json", /debug.*true/);

// Verify symlink
expect(mock).toHaveSymlink("/app/current", "/app/v1");

// Verify executable
expect(mock).toBeExecutable("/app/bin/run.sh");

// Verify file does NOT exist after deletion
await mock.unlink("/app/config.json");
expect(mock).not.toHaveFile("/app/config.json");

// Verify state unchanged after failed operation
const snapshot = mock.$.snapshot();
await expect(mock.readFile("/missing")).rejects.toThrow();
expect(mock).toBeUnchanged(snapshot);
```

### Error Simulation

```typescript
const mock = createFileSystemMock({
  entries: {
    // Error option overrides normal behavior - throws before checking content
    "/protected.txt": file("secret", { error: "EACCES" }),
  },
});

await expect(mock.readFile("/protected.txt")).rejects.toThrow(FileSystemError);

// Change error condition by setting new entry
mock.$.setEntry("/protected.txt", file("secret")); // no error now
await expect(mock.readFile("/protected.txt")).resolves.toBe("secret");
```

### Binary Content

```typescript
const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header
const mock = createFileSystemMock({
  entries: {
    "/image.png": file(binary),
  },
});

expect(mock).toHaveFile("/image.png", binary);
```

## Dependencies

| Package | Purpose             | Approved |
| ------- | ------------------- | -------- |
| (none)  | No new dependencies | N/A      |

## Documentation Updates

### Files to Update

| File               | Changes Required                                                                   |
| ------------------ | ---------------------------------------------------------------------------------- |
| `docs/TESTING.md`  | Update behavioral mock example to use new filesystem mock                          |
| `docs/PATTERNS.md` | Replace old mock example with new behavioral mock pattern                          |
| `AGENTS.md`        | Update mock factory location (filesystem.test-utils.ts → filesystem.state-mock.ts) |

### New Documentation Required

| File | Purpose                               |
| ---- | ------------------------------------- |
| None | API documented in this plan and JSDoc |

## Definition of Done

- [ ] All implementation steps complete
- [ ] `pnpm validate:fix` passes
- [ ] All existing tests pass with new mock
- [ ] Documentation updated
- [ ] User acceptance testing passed
- [ ] CI passed
- [ ] Merged to main
