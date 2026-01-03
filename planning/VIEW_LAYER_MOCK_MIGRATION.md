---
status: COMPLETED
last_updated: 2026-01-03
reviewers: [review-testing, review-typescript, review-docs]
---

# VIEW_LAYER_MOCK_MIGRATION

## Overview

- **Problem**: The ViewLayer behavioral mock uses the legacy `_getState()` pattern instead of the standardized `mock.$` pattern, and tests use direct state access instead of custom matchers.
- **Solution**: Migrate to the `mock.$` pattern with two custom matchers (`toHaveView`, `toHaveViews`) that cover all current test assertions. This implements the [State Mock Pattern](../docs/TESTING.md#state-mock-pattern).
- **Risks**:
  - Test file changes could introduce regressions (mitigated by running tests after each file migration)
  - Breaking changes to mock API (mitigated by updating all usages atomically)
- **Alternatives Considered**:
  - Keep `_getState()` pattern → rejected (inconsistent with other state mocks)
  - Create 11 separate matchers → rejected (reduced to 2 flexible matchers)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    view.state-mock.ts                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  ViewLayerMockStateImpl (implements ViewLayerMockState) │   │
│  │  ─────────────────────────────────────────────────────  │   │
│  │  + snapshot(): Snapshot                                 │   │
│  │  + toString(): string                                   │   │
│  │  + triggerDidFinishLoad(handle): void                   │   │
│  │  + triggerWillNavigate(handle, url): boolean            │   │
│  │  - _views: Map<string, ViewState>       (private)       │   │
│  │  - _windowChildren: Map<string, string[]> (private)     │   │
│  │  - _didFinishLoadCallbacks: Map<...>    (private)       │   │
│  │  - _willNavigateCallbacks: Map<...>     (private)       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              │ exposed via $                    │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  MockViewLayer = ViewLayer & MockWithState<...>         │   │
│  │  ─────────────────────────────────────────────────────  │   │
│  │  + createView(options): ViewHandle                      │   │
│  │  + destroy(handle): void                                │   │
│  │  + loadURL(handle, url): Promise<void>                  │   │
│  │  + ... (all ViewLayer methods)                          │   │
│  │  + $: ViewLayerMockState                                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Custom Matchers (2)                                    │   │
│  │  ─────────────────────────────────────────────────────  │   │
│  │  + toHaveView(id, props?)    - view exists + properties │   │
│  │  + toHaveViews(ids[])        - exact set of views       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  createViewLayerMock(): MockViewLayer                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### State Transitions Example

```typescript
const mock = createViewLayerMock();
const handle = mock.createView({ backgroundColor: "#1e1e1e" });
// State: views has view-1 with { url: null, attachedTo: null, backgroundColor: "#1e1e1e" }

await mock.loadURL(handle, "http://127.0.0.1:8080");
// State: view-1 now has { url: "http://127.0.0.1:8080", ... }

const windowHandle = { id: "window-1", __brand: "WindowHandle" as const };
mock.attachToWindow(handle, windowHandle);
// State: view-1 now has { attachedTo: "window-1", ... }

mock.detachFromWindow(handle);
// State: view-1 now has { attachedTo: null, ... }
```

## Implementation Steps

- [x] **Step 1: Create view.state-mock.ts with new interface**
  - Create `src/services/shell/view.state-mock.ts`
  - Define `ViewStateSnapshot` interface (read-only view state)
  - Define `ViewExpectation` interface (for matcher props)
  - Define `ViewLayerMockState` interface extending `MockState`
  - Define `ViewLayerMockStateImpl` class with:
    - Private fields: `_views`, `_windowChildren`, `_didFinishLoadCallbacks`, `_willNavigateCallbacks`
    - The state class owns the callback maps so triggers can invoke them
  - Define `MockViewLayer` type
  - Implement `createViewLayerMock()` factory that:
    - Creates state instance with all internal maps
    - Returns mock with ViewLayer methods that mutate state
  - Implement `snapshot()`: Returns `{ __brand: "Snapshot", value: this.toString() }`
  - Implement `toString()`: Returns sorted, deterministic string representation of views and windowChildren
  - Implement trigger methods:
    - `triggerDidFinishLoad(handle)`: Invokes all registered `did-finish-load` callbacks for the view
    - `triggerWillNavigate(handle, url)`: Invokes all registered `will-navigate` callbacks, returns `true` if all allow navigation, `false` if any prevent it
  - Files affected: `src/services/shell/view.state-mock.ts` (new)

- [x] **Step 2: Implement custom matchers**
  - Implement `toHaveView(id, expected?)` matcher:
    - Without `expected`: Check only that view with `id` exists
    - With `expected`: Check existence AND verify each specified property matches
    - Use `key in expected` to distinguish missing properties (skip check) from explicit values (check match)
  - Implement `toHaveViews(ids[])` matcher:
    - Check that exactly these view IDs exist (no more, no less)
    - Order-independent comparison
  - Add vitest module augmentation using `MatchersFor` pattern:
    ```typescript
    declare module "vitest" {
      interface Assertion<T> extends MatchersFor<T, MockViewLayer, ViewLayerMatchers> {}
    }
    ```
  - Register matchers with `expect.extend()`
  - Files affected: `src/services/shell/view.state-mock.ts`

- [x] **Step 3: Register matchers in setup-matchers.ts**
  - Import `view.state-mock.ts` to register matchers
  - Files affected: `src/test/setup-matchers.ts`

- [x] **Step 4: Migrate view.integration.test.ts**
  - Update imports to use new factory and types
  - Replace `_getState()` calls with matchers
  - Replace `_triggerDidFinishLoad()` with `$.triggerDidFinishLoad()`
  - Replace `_triggerWillNavigate()` with `$.triggerWillNavigate()`
  - Files affected: `src/services/shell/view.integration.test.ts`

- [x] **Step 5: Migrate view-manager.test.ts**
  - Update imports to use new factory and types
  - Replace `_getState()` calls with matchers
  - Replace index-based view access with handle-based assertions
  - Files affected: `src/main/managers/view-manager.test.ts`

- [x] **Step 6: Delete old view.test-utils.ts and verify cleanup**
  - Remove `src/services/shell/view.test-utils.ts`
  - Grep codebase for legacy patterns to ensure complete removal:
    - `_getState()` in test files
    - `_triggerDidFinishLoad` and `_triggerWillNavigate` (should only exist in state-mock.ts)
    - `BehavioralViewLayer` type
    - `createBehavioralViewLayer` function
  - Files affected: `src/services/shell/view.test-utils.ts` (deleted)

- [x] **Step 7: Run validation**
  - Run `pnpm validate:fix`

## Testing Strategy

The existing tests in `view.integration.test.ts` and `view-manager.test.ts` validate the mock behavior through their migration to the new patterns. No additional tests beyond the migration are required.

### Manual Testing Checklist

- [ ] `pnpm test:integration` passes
- [ ] `pnpm validate:fix` passes
- [ ] No legacy patterns found in grep check (Step 6)

## API Reference

### Types

```typescript
/**
 * Read-only snapshot of a view's state.
 */
interface ViewStateSnapshot {
  readonly url: string | null;
  readonly bounds: Rectangle | null;
  readonly backgroundColor: string | null;
  readonly attachedTo: string | null;
  readonly options: ViewOptions;
  readonly hasWindowOpenHandler: boolean;
}

/**
 * Expected properties for toHaveView matcher.
 * Only specified properties are checked; omitted properties are ignored.
 */
interface ViewExpectation {
  /** null = must be detached, string = must be attached to that window */
  attachedTo?: string | null;
  /** null = must have no URL, string = must have that URL */
  url?: string | null;
  /** Must have this background color */
  backgroundColor?: string;
  /** null = must have no bounds, Rectangle = must have those bounds */
  bounds?: Rectangle | null;
  /** true = must have handler, false = must not have handler */
  hasWindowOpenHandler?: boolean;
}

/**
 * State interface with triggers and MockState methods.
 */
interface ViewLayerMockState extends MockState {
  /**
   * Simulates Electron's 'did-finish-load' event.
   * Invokes all registered handlers for the specified view.
   *
   * @example
   * mock.onDidFinishLoad(handle, callback);
   * mock.$.triggerDidFinishLoad(handle); // callback is invoked
   */
  triggerDidFinishLoad(handle: ViewHandle): void;

  /**
   * Simulates Electron's 'will-navigate' event.
   * Invokes all registered handlers for the specified view.
   *
   * @returns true if all handlers allow navigation, false if any handler prevents it
   *
   * @example
   * mock.onWillNavigate(handle, (url) => url.startsWith("http://allowed"));
   * mock.$.triggerWillNavigate(handle, "http://allowed/page"); // returns true
   * mock.$.triggerWillNavigate(handle, "http://blocked/page"); // returns false
   */
  triggerWillNavigate(handle: ViewHandle, url: string): boolean;

  snapshot(): Snapshot;
  toString(): string;
}

/** Mock type */
type MockViewLayer = ViewLayer & MockWithState<ViewLayerMockState>;
```

### Factory

```typescript
/**
 * Create a behavioral mock for ViewLayer.
 *
 * @example Basic usage
 * const mock = createViewLayerMock();
 * const handle = mock.createView({});
 * expect(mock).toHaveView(handle.id);
 *
 * @example Simulating events
 * mock.onDidFinishLoad(handle, () => console.log("loaded"));
 * mock.$.triggerDidFinishLoad(handle);
 *
 * @example Snapshot comparison
 * const before = mock.$.snapshot();
 * mock.createView({});
 * expect(mock).not.toBeUnchanged(before);
 */
function createViewLayerMock(): MockViewLayer;
```

### Matchers

```typescript
/**
 * Assert view exists with optional property checks.
 *
 * @example Check view exists
 * expect(mock).toHaveView("view-1");
 *
 * @example Check view is detached
 * expect(mock).toHaveView("view-1", { attachedTo: null });
 *
 * @example Check multiple properties
 * expect(mock).toHaveView("view-1", {
 *   attachedTo: "window-1",
 *   url: "http://127.0.0.1:8080",
 *   backgroundColor: "#1e1e1e"
 * });
 *
 * @example Failure message format
 * // Expected view "view-1" to have url "http://expected" but got "http://actual"
 * // Expected view "view-1" to exist but it was not found
 */
toHaveView(id: string, expected?: ViewExpectation): void;

/**
 * Assert exactly these views exist (no more, no less).
 *
 * @example Check exact views
 * expect(mock).toHaveViews(["view-1", "view-2"]);
 *
 * @example Check no views
 * expect(mock).toHaveViews([]);
 *
 * @example Failure message format
 * // Expected views ["view-1", "view-2"] but found ["view-1", "view-3"]
 * // Missing: ["view-2"], Extra: ["view-3"]
 */
toHaveViews(ids: string[]): void;

// Assert view does not exist
expect(mock).not.toHaveView("view-999");

// Trigger event callbacks
mock.$.triggerDidFinishLoad(handle);
const allowed = mock.$.triggerWillNavigate(handle, "http://example.com");

// Snapshot for toBeUnchanged
const before = mock.$.snapshot();
// ... actions ...
expect(mock).not.toBeUnchanged(before);
```

## Dependencies

| Package | Purpose             | Approved |
| ------- | ------------------- | -------- |
| (none)  | No new dependencies | N/A      |

## Documentation Updates

### Files to Update

| File              | Changes Required                          |
| ----------------- | ----------------------------------------- |
| `docs/TESTING.md` | Add ViewLayer mock to state mock examples |

### New Documentation Required

| File | Purpose                               |
| ---- | ------------------------------------- |
| None | API documented in this plan and JSDoc |

## Definition of Done

- [ ] All implementation steps complete
- [ ] `pnpm validate:fix` passes
- [ ] Old `view.test-utils.ts` deleted
- [ ] All tests use matchers (no direct state access)
- [ ] No legacy patterns found in codebase
- [ ] User acceptance testing passed
