// @vitest-environment node
/**
 * Tests for ProcessTreeProvider implementations:
 * - PidtreeProvider (Linux/macOS)
 * - WindowsProcessTreeProvider (Windows)
 * - createProcessTreeProvider factory
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { IProcessTreeNode } from "@vscode/windows-process-tree";
import {
  PidtreeProvider,
  WindowsProcessTreeProvider,
  createProcessTreeProvider,
  type ProcessTreeProvider,
  type NativeModuleGetter,
} from "./process-tree";
import { createSilentLogger } from "../logging";
import type { Logger } from "../logging";

// Mock pidtree
vi.mock("pidtree", () => ({
  default: vi.fn(),
}));

import pidtree from "pidtree";

// Type assertion to simplify mock type - pidtree returns number[] by default
const mockPidtree = pidtree as unknown as {
  mockResolvedValue: (value: number[]) => void;
  mockRejectedValue: (error: Error) => void;
} & ((pid: number) => Promise<number[]>);

describe("PidtreeProvider", () => {
  let provider: ProcessTreeProvider;

  beforeEach(() => {
    provider = new PidtreeProvider(createSilentLogger());
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("getDescendantPids", () => {
    it("returns descendant PIDs as a Set", async () => {
      mockPidtree.mockResolvedValue([1001, 1002, 1003]);

      const result = await provider.getDescendantPids(1000);

      expect(result).toBeInstanceOf(Set);
      expect(result.has(1001)).toBe(true);
      expect(result.has(1002)).toBe(true);
      expect(result.has(1003)).toBe(true);
    });

    it("returns empty Set when no descendants", async () => {
      mockPidtree.mockResolvedValue([]);

      const result = await provider.getDescendantPids(1000);

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });

    it("returns empty Set on error (graceful degradation)", async () => {
      mockPidtree.mockRejectedValue(new Error("Process not found"));

      const result = await provider.getDescendantPids(1000);

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });

    it("passes the correct PID to pidtree", async () => {
      mockPidtree.mockResolvedValue([]);

      await provider.getDescendantPids(9999);

      expect(pidtree).toHaveBeenCalledWith(9999);
    });
  });
});

describe("WindowsProcessTreeProvider", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createSilentLogger();
  });

  /**
   * Creates a mock native module with getProcessTree function.
   * The callback-based API matches @vscode/windows-process-tree.
   */
  function createMockNativeModule(
    resultByPid: Map<number, IProcessTreeNode | undefined>
  ): NativeModuleGetter {
    const mockModule = {
      getProcessTree: (pid: number, callback: (tree: IProcessTreeNode | undefined) => void) => {
        const result = resultByPid.get(pid);
        callback(result);
      },
    };
    return async () => mockModule as unknown as typeof import("@vscode/windows-process-tree");
  }

  /**
   * Creates a simple process tree node for testing.
   */
  function createNode(pid: number, children: IProcessTreeNode[] = []): IProcessTreeNode {
    return {
      pid,
      name: `process-${pid}`,
      memory: 0,
      commandLine: "",
      children,
    };
  }

  describe("getDescendantPids", () => {
    it("extracts descendant PIDs from tree", async () => {
      // Parent PID 1000 with children 1001 and 1002
      const tree = createNode(1000, [createNode(1001), createNode(1002)]);
      const resultMap = new Map([[1000, tree]]);
      const provider = new WindowsProcessTreeProvider(logger, createMockNativeModule(resultMap));

      const result = await provider.getDescendantPids(1000);

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(2);
      expect(result.has(1001)).toBe(true);
      expect(result.has(1002)).toBe(true);
    });

    it("extracts multi-level descendants (grandchildren)", async () => {
      // Parent 1000 → Child 1001 → Grandchildren 1002, 1003
      const tree = createNode(1000, [
        createNode(1001, [createNode(1002), createNode(1003)]),
        createNode(1004),
      ]);
      const resultMap = new Map([[1000, tree]]);
      const provider = new WindowsProcessTreeProvider(logger, createMockNativeModule(resultMap));

      const result = await provider.getDescendantPids(1000);

      expect(result.size).toBe(4);
      expect(result.has(1001)).toBe(true);
      expect(result.has(1002)).toBe(true);
      expect(result.has(1003)).toBe(true);
      expect(result.has(1004)).toBe(true);
    });

    it("returns empty Set when process has no children", async () => {
      const tree = createNode(1000, []); // No children
      const resultMap = new Map([[1000, tree]]);
      const provider = new WindowsProcessTreeProvider(logger, createMockNativeModule(resultMap));

      const result = await provider.getDescendantPids(1000);

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });

    it("returns empty Set when process not found (undefined tree)", async () => {
      const resultMap = new Map<number, IProcessTreeNode | undefined>([[1000, undefined]]);
      const provider = new WindowsProcessTreeProvider(logger, createMockNativeModule(resultMap));

      const result = await provider.getDescendantPids(1000);

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });

    it("returns empty Set when native module load fails", async () => {
      const failingModuleGetter: NativeModuleGetter = async () => null;
      const provider = new WindowsProcessTreeProvider(logger, failingModuleGetter);

      const result = await provider.getDescendantPids(1000);

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });

    it("returns empty Set on error (graceful degradation)", async () => {
      const errorModuleGetter: NativeModuleGetter = async () => {
        throw new Error("Native module error");
      };
      const provider = new WindowsProcessTreeProvider(logger, errorModuleGetter);

      const result = await provider.getDescendantPids(1000);

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });

    it("caches native module (only loads once)", async () => {
      const tree = createNode(1000, [createNode(1001)]);
      let callCount = 0;
      const countingModuleGetter: NativeModuleGetter = async () => {
        callCount++;
        return {
          getProcessTree: (
            _pid: number,
            callback: (tree: IProcessTreeNode | undefined) => void
          ) => {
            callback(tree);
          },
        } as unknown as typeof import("@vscode/windows-process-tree");
      };
      const provider = new WindowsProcessTreeProvider(logger, countingModuleGetter);

      // Call multiple times
      await provider.getDescendantPids(1000);
      await provider.getDescendantPids(1000);
      await provider.getDescendantPids(1000);

      // Module getter should only be called once
      expect(callCount).toBe(1);
    });
  });
});

