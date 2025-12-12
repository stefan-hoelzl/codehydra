// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("throttling", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Create a fresh copy of process.env for each test
    process.env = { ...originalEnv };
    // Clear the module cache to ensure fresh imports
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getThrottleLevel", () => {
    it("returns 'off' when env var not set", async () => {
      delete process.env.CODEHYDRA_WORKSPACE_THROTTLING;

      const { getThrottleLevel } = await import("./throttling");
      expect(getThrottleLevel()).toBe("off");
    });

    it("returns 'off' when env var is 'off'", async () => {
      process.env.CODEHYDRA_WORKSPACE_THROTTLING = "off";

      const { getThrottleLevel } = await import("./throttling");
      expect(getThrottleLevel()).toBe("off");
    });

    it("returns 'basic' when env var is 'basic'", async () => {
      process.env.CODEHYDRA_WORKSPACE_THROTTLING = "basic";

      const { getThrottleLevel } = await import("./throttling");
      expect(getThrottleLevel()).toBe("basic");
    });

    it("returns 'full' when env var is 'full'", async () => {
      process.env.CODEHYDRA_WORKSPACE_THROTTLING = "full";

      const { getThrottleLevel } = await import("./throttling");
      expect(getThrottleLevel()).toBe("full");
    });

    it("returns 'off' for invalid values", async () => {
      process.env.CODEHYDRA_WORKSPACE_THROTTLING = "invalid";

      const { getThrottleLevel } = await import("./throttling");
      expect(getThrottleLevel()).toBe("off");
    });

    it("returns 'off' for empty string", async () => {
      process.env.CODEHYDRA_WORKSPACE_THROTTLING = "";

      const { getThrottleLevel } = await import("./throttling");
      expect(getThrottleLevel()).toBe("off");
    });

    it("returns 'off' for uppercase values (case-sensitive)", async () => {
      process.env.CODEHYDRA_WORKSPACE_THROTTLING = "FULL";

      const { getThrottleLevel } = await import("./throttling");
      expect(getThrottleLevel()).toBe("off");
    });

    it("returns 'off' for mixed case values (case-sensitive)", async () => {
      process.env.CODEHYDRA_WORKSPACE_THROTTLING = "Basic";

      const { getThrottleLevel } = await import("./throttling");
      expect(getThrottleLevel()).toBe("off");
    });
  });

  describe("parseElectronFlags", () => {
    it("parses single flag", async () => {
      const { parseElectronFlags } = await import("./throttling");
      expect(parseElectronFlags("--disable-gpu")).toEqual([{ name: "disable-gpu" }]);
    });

    it("parses multiple flags separated by spaces", async () => {
      const { parseElectronFlags } = await import("./throttling");
      expect(parseElectronFlags("--flag1 --flag2")).toEqual([{ name: "flag1" }, { name: "flag2" }]);
    });

    it("parses multiple flags with extra whitespace", async () => {
      const { parseElectronFlags } = await import("./throttling");
      expect(parseElectronFlags("  --flag1   --flag2  ")).toEqual([
        { name: "flag1" },
        { name: "flag2" },
      ]);
    });

    it("parses flags with values using =", async () => {
      const { parseElectronFlags } = await import("./throttling");
      expect(parseElectronFlags("--use-gl=swiftshader")).toEqual([
        { name: "use-gl", value: "swiftshader" },
      ]);
    });

    it("parses mixed flags with and without values", async () => {
      const { parseElectronFlags } = await import("./throttling");
      expect(parseElectronFlags("--disable-gpu --use-gl=swiftshader --no-sandbox")).toEqual([
        { name: "disable-gpu" },
        { name: "use-gl", value: "swiftshader" },
        { name: "no-sandbox" },
      ]);
    });

    it("throws on double quotes", async () => {
      const { parseElectronFlags } = await import("./throttling");
      expect(() => parseElectronFlags('--flag="value"')).toThrow("Quoted values are not supported");
    });

    it("throws on single quotes", async () => {
      const { parseElectronFlags } = await import("./throttling");
      expect(() => parseElectronFlags("--flag='value'")).toThrow("Quoted values are not supported");
    });

    it("returns empty array for empty string", async () => {
      const { parseElectronFlags } = await import("./throttling");
      expect(parseElectronFlags("")).toEqual([]);
    });

    it("returns empty array for whitespace-only string", async () => {
      const { parseElectronFlags } = await import("./throttling");
      expect(parseElectronFlags("   ")).toEqual([]);
    });

    it("returns empty array for undefined", async () => {
      const { parseElectronFlags } = await import("./throttling");
      expect(parseElectronFlags(undefined)).toEqual([]);
    });
  });

  describe("applyElectronFlags", () => {
    it("applies flags via app.commandLine.appendSwitch", async () => {
      process.env.CODEHYDRA_ELECTRON_FLAGS = "--disable-gpu --use-gl=swiftshader";

      const mockApp = {
        commandLine: {
          appendSwitch: vi.fn(),
        },
      };

      const { applyElectronFlags } = await import("./throttling");
      applyElectronFlags(mockApp as unknown as Electron.App);

      expect(mockApp.commandLine.appendSwitch).toHaveBeenCalledWith("disable-gpu");
      expect(mockApp.commandLine.appendSwitch).toHaveBeenCalledWith("use-gl", "swiftshader");
    });

    it("does nothing when env var not set", async () => {
      delete process.env.CODEHYDRA_ELECTRON_FLAGS;

      const mockApp = {
        commandLine: {
          appendSwitch: vi.fn(),
        },
      };

      const { applyElectronFlags } = await import("./throttling");
      applyElectronFlags(mockApp as unknown as Electron.App);

      expect(mockApp.commandLine.appendSwitch).not.toHaveBeenCalled();
    });

    it("logs applied flags to console", async () => {
      process.env.CODEHYDRA_ELECTRON_FLAGS = "--disable-gpu";

      const mockApp = {
        commandLine: {
          appendSwitch: vi.fn(),
        },
      };

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const { applyElectronFlags } = await import("./throttling");
      applyElectronFlags(mockApp as unknown as Electron.App);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("disable-gpu"));
      consoleSpy.mockRestore();
    });
  });
});
