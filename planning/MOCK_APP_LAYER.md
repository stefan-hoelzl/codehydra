---
status: COMPLETED
last_updated: 2026-01-03
reviewers: [review-typescript, review-testing, review-docs]
---

# MOCK_APP_LAYER

## Overview

- **Problem**: The AppLayer behavioral mock uses the legacy `_getState()` pattern instead of the standardized `$` accessor pattern. Tests check call history (implementation details) rather than current state (behavior).
- **Solution**: Migrate to `mock.$` pattern with behavioral custom matchers (`toHaveDockBadge`, `toHaveBadgeCount`, `toHaveCommandLineSwitch`). Rename file to `app.state-mock.ts` for consistency. No direct state access - tests use matchers only.
- **Risks**:
  - Test breakage during migration (mitigated by updating all usages atomically)
- **Alternatives Considered**:
  - Keep call history matchers → rejected (tests implementation details, not behavior)
  - Keep backward compatibility with `_getState()` → rejected (delays cleanup)
  - Expose state properties on `$` accessor → rejected (use matchers instead)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     MockAppLayer                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  AppLayer interface methods:                                     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ dock?: AppDock        (undefined on non-macOS)              ││
│  │ setBadgeCount(n)      → updates state, returns true         ││
│  │ getPath(name)         → returns mock/custom path            ││
│  │ commandLineAppendSwitch(key, value?)                        ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                   │
│                              ▼                                   │
│  $ accessor (AppLayerMockState):                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ snapshot(): Snapshot    (for toBeUnchanged matcher)         ││
│  │ toString(): string      (for debugging)                     ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                   │
│                              ▼                                   │
│  Custom Matchers (behavioral assertions):                        │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ toHaveDockBadge(text)              → current dock badge     ││
│  │ toHaveBadgeCount(count)            → current badge count    ││
│  │ toHaveCommandLineSwitch(key, val?) → switch exists          ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Proposed Interfaces

```typescript
import type { MockState, MockWithState, Snapshot } from "../../test/state-mock";
import type { AppLayer, AppPathName } from "./app";

// State Interface (no direct property access - use matchers)
export interface AppLayerMockState extends MockState {
  snapshot(): Snapshot;
  toString(): string;
}

// Mock Type
export type MockAppLayer = AppLayer & MockWithState<AppLayerMockState>;

// Factory
export interface MockAppLayerOptions {
  /**
   * Simulated platform. Affects dock availability.
   * - "darwin": dock is defined
   * - "win32" | "linux": dock is undefined
   * @default "darwin"
   */
  platform?: "darwin" | "win32" | "linux";
  paths?: Partial<Record<AppPathName, string>>;
}
export function createAppLayerMock(options?: MockAppLayerOptions): MockAppLayer;

// Custom Matchers
interface AppLayerMatchers {
  /** Assert current dock badge text */
  toHaveDockBadge(text: string): void;
  /** Assert current badge count */
  toHaveBadgeCount(count: number): void;
  /**
   * Assert a command line switch exists.
   * - toHaveCommandLineSwitch("flag") → switch exists (any value)
   * - toHaveCommandLineSwitch("flag", "val") → switch exists with exact value
   * - toHaveCommandLineSwitch("flag", undefined) → switch exists with no value
   */
  toHaveCommandLineSwitch(key: string, value?: string): void;
}
```

## Implementation Steps

- [x] **Step 1: Create app.state-mock.ts**
  - Create `src/services/platform/app.state-mock.ts`
  - Implement `AppLayerMockStateImpl` class (internal state tracking)
  - Implement `MockAppLayer` type and `createAppLayerMock()` factory
  - Implement custom matchers with helpful error messages
  - Register matchers with vitest via `expect.extend()`
  - Files affected: `src/services/platform/app.state-mock.ts` (new)

- [x] **Step 2: Update badge-manager.test.ts**
  - Change import from `app.test-utils` to `app.state-mock`
  - Change type from `BehavioralAppLayer` to `MockAppLayer`
  - Change factory from `createBehavioralAppLayer` to `createAppLayerMock`
  - Replace `._getState().dockSetBadgeCalls` assertions with `toHaveDockBadge`
  - Replace `._getState().setBadgeCountCalls` assertions with `toHaveBadgeCount`
  - Files affected: `src/main/managers/badge-manager.test.ts`

- [x] **Step 3: Update badge-manager.integration.test.ts**
  - Same import/type/factory changes as Step 2
  - Replace `._getState().dockSetBadgeCalls.at(-1)` with `toHaveDockBadge`
  - Remove call count tracking (`initialCalls`, `slice`) - just check current state
  - Files affected: `src/main/managers/badge-manager.integration.test.ts`

- [x] **Step 4: Delete app.integration.test.ts**
  - This file tests mock infrastructure (e.g., "setBadge updates state"), not application behavior
  - Mock correctness is validated by tests that use it (badge-manager tests)
  - Consistent with other state-mocks (filesystem, port-manager) which have no mock-infrastructure tests
  - Files affected: `src/services/platform/app.integration.test.ts` (delete)

- [x] **Step 5: Delete old app.test-utils.ts**
  - Remove legacy file after all usages migrated
  - Files affected: `src/services/platform/app.test-utils.ts` (delete)

- [x] **Step 6: Update docs/PATTERNS.md**
  - Update table row for AppLayer mock factory reference
  - Change `createBehavioralAppLayer()` to `createAppLayerMock()`
  - Change `platform/app.test-utils.ts` to `platform/app.state-mock.ts`
  - Files affected: `docs/PATTERNS.md` (line ~1104)

## Files Affected (Complete List)

| File                                                  | Action |
| ----------------------------------------------------- | ------ |
| `src/services/platform/app.state-mock.ts`             | Create |
| `src/main/managers/badge-manager.test.ts`             | Update |
| `src/main/managers/badge-manager.integration.test.ts` | Update |
| `src/services/platform/app.integration.test.ts`       | Delete |
| `src/services/platform/app.test-utils.ts`             | Delete |
| `docs/PATTERNS.md`                                    | Update |

## Testing Strategy

### Integration Tests

No new integration tests needed - this is a test infrastructure migration.

### Manual Testing Checklist

- [ ] `pnpm test` passes
- [ ] `pnpm validate:fix` passes
- [ ] No references to `_getState()` remain in AppLayer test files
- [ ] No imports from `app.test-utils.ts` remain
- [ ] Custom matchers provide clear error messages (expected vs actual)
- [ ] Platform behavior correct: `dock` undefined when `platform !== "darwin"`

## Dependencies

| Package | Purpose             | Approved |
| ------- | ------------------- | -------- |
| (none)  | No new dependencies | N/A      |

## Documentation Updates

### Files to Update

| File               | Changes Required                                |
| ------------------ | ----------------------------------------------- |
| `docs/PATTERNS.md` | Update AppLayer mock factory reference in table |

### New Documentation Required

| File   | Purpose                            |
| ------ | ---------------------------------- |
| (none) | JSDoc in source file is sufficient |

## Definition of Done

- [ ] All implementation steps complete
- [ ] `pnpm validate:fix` passes
- [ ] No `_getState()` pattern remains in AppLayer tests
- [ ] No `app.test-utils.ts` file exists
- [ ] No `app.integration.test.ts` file exists
- [ ] Tests use behavioral matchers (current state, not call history)
- [ ] docs/PATTERNS.md updated with new factory name
