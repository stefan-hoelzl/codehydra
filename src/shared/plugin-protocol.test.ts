/**
 * Unit tests for plugin protocol types and validators.
 */

import { describe, it, expect } from "vitest";
import {
  validateSetMetadataRequest,
  normalizeWorkspacePath,
  isValidCommandRequest,
  COMMAND_TIMEOUT_MS,
} from "./plugin-protocol";

describe("validateSetMetadataRequest", () => {
  describe("valid requests", () => {
    it("accepts valid key with string value", () => {
      const result = validateSetMetadataRequest({ key: "note", value: "test value" });
      expect(result).toEqual({ valid: true });
    });

    it("accepts valid key with null value (delete)", () => {
      const result = validateSetMetadataRequest({ key: "note", value: null });
      expect(result).toEqual({ valid: true });
    });

    it("accepts alphanumeric key with hyphens", () => {
      const result = validateSetMetadataRequest({ key: "model-name", value: "gpt-4" });
      expect(result).toEqual({ valid: true });
    });

    it("accepts key starting with uppercase", () => {
      const result = validateSetMetadataRequest({ key: "MyKey", value: "value" });
      expect(result).toEqual({ valid: true });
    });

    it("accepts empty string value", () => {
      const result = validateSetMetadataRequest({ key: "note", value: "" });
      expect(result).toEqual({ valid: true });
    });
  });

  describe("invalid requests - structure", () => {
    it("rejects null payload", () => {
      const result = validateSetMetadataRequest(null);
      expect(result).toEqual({ valid: false, error: "Request must be an object" });
    });

    it("rejects undefined payload", () => {
      const result = validateSetMetadataRequest(undefined);
      expect(result).toEqual({ valid: false, error: "Request must be an object" });
    });

    it("rejects primitive values", () => {
      expect(validateSetMetadataRequest("string")).toEqual({
        valid: false,
        error: "Request must be an object",
      });
      expect(validateSetMetadataRequest(123)).toEqual({
        valid: false,
        error: "Request must be an object",
      });
      expect(validateSetMetadataRequest(true)).toEqual({
        valid: false,
        error: "Request must be an object",
      });
    });

    it("rejects array payload", () => {
      const result = validateSetMetadataRequest([]);
      expect(result).toEqual({ valid: false, error: "Missing required field: key" });
    });
  });

  describe("invalid requests - missing fields", () => {
    it("rejects missing key field", () => {
      const result = validateSetMetadataRequest({ value: "test" });
      expect(result).toEqual({ valid: false, error: "Missing required field: key" });
    });

    it("rejects missing value field", () => {
      const result = validateSetMetadataRequest({ key: "note" });
      expect(result).toEqual({ valid: false, error: "Missing required field: value" });
    });

    it("rejects empty object", () => {
      const result = validateSetMetadataRequest({});
      expect(result).toEqual({ valid: false, error: "Missing required field: key" });
    });
  });

  describe("invalid requests - wrong types", () => {
    it("rejects non-string key", () => {
      expect(validateSetMetadataRequest({ key: 123, value: "test" })).toEqual({
        valid: false,
        error: "Field 'key' must be a string",
      });
      expect(validateSetMetadataRequest({ key: null, value: "test" })).toEqual({
        valid: false,
        error: "Field 'key' must be a string",
      });
      expect(validateSetMetadataRequest({ key: {}, value: "test" })).toEqual({
        valid: false,
        error: "Field 'key' must be a string",
      });
    });

    it("rejects non-string/null value", () => {
      expect(validateSetMetadataRequest({ key: "note", value: 123 })).toEqual({
        valid: false,
        error: "Field 'value' must be a string or null",
      });
      expect(validateSetMetadataRequest({ key: "note", value: {} })).toEqual({
        valid: false,
        error: "Field 'value' must be a string or null",
      });
      expect(validateSetMetadataRequest({ key: "note", value: [] })).toEqual({
        valid: false,
        error: "Field 'value' must be a string or null",
      });
      expect(validateSetMetadataRequest({ key: "note", value: true })).toEqual({
        valid: false,
        error: "Field 'value' must be a string or null",
      });
    });
  });

  describe("invalid requests - key format", () => {
    it("rejects empty key", () => {
      const result = validateSetMetadataRequest({ key: "", value: "test" });
      expect(result).toEqual({ valid: false, error: "Field 'key' cannot be empty" });
    });

    it("rejects key starting with digit", () => {
      const result = validateSetMetadataRequest({ key: "123note", value: "test" });
      expect(result.valid).toBe(false);
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toContain("Invalid key format");
    });

    it("rejects key starting with underscore", () => {
      const result = validateSetMetadataRequest({ key: "_private", value: "test" });
      expect(result.valid).toBe(false);
      expect((result as { error: string }).error).toContain("Invalid key format");
    });

    it("rejects key with underscore", () => {
      const result = validateSetMetadataRequest({ key: "my_key", value: "test" });
      expect(result.valid).toBe(false);
      expect((result as { error: string }).error).toContain("Invalid key format");
    });

    it("rejects key ending with hyphen", () => {
      const result = validateSetMetadataRequest({ key: "note-", value: "test" });
      expect(result.valid).toBe(false);
      expect((result as { error: string }).error).toContain("Invalid key format");
    });

    it("rejects key with special characters", () => {
      const result = validateSetMetadataRequest({ key: "my.key", value: "test" });
      expect(result.valid).toBe(false);
      expect((result as { error: string }).error).toContain("Invalid key format");
    });
  });
});