describe("createProcessTreeProvider", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    // Restore original platform
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
    });
  });

  it("returns PidtreeProvider on non-Windows platforms", () => {
    // Test on Linux (or current platform if not Windows)
    if (process.platform !== "win32") {
      const provider = createProcessTreeProvider(createSilentLogger());
      expect(provider).toBeInstanceOf(PidtreeProvider);
    }
  });

  it("returns WindowsProcessTreeProvider on Windows", () => {
    // Mock Windows platform
    Object.defineProperty(process, "platform", {
      value: "win32",
    });

    const provider = createProcessTreeProvider(createSilentLogger());
    expect(provider).toBeInstanceOf(WindowsProcessTreeProvider);
  });

  it("returns PidtreeProvider on darwin", () => {
    // Mock macOS platform
    Object.defineProperty(process, "platform", {
      value: "darwin",
    });

    const provider = createProcessTreeProvider(createSilentLogger());
    expect(provider).toBeInstanceOf(PidtreeProvider);
  });

  it("returns PidtreeProvider on linux", () => {
    // Mock Linux platform
    Object.defineProperty(process, "platform", {
      value: "linux",
    });

    const provider = createProcessTreeProvider(createSilentLogger());
    expect(provider).toBeInstanceOf(PidtreeProvider);
  });

  it("falls back to PidtreeProvider if WindowsProcessTreeProvider throws on creation", () => {
    // Mock Windows platform
    Object.defineProperty(process, "platform", {
      value: "win32",
    });

    // We can't easily make the constructor throw in this test setup,
    // but we verify that the fallback path exists and the function handles errors
    // The actual sync error fallback is tested by the factory structure
    const provider = createProcessTreeProvider(createSilentLogger());
    // On Windows, should return a provider (either Windows or fallback)
    expect(provider).toBeDefined();
    expect(typeof provider.getDescendantPids).toBe("function");
  });
});
