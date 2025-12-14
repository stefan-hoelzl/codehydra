// @vitest-environment node
/**
 * Tests for IPC payload validation schemas.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  absolutePathSchema,
  WorkspaceSwitchPayloadSchema,
  AgentGetStatusPayloadSchema,
  validate,
  ValidationError,
} from "./validation";

describe("WorkspaceSwitchPayloadSchema", () => {
  it("accepts workspacePath without focusWorkspace", () => {
    const payload = { workspacePath: "/test/repo/.worktrees/ws1" };
    const result = validate(WorkspaceSwitchPayloadSchema, payload);

    expect(result.workspacePath).toBe("/test/repo/.worktrees/ws1");
    expect(result.focusWorkspace).toBeUndefined();
  });

  it("accepts focusWorkspace: true", () => {
    const payload = {
      workspacePath: "/test/repo/.worktrees/ws1",
      focusWorkspace: true,
    };
    const result = validate(WorkspaceSwitchPayloadSchema, payload);

    expect(result.workspacePath).toBe("/test/repo/.worktrees/ws1");
    expect(result.focusWorkspace).toBe(true);
  });

  it("accepts focusWorkspace: false", () => {
    const payload = {
      workspacePath: "/test/repo/.worktrees/ws1",
      focusWorkspace: false,
    };
    const result = validate(WorkspaceSwitchPayloadSchema, payload);

    expect(result.workspacePath).toBe("/test/repo/.worktrees/ws1");
    expect(result.focusWorkspace).toBe(false);
  });

  it("rejects invalid workspacePath", () => {
    const payload = { workspacePath: "relative/path", focusWorkspace: false };

    expect(() => validate(WorkspaceSwitchPayloadSchema, payload)).toThrow(ValidationError);
  });

  it("rejects non-boolean focusWorkspace", () => {
    const payload = {
      workspacePath: "/test/repo/.worktrees/ws1",
      focusWorkspace: "false",
    };

    expect(() => validate(WorkspaceSwitchPayloadSchema, payload)).toThrow(ValidationError);
  });
});

describe("AgentGetStatusPayloadSchema", () => {
  it("accepts valid absolute workspacePath", () => {
    const payload = { workspacePath: "/test/repo/.worktrees/ws1" };
    const result = validate(AgentGetStatusPayloadSchema, payload);

    expect(result.workspacePath).toBe("/test/repo/.worktrees/ws1");
  });

  it("rejects relative path", () => {
    const payload = { workspacePath: "relative/path" };

    expect(() => validate(AgentGetStatusPayloadSchema, payload)).toThrow(ValidationError);
  });

  it("rejects path with traversal that escapes root", () => {
    // On Unix, "/../etc/passwd" normalizes to "/etc/passwd" (no ".." remains)
    // But a relative path starting with ".." would fail the absolute check
    const payload = { workspacePath: "../etc/passwd" };

    expect(() => validate(AgentGetStatusPayloadSchema, payload)).toThrow(ValidationError);
  });

  it("rejects missing workspacePath", () => {
    const payload = {};

    expect(() => validate(AgentGetStatusPayloadSchema, payload)).toThrow(ValidationError);
  });
});

describe("absolutePathSchema", () => {
  describe("path normalization (cross-platform)", () => {
    it("accepts and normalizes forward-slash paths", () => {
      // Simulates Windows-style path from git with forward slashes
      // On Windows: "C:/Users/foo" normalizes to "C:\\Users\\foo"
      // On Unix: "/home/user/foo" stays "/home/user/foo"
      const input = "/home/user/project";
      const result = validate(absolutePathSchema, input);

      expect(result).toBe(path.normalize(input));
    });

    it("normalizes paths with redundant separators", () => {
      const input = "/home//user///project";
      const result = validate(absolutePathSchema, input);

      expect(result).toBe(path.normalize(input));
      expect(result).not.toContain("//");
    });

    it("normalizes paths with . segments", () => {
      const input = "/home/./user/./project";
      const result = validate(absolutePathSchema, input);

      expect(result).toBe("/home/user/project");
    });

    it("resolves .. segments within path", () => {
      // "/home/user/../other" normalizes to "/home/other"
      const input = "/home/user/../other";
      const result = validate(absolutePathSchema, input);

      expect(result).toBe(path.normalize(input));
      expect(result).not.toContain("..");
    });
  });

  describe("validation errors", () => {
    it("rejects relative paths with specific error message", () => {
      const input = "relative/path";

      try {
        validate(absolutePathSchema, input);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).message).toContain("Path must be absolute");
      }
    });

    it("rejects paths that escape root (.. remains after normalization)", () => {
      // This is a relative path that starts with ".."
      const input = "../escape/attempt";

      try {
        validate(absolutePathSchema, input);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        // Will fail on "absolute" check since relative paths normalize but stay relative
        expect((error as ValidationError).message).toContain("Path must be absolute");
      }
    });
  });
});
