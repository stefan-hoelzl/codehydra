---
status: COMPLETED
last_updated: 2026-01-02
reviewers: [review-typescript, review-arch, review-testing, review-docs]
---

# PHASE1_MOCK_INFRASTRUCTURE

## Overview

- **Problem**: The behavior-driven testing migration requires shared infrastructure before individual mock factories can be created. Currently, each mock defines its own patterns independently (using `_getState()`), there's no type-safe matcher system, and dead code exists (xvfb/setup-display.ts for non-existent Electron boundary tests).

- **Solution**: Create shared mock infrastructure with:
  - Base `MockState` interface with explicit `snapshot()` method for state comparison
  - `MockWithState<T>` wrapper type with `$` property for state access
  - Type-safe custom matchers using `MatchersFor` and `MatcherImplementationsFor` helper types
  - Base `toBeUnchanged(snapshot)` matcher for comparing state snapshots
  - Clean up dead code (xvfb, setup-display.ts)
  - Document the pattern in `docs/TESTING.md`

- **Risks**:
  - Type complexity with conditional types - mitigated by helper types that hide complexity
  - Matcher registration order - mitigated by importing state-mock.ts first which auto-registers base matchers

- **Alternatives Considered**:
  - `initial` property on MockState - rejected (explicit `snapshot()` gives control over when snapshot is taken)
  - WeakMap for snapshots - rejected (opaque `Snapshot` type is cleaner)
  - Separate base-matchers.ts file - rejected (base matchers belong with MockState)
  - Methods on state interface - rejected (state should be pure data, logic in matchers)
  - `*.test-utils.ts` naming - rejected (`*.state-mock.ts` is clearer; migration of existing files deferred)

## Architecture

```
src/test/
├── state-mock.ts          # Core types + base matchers (MockState, MockWithState, Snapshot, etc.)
├── setup-matchers.ts      # Imports and registers all mock-specific matchers
└── setup-display.ts       # DELETE (dead code)

Pattern per mock file (*.state-mock.ts):
┌─────────────────────────────────────────────────────────────────┐
│  *.state-mock.ts                                                │
├─────────────────────────────────────────────────────────────────┤
│  1. State interface (pure data, extends MockState)              │
│  2. Mock type (Layer & MockWithState<State>)                    │
│  3. Matchers interface (for Assertion<T> augmentation)          │
│  4. declare module "vitest" { ... }                             │
│  5. Matcher implementations (typed via MatcherImplementationsFor)│
│  6. Factory function                                            │
└─────────────────────────────────────────────────────────────────┘

Note: This formalizes the existing `_getState()` behavioral mock pattern
into a standardized interface with type-safe matchers.
```

## Implementation Steps

- [x] **Step 1: Create `src/test/state-mock.ts`**
  - Define opaque `Snapshot` type for state comparison
  - Define `MockState` interface with `snapshot(): Snapshot` and `toString(): string`
  - Define `MockWithState<TState>` interface with `readonly $: TState`
  - Define `MatchersFor<T, TMock extends MockWithState<MockState>, TMatchers>` helper type (with constraint)
  - Define `MatcherResult` interface
  - Define `MatcherImplementationsFor<TMock, TMatchers>` mapped type
  - Define `MockWithStateMatchers` interface with `toBeUnchanged(snapshot: Snapshot): void`
  - Augment vitest `Assertion<T>` with base matchers
  - Implement and export `mockWithStateMatchers`
  - Call `expect.extend(mockWithStateMatchers)` to auto-register on import
  - Add JSDoc comments for all public types
  - Files affected: `src/test/state-mock.ts` (new)

- [x] **Step 2: Create `src/test/setup-matchers.ts`**
  - Import `./state-mock` to register base matchers
  - Add commented placeholder with example format:
    ```typescript
    // Future mock-specific matchers:
    // import { fileSystemMatchers } from "../services/platform/file-system.state-mock";
    // expect.extend({ ...fileSystemMatchers });
    ```
  - Files affected: `src/test/setup-matchers.ts` (new)

