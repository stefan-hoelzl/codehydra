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
    doStartServices: vi.fn().mockResolvedValue(undefined),
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

  it("returns 'loading' when no vscodeSetup provided", async () => {
    deps = createMockDeps({ vscodeSetup: undefined });
    new LifecycleModule(registry, deps);

    const handler = registry.getHandler("lifecycle.getState");
    expect(handler).toBeDefined();

    const result = await handler!({});
    expect(result).toBe("loading");
  });

  it("returns 'loading' when preflight shows no setup needed", async () => {
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

    expect(result).toBe("loading");
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

  it("returns success when no vscodeSetup provided (no setup to do)", async () => {
    deps = createMockDeps({ vscodeSetup: undefined });
    new LifecycleModule(registry, deps);

    const handler = registry.getHandler("lifecycle.setup");
    const result = await handler!({});

    expect(result).toEqual({ success: true });
    // doStartServices should NOT be called - renderer will call startServices() next
    expect(deps.doStartServices).not.toHaveBeenCalled();
  });

  it("runs setup and returns success without starting services", async () => {
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
    deps = createMockDeps({ vscodeSetup });
    new LifecycleModule(registry, deps);

    const handler = registry.getHandler("lifecycle.setup");
    const result = await handler!({});

    expect(result).toEqual({ success: true });
    expect(vscodeSetup.setup).toHaveBeenCalled();
    // doStartServices should NOT be called - renderer will call startServices() next
    expect(deps.doStartServices).not.toHaveBeenCalled();
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

    const handler = registry.getHandler("lifecycle.setup");
    const result = await handler!({});

    expect(result).toEqual({ success: true });
    expect(vscodeSetup.setup).not.toHaveBeenCalled();
    // doStartServices should NOT be called - renderer will call startServices() next
    expect(deps.doStartServices).not.toHaveBeenCalled();
  });

  it("after setup completes, getState still returns loading (not ready)", async () => {
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
    deps = createMockDeps({ vscodeSetup });
    new LifecycleModule(registry, deps);

    // First call getState to populate cache
    const getStateHandler = registry.getHandler("lifecycle.getState");
    await getStateHandler!({});

    // Then run setup
    const setupHandler = registry.getHandler("lifecycle.setup");
    await setupHandler!({});

    // After setup, reset the preflight mock to return no setup needed
    (vscodeSetup.preflight as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      needsSetup: false,
      missingBinaries: [],
      missingExtensions: [],
      outdatedExtensions: [],
    });

    // getState should still return "loading" (not "ready")
    const stateAfterSetup = await getStateHandler!({});
    expect(stateAfterSetup).toBe("loading");
  });
});

describe("lifecycle.startServices", () => {
  let registry: MockApiRegistry;
  let deps: LifecycleModuleDeps;

  beforeEach(() => {
    registry = createMockRegistry();
    deps = createMockDeps();
  });

  it("starts services and returns success", async () => {
    const doStartServices = vi.fn().mockResolvedValue(undefined);
    deps = createMockDeps({ doStartServices });
    new LifecycleModule(registry, deps);

    const handler = registry.getHandler("lifecycle.startServices");
    const result = await handler!({});

    expect(result).toEqual({ success: true });
    expect(doStartServices).toHaveBeenCalledTimes(1);
  });

  it("returns success immediately on second call (idempotent)", async () => {
    const doStartServices = vi.fn().mockImplementation(async () => {
      // Simulate some work
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    deps = createMockDeps({ doStartServices });
    new LifecycleModule(registry, deps);

    const handler = registry.getHandler("lifecycle.startServices");

    // First call
    const startTime = Date.now();
    const result1 = await handler!({});
    const firstCallDuration = Date.now() - startTime;

    // Second call should return immediately
    const secondStartTime = Date.now();
    const result2 = await handler!({});
    const secondCallDuration = Date.now() - secondStartTime;

    expect(result1).toEqual({ success: true });
    expect(result2).toEqual({ success: true });
    expect(doStartServices).toHaveBeenCalledTimes(1);
    // Second call should be much faster (idempotent guard)
    expect(secondCallDuration).toBeLessThan(firstCallDuration);
  });

  it("returns error and allows retry on failure", async () => {
    const doStartServices = vi.fn().mockRejectedValue(new Error("Connection failed"));
    deps = createMockDeps({ doStartServices });
    new LifecycleModule(registry, deps);

    const handler = registry.getHandler("lifecycle.startServices");
    const result = await handler!({});

    expect(result).toEqual({
      success: false,
      message: "Connection failed",
      code: "SERVICE_START_ERROR",
    });

    // After failure, retry should work
    doStartServices.mockResolvedValue(undefined);
    const retryResult = await handler!({});

    expect(retryResult).toEqual({ success: true });
    expect(doStartServices).toHaveBeenCalledTimes(2);
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
    expect(registeredPaths).toContain("lifecycle.startServices");
    expect(registeredPaths).toContain("lifecycle.quit");

    // Verify register was called with IPC options
    expect(registry.register).toHaveBeenCalledWith("lifecycle.getState", expect.any(Function), {
      ipc: "api:lifecycle:get-state",
    });
    expect(registry.register).toHaveBeenCalledWith("lifecycle.setup", expect.any(Function), {
      ipc: "api:lifecycle:setup",
    });
    expect(registry.register).toHaveBeenCalledWith(
      "lifecycle.startServices",
      expect.any(Function),
      {
        ipc: "api:lifecycle:start-services",
      }
    );
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
