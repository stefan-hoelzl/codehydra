---
status: COMPLETED
last_updated: 2026-01-03
reviewers: [review-typescript, review-testing, review-docs]
---

# MOCK_SESSION_LAYER

## Overview

- **Problem**: The SessionLayer behavioral mock uses the deprecated `_getState()` pattern instead of the standardized `mock.$` pattern with custom matchers.
- **Solution**: Migrate to the `$` accessor pattern with type-safe custom matchers, following the conventions established in `filesystem.state-mock.ts` and `port-manager.state-mock.ts`.
- **Risks**:
  - Test file updates may introduce errors (mitigated by running tests after migration)
  - Import path changes in consuming files (mitigated by search-and-replace)
- **Alternatives Considered**:
  - Keep `_getState()` pattern → rejected (inconsistent with other mocks, no custom matchers)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         session.state-mock.ts                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    MockSessionState                                │  │
│  │  - partition: string                                               │  │
│  │  - cleared: boolean                                                │  │
│  │  - hasPermissionRequestHandler: boolean                            │  │
│  │  - hasPermissionCheckHandler: boolean                              │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │         SessionLayerMockStateImpl (implements MockState)           │  │
│  │  - private readonly _sessions: Map<string, MockSessionState>       │  │
│  │  - get sessions(): ReadonlyMap<string, MockSessionState>           │  │
│  │  - snapshot(): Snapshot                                            │  │
│  │  - toString(): string                                              │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                      MockSessionLayer                              │  │
│  │  = SessionLayer & MockWithState<SessionLayerMockState>             │  │
│  │                                                                    │  │
│  │  Public API:           State Access:                               │  │
│  │  - fromPartition()     - $.sessions                                │  │
│  │  - clearStorageData()  - $.snapshot()                              │  │
│  │  - setPermission*()    - $.toString()                              │  │
│  │  - dispose()                                                       │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    Custom Matchers                                 │  │
│  │  toHaveSession(handleId: string, expected?: {                      │  │
│  │    cleared?: boolean;                                              │  │
│  │    requestHandler?: boolean;  // maps to hasPermissionRequestHandler│  │
│  │    checkHandler?: boolean;    // maps to hasPermissionCheckHandler │  │
│  │    partition?: string;                                             │  │
│  │  }): void                                                          │  │
│  │                                                                    │  │
│  │  toHaveSessionCount(count: number): void                           │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Naming Note**: Matchers use shortened property names (`requestHandler`, `checkHandler`) which map to state fields (`hasPermissionRequestHandler`, `hasPermissionCheckHandler`) for conciseness.

## Implementation Steps

- [x] **Step 1: Create new mock file `session.state-mock.ts`**
  - Create `src/services/shell/session.state-mock.ts`
  - Implement `MockSessionState` interface:
    ```typescript
    export interface MockSessionState {
      readonly partition: string;
      readonly cleared: boolean;
      readonly hasPermissionRequestHandler: boolean;
      readonly hasPermissionCheckHandler: boolean;
    }
    ```
  - Implement `SessionLayerMockState` interface extending `MockState`:
    ```typescript
    export interface SessionLayerMockState extends MockState {
      readonly sessions: ReadonlyMap<string, MockSessionState>;
      snapshot(): Snapshot;
      toString(): string;
    }
    ```
  - Implement `SessionLayerMockStateImpl` class (concrete implementation of `SessionLayerMockState`):

    ```typescript
    class SessionLayerMockStateImpl implements SessionLayerMockState {
      private readonly _sessions = new Map<string, MockSessionState>();

      get sessions(): ReadonlyMap<string, MockSessionState> {
        return this._sessions;
      }

      snapshot(): Snapshot {
        return { __brand: "Snapshot", value: this.toString() };
      }

      toString(): string {
        const entries = [...this._sessions.entries()]
          .map(([id, s]) => `${id}: ${s.partition} (cleared=${s.cleared})`)
          .join(", ");
        return `SessionLayerMockState { ${entries} }`;
      }
    }
    ```

  - Implement `SessionLayerMockOptions` interface:
    ```typescript
    export interface SessionLayerMockOptions {
      sessions?: Record<
        string,
        {
          cleared?: boolean;
          hasPermissionRequestHandler?: boolean;
          hasPermissionCheckHandler?: boolean;
        }
      >;
    }
    ```
    Keys are partition names; sessions will be assigned sequential handle IDs.
  - Implement `createSessionLayerMock(options?)` factory function
  - Export `MockSessionLayer` type with JSDoc:
    ```typescript
    /**
     * SessionLayer mock with state access via `$` property.
     * Use `createSessionLayerMock()` to create instances.
     */
    export type MockSessionLayer = SessionLayer & MockWithState<SessionLayerMockState>;
    ```
  - Files affected: `src/services/shell/session.state-mock.ts` (new)