- [x] **Step 3: Update `vitest.config.ts`**
  - Remove `globalSetup: ["./src/test/setup-display.ts"]` from boundary test project configuration
  - Add `./src/test/setup-matchers.ts` to `setupFiles` for node, boundary, and renderer projects
  - Files affected: `vitest.config.ts`

- [x] **Step 4: Delete `src/test/setup-display.ts`**
  - Remove the file (dead code - no Electron boundary tests exist)
  - Files affected: `src/test/setup-display.ts` (delete)

- [x] **Step 5: Remove xvfb from `package.json`**
  - Remove `"xvfb": "^0.4.0"` from `optionalDependencies`
  - Files affected: `package.json`

- [x] **Step 6: Update `docs/TESTING.md`**
  - Remove "Electron Boundary Tests" section (starts with `### Electron Boundary Tests`)
  - Add new "State Mock Pattern" section documenting:
    - File naming convention: `*.state-mock.ts`
    - `MockState` interface with `snapshot()` and `toString()`
    - `MockWithState<T>` pattern for state inspection (`mock.$.property`)
    - `Snapshot` type and `toBeUnchanged(snapshot)` base matcher
    - Custom matchers pattern (interface, `declare module "vitest"`, implementation, registration)
    - Example usage showing snapshot workflow
    - Note that this formalizes the existing `_getState()` pattern
  - Files affected: `docs/TESTING.md`

## Testing Strategy

Infrastructure will be validated when actual mocks are created in future phases.

### Manual Testing Checklist

- [ ] `pnpm validate:fix` passes
- [ ] No TypeScript errors in new files
- [ ] Documentation in `docs/TESTING.md` is clear and complete

## Dependencies

| Package | Purpose             | Approved |
| ------- | ------------------- | -------- |
| (none)  | No new dependencies | N/A      |

## Documentation Updates

### Files to Update

| File              | Changes Required                                                           |
| ----------------- | -------------------------------------------------------------------------- |
| `docs/TESTING.md` | Remove "Electron Boundary Tests" section, add "State Mock Pattern" section |

### New Documentation Required

| File | Purpose                                 |
| ---- | --------------------------------------- |
| None | Pattern documented in `docs/TESTING.md` |

## Definition of Done

- [ ] All implementation steps complete
- [ ] `pnpm validate:fix` passes
- [ ] Documentation updated
- [ ] User acceptance testing passed
- [ ] CI passed
- [ ] Merged to main

## Appendix: Type Definitions

### `src/test/state-mock.ts`

```typescript
import { expect } from "vitest";

// =============================================================================
// Core Types
// =============================================================================

/**
 * Opaque snapshot type for state comparison.
 * Created via `mock.$.snapshot()`, compared via `toBeUnchanged(snapshot)`.
 */
export type Snapshot = { readonly __brand: "Snapshot"; readonly value: string };

/**
 * Base interface for mock state. All state mocks must extend this.
 * State should be pure data - logic belongs in matchers.
 */
export interface MockState {
  /**
   * Capture current state as snapshot for later comparison.
   * @returns Opaque snapshot that can be passed to `toBeUnchanged()`
   */
  snapshot(): Snapshot;

  /**
   * Human-readable description of current state.
   * Used in matcher error messages.
   */
  toString(): string;
}

/**
 * A mock with inspectable state via the `$` property.
 * This formalizes the existing `_getState()` pattern.
 */
export interface MockWithState<TState extends MockState> {
  readonly $: TState;
}

/**
 * Helper type for defining type-safe matchers on Assertion<T>.
 * Returns TMatchers when T matches TMock, otherwise unknown.
 */
export type MatchersFor<T, TMock extends MockWithState<MockState>, TMatchers> = T extends TMock
  ? TMatchers
  : unknown;

/**
 * Vitest matcher result type.
 */
export interface MatcherResult {
  pass: boolean;
  message: () => string;
}

/**
 * Derives matcher implementation type from assertion matcher type.
 * - Prepends `received: TMock` parameter
 * - Changes return type from `void` to `MatcherResult`
 */
export type MatcherImplementationsFor<TMock, TMatchers> = {
  [K in keyof TMatchers]: TMatchers[K] extends (...args: infer Args) => void
    ? (received: TMock, ...args: Args) => MatcherResult
    : never;
};

// =============================================================================
// Base Matchers for MockWithState
// =============================================================================

interface MockWithStateMatchers {
  /**
   * Assert that mock state has not changed since snapshot was taken.
   * @param snapshot - Snapshot from `mock.$.snapshot()`
   */
  toBeUnchanged(snapshot: Snapshot): void;
}

declare module "vitest" {
  interface Assertion<T> extends MatchersFor<T, MockWithState<MockState>, MockWithStateMatchers> {}
}

export const mockWithStateMatchers: MatcherImplementationsFor<
  MockWithState<MockState>,
  MockWithStateMatchers
> = {
  toBeUnchanged(received, snapshot) {
    const current = received.$.toString();
    const pass = snapshot.value === current;

    return {
      pass,
      message: () =>
        pass
          ? `Expected mock state to have changed.\nSnapshot: ${snapshot.value}\nCurrent: ${current}`
          : `Expected mock state to be unchanged.\nSnapshot: ${snapshot.value}\nCurrent: ${current}`,
    };
  },
};

expect.extend(mockWithStateMatchers);
```

