/**
 * Tests for workspace loading state store.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  isWorkspaceLoading,
  setWorkspaceLoading,
  loadingWorkspaces,
  reset,
} from "./workspace-loading.svelte";

describe("workspace-loading store", () => {
  beforeEach(() => {
    reset();
  });

  describe("isWorkspaceLoading", () => {
    it("returns false for unknown workspace", () => {
      expect(isWorkspaceLoading("/unknown/workspace")).toBe(false);
    });

    it("returns true for loading workspace", () => {
      setWorkspaceLoading("/path/to/workspace", true);

      expect(isWorkspaceLoading("/path/to/workspace")).toBe(true);
    });

    it("returns false after workspace is loaded", () => {
      setWorkspaceLoading("/path/to/workspace", true);
      setWorkspaceLoading("/path/to/workspace", false);

      expect(isWorkspaceLoading("/path/to/workspace")).toBe(false);
    });
  });

  describe("setWorkspaceLoading", () => {
    it("adds workspace to loading set when loading is true", () => {
      setWorkspaceLoading("/path/to/workspace", true);

      expect(loadingWorkspaces.value.has("/path/to/workspace")).toBe(true);
    });

    it("removes workspace from loading set when loading is false", () => {
      setWorkspaceLoading("/path/to/workspace", true);
      setWorkspaceLoading("/path/to/workspace", false);

      expect(loadingWorkspaces.value.has("/path/to/workspace")).toBe(false);
    });

    it("handles multiple workspaces independently", () => {
      setWorkspaceLoading("/path/to/workspace1", true);
      setWorkspaceLoading("/path/to/workspace2", true);

      expect(isWorkspaceLoading("/path/to/workspace1")).toBe(true);
      expect(isWorkspaceLoading("/path/to/workspace2")).toBe(true);

      setWorkspaceLoading("/path/to/workspace1", false);

      expect(isWorkspaceLoading("/path/to/workspace1")).toBe(false);
      expect(isWorkspaceLoading("/path/to/workspace2")).toBe(true);
    });

    it("is idempotent for setting true multiple times", () => {
      setWorkspaceLoading("/path/to/workspace", true);
      setWorkspaceLoading("/path/to/workspace", true);

      expect(loadingWorkspaces.value.size).toBe(1);
    });

    it("is idempotent for setting false for non-loading workspace", () => {
      // Should not throw
      setWorkspaceLoading("/nonexistent", false);

      expect(loadingWorkspaces.value.size).toBe(0);
    });
  });

  describe("loadingWorkspaces", () => {
    it("provides reactive access to all loading workspaces", () => {
      setWorkspaceLoading("/path/to/workspace1", true);
      setWorkspaceLoading("/path/to/workspace2", true);

      const workspaces = loadingWorkspaces.value;

      expect(workspaces.size).toBe(2);
      expect(workspaces.has("/path/to/workspace1")).toBe(true);
      expect(workspaces.has("/path/to/workspace2")).toBe(true);
    });
  });

  describe("reset", () => {
    it("clears all loading states", () => {
      setWorkspaceLoading("/path/to/workspace1", true);
      setWorkspaceLoading("/path/to/workspace2", true);

      reset();

      expect(loadingWorkspaces.value.size).toBe(0);
      expect(isWorkspaceLoading("/path/to/workspace1")).toBe(false);
      expect(isWorkspaceLoading("/path/to/workspace2")).toBe(false);
    });
  });
});
