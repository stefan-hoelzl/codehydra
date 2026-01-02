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
 * Returns TMatchers when T matches TMock, otherwise empty object.
 * The empty object fallback is intentional for conditional interface extension.
 */
export type MatchersFor<T, TMock extends MockWithState<MockState>, TMatchers> = T extends TMock
  ? TMatchers
  : {};

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

/**
 * Base matcher interface. These matchers are available for all assertions
 * but are intended for use with MockWithState objects.
 */
interface MockWithStateMatchers {
  /**
   * Assert that mock state has not changed since snapshot was taken.
   * Only works with objects that have a `$` property implementing MockState.
   * @param snapshot - Snapshot from `mock.$.snapshot()`
   */
  toBeUnchanged(snapshot: Snapshot): void;
}

declare module "vitest" {
  // Base matchers are added unconditionally (standard pattern for testing libraries)
  // Runtime checks ensure correct usage
  interface Assertion<T> extends MockWithStateMatchers {}
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