- [x] **Step 2: Implement custom matchers**
  - Implement `toHaveSession(handleId: string, expected?)` matcher:

    ```typescript
    interface SessionExpected {
      cleared?: boolean;
      requestHandler?: boolean; // maps to hasPermissionRequestHandler
      checkHandler?: boolean; // maps to hasPermissionCheckHandler
      partition?: string;
    }
    ```

    - Checks session exists by handle ID
    - Optionally checks each property if provided in `expected`

  - Implement `toHaveSessionCount(count: number)` matcher
  - Add Vitest module augmentation for type safety:
    ```typescript
    declare module "vitest" {
      interface Assertion<T> extends SessionLayerMatchers {}
    }
    ```
  - Export `sessionLayerMatchers` and register with `expect.extend(sessionLayerMatchers)`
  - Files affected: `src/services/shell/session.state-mock.ts`

- [x] **Step 3: Migrate `session.integration.test.ts`**
  - Update imports: `createBehavioralSessionLayer` → `createSessionLayerMock`
  - Update import path: `session.test-utils` → `session.state-mock`
  - Update type: `BehavioralSessionLayer` → `MockSessionLayer`
  - Replace all `_getState()` calls with custom matchers:
    - `state.sessions.has(id)` → `expect(sessionLayer).toHaveSession(id)`
    - `state.sessions.size` → `expect(sessionLayer).toHaveSessionCount(n)`
    - `state.sessions.get(id)?.cleared` → `expect(sessionLayer).toHaveSession(id, { cleared: true })`
    - `state.sessions.get(id)?.hasPermissionRequestHandler` → `expect(sessionLayer).toHaveSession(id, { requestHandler: true/false })`
    - `state.sessions.get(id)?.hasPermissionCheckHandler` → `expect(sessionLayer).toHaveSession(id, { checkHandler: true/false })`
  - Replace `_getPartition(handle)` → `expect(sessionLayer).toHaveSession(handle.id, { partition })`
  - Remove test named "returns immutable copy of state" in the `_getState` describe block (lines 162-171) - this is an implementation detail
  - Files affected: `src/services/shell/session.integration.test.ts`

- [x] **Step 4: Update `view-manager.test.ts` imports**
  - Update import: `createBehavioralSessionLayer` → `createSessionLayerMock`
  - Update import path: `session.test-utils` → `session.state-mock`
  - Files affected: `src/main/managers/view-manager.test.ts`

- [x] **Step 5: Delete old mock file**
  - Delete `src/services/shell/session.test-utils.ts`
  - Files affected: `src/services/shell/session.test-utils.ts`

- [x] **Step 6: Run validation**
  - Run `pnpm validate:fix`
  - Verify all existing test cases still pass

## Manual Testing Checklist

- [ ] `pnpm validate:fix` passes
- [ ] No references to old `session.test-utils.ts` remain

## Dependencies

| Package | Purpose             | Approved |
| ------- | ------------------- | -------- |
| (none)  | No new dependencies | N/A      |

## Documentation Updates

### Files to Update

| File               | Changes Required                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| `docs/PATTERNS.md` | Update Test Utils Location table: `SessionLayer` → `createSessionLayerMock()` in `session.state-mock.ts` |

## Definition of Done

- [ ] All implementation steps complete
- [ ] `pnpm validate:fix` passes
- [ ] Documentation updated
- [ ] User acceptance testing passed
- [ ] CI passed
- [ ] Merged to main