### Example Usage

```typescript
// In a test file
import { createMockGitClient } from "@services/git/git-client.state-mock";

it("creates worktree when branch exists", async () => {
  const gitMock = createMockGitClient({
    repositories: new Map([["/project", { branches: ["main"] }]]),
  });

  // Capture state before action
  const snapshot = gitMock.$.snapshot();

  // Perform action
  await gitMock.addWorktree(
    new Path("/project"),
    new Path("/project/.worktrees/feature"),
    "feature"
  );

  // Assert state changed
  expect(gitMock).not.toBeUnchanged(snapshot);

  // Assert specific state using mock-specific matchers
  expect(gitMock).toHaveWorktree("/project", "feature");
});

it("does not modify state when branch does not exist", async () => {
  const gitMock = createMockGitClient({
    repositories: new Map([["/project", { branches: ["main"] }]]),
  });

  const snapshot = gitMock.$.snapshot();

  // Action should fail
  await expect(
    gitMock.addWorktree(
      new Path("/project"),
      new Path("/project/.worktrees/feature"),
      "nonexistent"
    )
  ).rejects.toThrow();

  // State should be unchanged
  expect(gitMock).toBeUnchanged(snapshot);
});
```

### Example: Mock-Specific Matchers Pattern

```typescript
// In *.state-mock.ts files, matchers follow this pattern:

import type {
  MockState,
  MockWithState,
  MatchersFor,
  MatcherImplementationsFor,
} from "../../test/state-mock";

// 1. State interface (pure data)
export interface FileSystemMockState extends MockState {
  readonly files: ReadonlyMap<string, string | Buffer>;
  readonly directories: ReadonlySet<string>;
}

// 2. Mock type
export type MockFileSystemLayer = FileSystemLayer & MockWithState<FileSystemMockState>;

// 3. Matchers interface
interface FileSystemMatchers {
  toHaveFile(path: string | Path): void;
  toHaveDirectory(path: string | Path): void;
}

// 4. Vitest augmentation
declare module "vitest" {
  interface Assertion<T> extends MatchersFor<T, MockFileSystemLayer, FileSystemMatchers> {}
}

// 5. Matcher implementations (type-safe via MatcherImplementationsFor)
export const fileSystemMatchers: MatcherImplementationsFor<
  MockFileSystemLayer,
  FileSystemMatchers
> = {
  toHaveFile(received, path) {
    const normalized = new Path(path).toString();
    const pass = received.$.files.has(normalized);
    return {
      pass,
      message: () =>
        pass
          ? `Expected mock not to have file "${normalized}"`
          : `Expected mock to have file "${normalized}"`,
    };
  },
  toHaveDirectory(received, path) {
    const normalized = new Path(path).toString();
    const pass = received.$.directories.has(normalized);
    return {
      pass,
      message: () =>
        pass
          ? `Expected mock not to have directory "${normalized}"`
          : `Expected mock to have directory "${normalized}"`,
    };
  },
};

// 6. Factory function (implements mock + state)
export function createMockFileSystem(options?: MockFileSystemOptions): MockFileSystemLayer {
  // ... implementation
}
```