// These tests were moved from plugin-server.test.ts to consolidate protocol tests
describe("isValidCommandRequest", () => {
  it("returns true for valid object with command only", () => {
    expect(isValidCommandRequest({ command: "test.command" })).toBe(true);
  });

  it("returns true for valid object with command and args array", () => {
    expect(isValidCommandRequest({ command: "test.command", args: [1, "two", true] })).toBe(true);
  });

  it("returns true for valid object with empty args array", () => {
    expect(isValidCommandRequest({ command: "test.command", args: [] })).toBe(true);
  });

  it("returns false for object with non-string command", () => {
    expect(isValidCommandRequest({ command: 123 })).toBe(false);
    expect(isValidCommandRequest({ command: null })).toBe(false);
    expect(isValidCommandRequest({ command: undefined })).toBe(false);
    expect(isValidCommandRequest({ command: {} })).toBe(false);
  });

  it("returns false for object with non-array args", () => {
    expect(isValidCommandRequest({ command: "test.command", args: "not-array" })).toBe(false);
    expect(isValidCommandRequest({ command: "test.command", args: 123 })).toBe(false);
    expect(isValidCommandRequest({ command: "test.command", args: {} })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isValidCommandRequest(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isValidCommandRequest(undefined)).toBe(false);
  });

  it("returns false for non-object values", () => {
    expect(isValidCommandRequest("string")).toBe(false);
    expect(isValidCommandRequest(123)).toBe(false);
    expect(isValidCommandRequest(true)).toBe(false);
  });

  it("returns false for object missing command property", () => {
    expect(isValidCommandRequest({})).toBe(false);
    expect(isValidCommandRequest({ args: [] })).toBe(false);
    expect(isValidCommandRequest({ other: "value" })).toBe(false);
  });
});

describe("COMMAND_TIMEOUT_MS constant", () => {
  it("exports default timeout of 10 seconds", () => {
    expect(COMMAND_TIMEOUT_MS).toBe(10_000);
  });
});

describe("normalizeWorkspacePath", () => {
  it("normalizes path with trailing separator", () => {
    expect(normalizeWorkspacePath("/test/workspace/")).toBe("/test/workspace");
  });

  it("normalizes path with double separators", () => {
    expect(normalizeWorkspacePath("/test//workspace")).toBe("/test/workspace");
  });

  it("handles Windows-style paths by converting to forward slashes", () => {
    // Windows backslashes are converted to forward slashes for cross-platform consistency
    expect(normalizeWorkspacePath("C:\\Users\\test\\workspace")).toBe("C:/Users/test/workspace");
  });

  it("handles Windows paths with trailing backslash", () => {
    expect(normalizeWorkspacePath("C:\\Users\\test\\workspace\\")).toBe("C:/Users/test/workspace");
  });

  it("handles empty string", () => {
    expect(normalizeWorkspacePath("")).toBe(".");
  });

  it("handles root path", () => {
    expect(normalizeWorkspacePath("/")).toBe("/");
  });

  it("handles relative path", () => {
    expect(normalizeWorkspacePath("relative/path")).toBe("relative/path");
  });
});
