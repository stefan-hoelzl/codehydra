/**
 * Tests for the setup state management store.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  setupState,
  completeSetup,
  errorSetup,
  resetSetup,
  type SetupStateValue,
} from "./setup.svelte";

describe("setup store", () => {
  beforeEach(() => {
    resetSetup();
  });

  describe("initial state", () => {
    it("starts in loading state", () => {
      expect(setupState.value.type).toBe("loading");
    });
  });

  describe("completeSetup", () => {
    it("transitions to complete state from loading", () => {
      completeSetup();

      expect(setupState.value.type).toBe("complete");
    });
  });

  describe("errorSetup", () => {
    it("transitions to error state with message", () => {
      errorSetup("Network failure");

      expect(setupState.value.type).toBe("error");
      expect((setupState.value as SetupStateValue & { type: "error" }).errorMessage).toBe(
        "Network failure"
      );
    });
  });

  describe("resetSetup", () => {
    it("resets to loading state from complete", () => {
      completeSetup();
      resetSetup();

      expect(setupState.value.type).toBe("loading");
    });

    it("resets to loading state from error", () => {
      errorSetup("Failed!");
      resetSetup();

      expect(setupState.value.type).toBe("loading");
    });
  });

  describe("state transitions", () => {
    it("allows loading -> complete", () => {
      expect(setupState.value.type).toBe("loading");

      completeSetup();
      expect(setupState.value.type).toBe("complete");
    });

    it("allows loading -> error", () => {
      expect(setupState.value.type).toBe("loading");

      errorSetup("Failed!");
      expect(setupState.value.type).toBe("error");
    });

    it("allows error -> loading (retry via resetSetup)", () => {
      errorSetup("Failed!");
      expect(setupState.value.type).toBe("error");

      resetSetup();
      expect(setupState.value.type).toBe("loading");
    });
  });
});
