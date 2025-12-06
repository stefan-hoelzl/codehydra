// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExecException } from "node:child_process";

type ExecCallback = (error: ExecException | null, stdout: string, stderr: string) => void;

// Mock child_process - the mock is hoisted so we use vi.hoisted to get a reference
const { mockExec } = vi.hoisted(() => {
  return {
    mockExec: vi.fn<(command: string, callback?: ExecCallback) => void>(),
  };
});

vi.mock("node:child_process", () => ({
  exec: mockExec,
}));

// Import after mocking
import { openExternal, ALLOWED_SCHEMES } from "./external-url";

describe("external-url", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console.error in tests
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("ALLOWED_SCHEMES", () => {
    it("includes http:", () => {
      expect(ALLOWED_SCHEMES).toContain("http:");
    });

    it("includes https:", () => {
      expect(ALLOWED_SCHEMES).toContain("https:");
    });

    it("includes mailto:", () => {
      expect(ALLOWED_SCHEMES).toContain("mailto:");
    });
  });

  describe("openExternal", () => {
    describe("scheme validation", () => {
      it("allows http:// URLs", () => {
        expect(() => openExternal("http://example.com")).not.toThrow();
      });

      it("allows https:// URLs", () => {
        expect(() => openExternal("https://example.com")).not.toThrow();
      });

      it("allows mailto: URLs", () => {
        expect(() => openExternal("mailto:test@example.com")).not.toThrow();
      });

      it("throws for file:// scheme", () => {
        expect(() => openExternal("file:///etc/passwd")).toThrow(
          "URL scheme 'file:' is not allowed"
        );
      });

      it("throws for javascript: scheme", () => {
        expect(() => openExternal("javascript:alert(1)")).toThrow(
          "URL scheme 'javascript:' is not allowed"
        );
      });

      it("throws for data: scheme", () => {
        expect(() => openExternal("data:text/html,<script>alert(1)</script>")).toThrow(
          "URL scheme 'data:' is not allowed"
        );
      });

      it("throws for vbscript: scheme", () => {
        expect(() => openExternal("vbscript:alert")).toThrow(
          "URL scheme 'vbscript:' is not allowed"
        );
      });

      it("throws for invalid URLs", () => {
        expect(() => openExternal("not-a-url")).toThrow("Invalid URL");
      });
    });

    describe("Linux platform", () => {
      const originalPlatform = process.platform;

      beforeEach(() => {
        Object.defineProperty(process, "platform", { value: "linux" });
      });

      afterEach(() => {
        Object.defineProperty(process, "platform", { value: originalPlatform });
      });

      it("tries gdbus portal first", () => {
        // Simulate success
        mockExec.mockImplementation((_command: string, callback?: ExecCallback) => {
          if (callback) callback(null, "", "");
        });

        openExternal("https://example.com");

        expect(mockExec).toHaveBeenCalledTimes(1);
        expect(mockExec.mock.calls[0]?.[0]).toMatch(/^gdbus call.*OpenURI/);
        expect(mockExec.mock.calls[0]?.[0]).toContain("https://example.com");
      });

      it("falls back to xdg-open when gdbus fails", () => {
        // First call (gdbus) fails, second call (xdg-open) succeeds
        mockExec
          .mockImplementationOnce((_command: string, callback?: ExecCallback) => {
            if (callback) callback(new Error("gdbus failed") as ExecException, "", "");
          })
          .mockImplementationOnce((_command: string, callback?: ExecCallback) => {
            if (callback) callback(null, "", "");
          });

        openExternal("https://example.com");

        expect(mockExec).toHaveBeenCalledTimes(2);
        expect(mockExec.mock.calls[1]?.[0]).toBe('xdg-open "https://example.com"');
      });

      it("logs error when all Linux openers fail", () => {
        // Both gdbus and xdg-open fail
        mockExec.mockImplementation((_command: string, callback?: ExecCallback) => {
          if (callback) callback(new Error("failed") as ExecException, "", "");
        });

        openExternal("https://example.com");

        expect(console.error).toHaveBeenCalledWith(
          expect.stringContaining("Failed to open external URL")
        );
      });
    });

    describe("macOS platform", () => {
      const originalPlatform = process.platform;

      beforeEach(() => {
        Object.defineProperty(process, "platform", { value: "darwin" });
      });

      afterEach(() => {
        Object.defineProperty(process, "platform", { value: originalPlatform });
      });

      it("uses open command", () => {
        mockExec.mockImplementation((_command: string, callback?: ExecCallback) => {
          if (callback) callback(null, "", "");
        });

        openExternal("https://example.com");

        expect(mockExec).toHaveBeenCalledTimes(1);
        expect(mockExec.mock.calls[0]?.[0]).toBe('open "https://example.com"');
      });

      it("logs error when open fails", () => {
        mockExec.mockImplementation((_command: string, callback?: ExecCallback) => {
          if (callback) callback(new Error("failed") as ExecException, "", "");
        });

        openExternal("https://example.com");

        expect(console.error).toHaveBeenCalledWith(
          expect.stringContaining("Failed to open external URL")
        );
      });
    });

    describe("Windows platform", () => {
      const originalPlatform = process.platform;

      beforeEach(() => {
        Object.defineProperty(process, "platform", { value: "win32" });
      });

      afterEach(() => {
        Object.defineProperty(process, "platform", { value: originalPlatform });
      });

      it("uses start command", () => {
        mockExec.mockImplementation((_command: string, callback?: ExecCallback) => {
          if (callback) callback(null, "", "");
        });

        openExternal("https://example.com");

        expect(mockExec).toHaveBeenCalledTimes(1);
        expect(mockExec.mock.calls[0]?.[0]).toBe('start "" "https://example.com"');
      });

      it("logs error when start fails", () => {
        mockExec.mockImplementation((_command: string, callback?: ExecCallback) => {
          if (callback) callback(new Error("failed") as ExecException, "", "");
        });

        openExternal("https://example.com");

        expect(console.error).toHaveBeenCalledWith(
          expect.stringContaining("Failed to open external URL")
        );
      });
    });

    describe("URL escaping", () => {
      it("properly escapes URLs with special characters", () => {
        Object.defineProperty(process, "platform", { value: "darwin" });
        mockExec.mockImplementation((_command: string, callback?: ExecCallback) => {
          if (callback) callback(null, "", "");
        });

        openExternal("https://example.com/path?query=value&other=test");

        expect(mockExec.mock.calls[0]?.[0]).toBe(
          'open "https://example.com/path?query=value&other=test"'
        );
      });
    });

    describe("Unsupported platform", () => {
      const originalPlatform = process.platform;

      afterEach(() => {
        Object.defineProperty(process, "platform", { value: originalPlatform });
      });

      it("logs error for unsupported platform", () => {
        Object.defineProperty(process, "platform", { value: "freebsd" });

        openExternal("https://example.com");

        expect(console.error).toHaveBeenCalledWith(
          "Failed to open external URL: unsupported platform 'freebsd'"
        );
        expect(mockExec).not.toHaveBeenCalled();
      });
    });
  });
});
