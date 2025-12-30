/**
 * Unit tests for LifecycleModule.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LifecycleModule, type LifecycleModuleDeps, type MinimalApp } from "./index";
import { createMockRegistry } from "../../api/registry.test-utils";
import type { MockApiRegistry } from "../../api/registry.test-utils";
import type {
  IVscodeSetup,
  PreflightResult,
  SetupResult,
} from "../../../services/vscode-setup/types";
import { createMockLogger } from "../../../services/logging";

// =============================================================================
// Mock Factories
// =============================================================================

function createMockApp(): MinimalApp {
  return {
    quit: vi.fn(),
  };
}

function createMockVscodeSetup(overrides: Partial<IVscodeSetup> = {}): IVscodeSetup {
  return {
    isSetupComplete: vi.fn().mockResolvedValue(true),
    preflight: vi.fn().mockResolvedValue({
      success: true,
      needsSetup: false,
      missingBinaries: [],
      missingExtensions: [],
      outdatedExtensions: [],
    } as PreflightResult),
    setup: vi.fn().mockResolvedValue({ success: true } as SetupResult),
    cleanVscodeDir: vi.fn().mockResolvedValue(undefined),
    cleanComponents: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockDeps(overrides: Partial<LifecycleModuleDeps> = {}): LifecycleModuleDeps {
  return {
    vscodeSetup: createMockVscodeSetup(),
    app: createMockApp(),
    onSetupComplete: vi.fn().mockResolvedValue(undefined),
    logger: createMockLogger(),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("lifecycle.getState", () => {
  let registry: MockApiRegistry;
  let deps: LifecycleModuleDeps;

  beforeEach(() => {
    registry = createMockRegistry();
    deps = createMockDeps();
  });

  it("returns 'ready' when no vscodeSetup provided", async () => {
    deps = createMockDeps({ vscodeSetup: undefined });
    new LifecycleModule(registry, deps);

    const handler = registry.getHandler("lifecycle.getState");
    expect(handler).toBeDefined();

    const result = await handler!({});
    expect(result).toBe("ready");
  });

  it("returns 'ready' when preflight shows no setup needed", async () => {
    const vscodeSetup = createMockVscodeSetup({
      preflight: vi.fn().mockResolvedValue({
        success: true,
        needsSetup: false,
        missingBinaries: [],
        missingExtensions: [],
        outdatedExtensions: [],
      }),
    });
    deps = createMockDeps({ vscodeSetup });
    new LifecycleModule(registry, deps);

    const handler = registry.getHandler("lifecycle.getState");
    const result = await handler!({});

    expect(result).toBe("ready");
    expect(vscodeSetup.preflight).toHaveBeenCalled();
  });

  it("returns 'setup' when preflight shows setup needed", async () => {
    const vscodeSetup = createMockVscodeSetup({
      preflight: vi.fn().mockResolvedValue({
        success: true,
        needsSetup: true,
        missingBinaries: ["code-server"],
        missingExtensions: [],
        outdatedExtensions: [],
      }),
    });
    deps = createMockDeps({ vscodeSetup });
    new LifecycleModule(registry, deps);

    const handler = registry.getHandler("lifecycle.getState");
    const result = await handler!({});

    expect(result).toBe("setup");
  });

  it("returns 'setup' when preflight fails", async () => {
    const vscodeSetup = createMockVscodeSetup({
      preflight: vi.fn().mockResolvedValue({
        success: false,
        error: { type: "unknown", message: "Preflight failed" },
      }),
    });
    deps = createMockDeps({ vscodeSetup });
    new LifecycleModule(registry, deps);

    const handler = registry.getHandler("lifecycle.getState");
    const result = await handler!({});

    expect(result).toBe("setup");
  });
});

describe("lifecycle.setup", () => {
  let registry: MockApiRegistry;
  let deps: LifecycleModuleDeps;

  beforeEach(() => {
    registry = createMockRegistry();
    deps = createMockDeps();
  });

  it("calls onSetupComplete when no vscodeSetup provided", async () => {
    const onSetupComplete = vi.fn().mockResolvedValue(undefined);
    deps = createMockDeps({ vscodeSetup: undefined, onSetupComplete });
    new LifecycleModule(registry, deps);

    const handler = registry.getHandler("lifecycle.setup");
    const result = await handler!({});

    expect(result).toEqual({ success: true });
    expect(onSetupComplete).toHaveBeenCalled();
  });

  it("runs setup and calls onSetupComplete on success", async () => {
    const onSetupComplete = vi.fn().mockResolvedValue(undefined);
    const vscodeSetup = createMockVscodeSetup({
      preflight: vi.fn().mockResolvedValue({
        success: true,
        needsSetup: true,
        missingBinaries: ["code-server"],
        missingExtensions: [],
        outdatedExtensions: [],
      }),
      setup: vi.fn().mockResolvedValue({ success: true }),
    });
    deps = createMockDeps({ vscodeSetup, onSetupComplete });
    new LifecycleModule(registry, deps);

    const handler = registry.getHandler("lifecycle.setup");
    const result = await handler!({});

    expect(result).toEqual({ success: true });
    expect(vscodeSetup.setup).toHaveBeenCalled();
    expect(onSetupComplete).toHaveBeenCalled();
  });

  it("returns error when setup fails", async () => {
    const vscodeSetup = createMockVscodeSetup({
      preflight: vi.fn().mockResolvedValue({
        success: true,
        needsSetup: true,
        missingBinaries: ["code-server"],
        missingExtensions: [],
        outdatedExtensions: [],
      }),
      setup: vi.fn().mockResolvedValue({
        success: false,
        error: { type: "network", message: "Download failed" },
      }),
    });
    deps = createMockDeps({ vscodeSetup });
    new LifecycleModule(registry, deps);

    const handler = registry.getHandler("lifecycle.setup");
    const result = await handler!({});

    expect(result).toEqual({
      success: false,
      message: "Download failed",
      code: "network",
    });
  });

  it("returns error when setup throws", async () => {
    const vscodeSetup = createMockVscodeSetup({
      preflight: vi.fn().mockResolvedValue({
        success: true,
        needsSetup: true,
        missingBinaries: ["code-server"],
        missingExtensions: [],
        outdatedExtensions: [],
      }),
      setup: vi.fn().mockRejectedValue(new Error("Unexpected error")),
    });
    deps = createMockDeps({ vscodeSetup });
    new LifecycleModule(registry, deps);

    const handler = registry.getHandler("lifecycle.setup");
    const result = await handler!({});

    expect(result).toEqual({
      success: false,
      message: "Unexpected error",
      code: "UNKNOWN",
    });
  });

  it("prevents concurrent setup", async () => {
    let setupResolve: () => void = () => {};
    const vscodeSetup = createMockVscodeSetup({
      preflight: vi.fn().mockResolvedValue({
        success: true,
        needsSetup: true,
        missingBinaries: ["code-server"],
        missingExtensions: [],
        outdatedExtensions: [],
      }),
      setup: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setupResolve = () => resolve({ success: true });
          })
      ),
    });
    deps = createMockDeps({ vscodeSetup });
    new LifecycleModule(registry, deps);

    const handler = registry.getHandler("lifecycle.setup");

    // Start first setup
    const setup1 = handler!({});

    // Start second setup before first completes
    const setup2 = handler!({});

    // Second should fail immediately
    const result2 = await setup2;
    expect(result2).toEqual({
      success: false,
      message: "Setup already in progress",
      code: "SETUP_IN_PROGRESS",
    });

    // Complete first setup
    setupResolve();
    const result1 = await setup1;
    expect(result1).toEqual({ success: true });
  });

  it("skips setup when preflight shows no setup needed", async () => {
    const onSetupComplete = vi.fn().mockResolvedValue(undefined);
    const vscodeSetup = createMockVscodeSetup({
      preflight: vi.fn().mockResolvedValue({
        success: true,
        needsSetup: false,
        missingBinaries: [],
        missingExtensions: [],
        outdatedExtensions: [],
      }),
    });
    deps = createMockDeps({ vscodeSetup, onSetupComplete });
    new LifecycleModule(registry, deps);

    const handler = registry.getHandler("lifecycle.setup");
    const result = await handler!({});

    expect(result).toEqual({ success: true });
    expect(vscodeSetup.setup).not.toHaveBeenCalled();
    expect(onSetupComplete).toHaveBeenCalled();
  });
});

describe("lifecycle.quit", () => {
  let registry: MockApiRegistry;
  let deps: LifecycleModuleDeps;

  beforeEach(() => {
    registry = createMockRegistry();
    deps = createMockDeps();
  });

  it("calls app.quit()", async () => {
    const app = createMockApp();
    deps = createMockDeps({ app });
    new LifecycleModule(registry, deps);

    const handler = registry.getHandler("lifecycle.quit");
    await handler!({});

    expect(app.quit).toHaveBeenCalled();
  });
});

describe("lifecycle.registration", () => {
  let registry: MockApiRegistry;
  let deps: LifecycleModuleDeps;

  beforeEach(() => {
    registry = createMockRegistry();
    deps = createMockDeps();
  });

  it("registers all lifecycle.* paths with IPC", () => {
    new LifecycleModule(registry, deps);

    const registeredPaths = registry.getRegisteredPaths();
    expect(registeredPaths).toContain("lifecycle.getState");
    expect(registeredPaths).toContain("lifecycle.setup");
    expect(registeredPaths).toContain("lifecycle.quit");

    // Verify register was called with IPC options
    expect(registry.register).toHaveBeenCalledWith("lifecycle.getState", expect.any(Function), {
      ipc: "api:lifecycle:get-state",
    });
    expect(registry.register).toHaveBeenCalledWith("lifecycle.setup", expect.any(Function), {
      ipc: "api:lifecycle:setup",
    });
    expect(registry.register).toHaveBeenCalledWith("lifecycle.quit", expect.any(Function), {
      ipc: "api:lifecycle:quit",
    });
  });
});

describe("LifecycleModule.dispose", () => {
  let registry: MockApiRegistry;
  let deps: LifecycleModuleDeps;

  beforeEach(() => {
    registry = createMockRegistry();
    deps = createMockDeps();
  });

  it("dispose is a no-op (IPC handlers cleaned up by ApiRegistry)", () => {
    const module = new LifecycleModule(registry, deps);

    // Should not throw
    expect(() => module.dispose()).not.toThrow();
  });
});
