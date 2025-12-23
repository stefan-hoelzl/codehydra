/**
 * Tests for LifecycleApi class.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LifecycleApi,
  type OnSetupCompleteCallback,
  type EmitProgressCallback,
} from "./lifecycle-api";
import type { IVscodeSetup, SetupResult, PreflightResult } from "../../services/vscode-setup/types";

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Create a successful preflight result indicating setup is needed.
 */
function createPreflightNeedsSetup(
  overrides: Partial<{
    missingBinaries: readonly string[];
    missingExtensions: readonly string[];
    outdatedExtensions: readonly string[];
  }> = {}
): PreflightResult {
  return {
    success: true,
    needsSetup: true,
    missingBinaries: overrides.missingBinaries ?? ["code-server"],
    missingExtensions: overrides.missingExtensions ?? [],
    outdatedExtensions: overrides.outdatedExtensions ?? [],
  } as PreflightResult;
}

/**
 * Create a successful preflight result indicating no setup needed.
 */
function createPreflightReady(): PreflightResult {
  return {
    success: true,
    needsSetup: false,
    missingBinaries: [],
    missingExtensions: [],
    outdatedExtensions: [],
  };
}

function createMockVscodeSetup(
  overrides: {
    preflightResult?: PreflightResult;
    setupResult?: SetupResult;
  } = {}
): IVscodeSetup {
  const { preflightResult = createPreflightReady(), setupResult = { success: true } } = overrides;

  return {
    isSetupComplete: vi
      .fn()
      .mockResolvedValue(!preflightResult.success || !preflightResult.needsSetup),
    preflight: vi.fn().mockResolvedValue(preflightResult),
    setup: vi.fn().mockResolvedValue(setupResult),
    cleanVscodeDir: vi.fn().mockResolvedValue(undefined),
    cleanComponents: vi.fn().mockResolvedValue(undefined),
  };
}

interface MockApp {
  quit: () => void;
}

function createMockApp(): MockApp {
  return {
    quit: vi.fn() as unknown as () => void,
  };
}

/** Typed mock for OnSetupCompleteCallback that can be used with expect assertions */
type MockedOnSetupComplete = OnSetupCompleteCallback & ReturnType<typeof vi.fn>;

/** Typed mock for EmitProgressCallback that can be used with expect assertions */
type MockedEmitProgress = EmitProgressCallback & ReturnType<typeof vi.fn>;

/**
 * Create a mock for OnSetupCompleteCallback.
 */
function createOnSetupCompleteMock(): MockedOnSetupComplete {
  return vi.fn().mockResolvedValue(undefined) as MockedOnSetupComplete;
}

/**
 * Create a mock for EmitProgressCallback.
 */
function createEmitProgressMock(): MockedEmitProgress {
  return vi.fn() as MockedEmitProgress;
}

// =============================================================================
// Tests
// =============================================================================

describe("LifecycleApi", () => {
  let mockSetup: IVscodeSetup;
  let mockApp: MockApp;
  let onSetupComplete: MockedOnSetupComplete;
  let emitProgress: MockedEmitProgress;

  beforeEach(() => {
    mockSetup = createMockVscodeSetup();
    mockApp = createMockApp();
    onSetupComplete = createOnSetupCompleteMock();
    emitProgress = createEmitProgressMock();
  });

  describe("getState()", () => {
    it("returns 'ready' when preflight indicates no setup needed", async () => {
      mockSetup = createMockVscodeSetup({ preflightResult: createPreflightReady() });
      const api = new LifecycleApi(mockSetup, mockApp, onSetupComplete, emitProgress);

      const state = await api.getState();

      expect(state).toBe("ready");
      expect(mockSetup.preflight).toHaveBeenCalled();
    });

    it("returns 'setup' when preflight indicates setup needed", async () => {
      mockSetup = createMockVscodeSetup({ preflightResult: createPreflightNeedsSetup() });
      const api = new LifecycleApi(mockSetup, mockApp, onSetupComplete, emitProgress);

      const state = await api.getState();

      expect(state).toBe("setup");
    });

    it("returns 'setup' when preflight fails", async () => {
      const failedPreflight: PreflightResult = {
        success: false,
        error: { type: "filesystem-unreadable", message: "Cannot read extensions directory" },
      };
      mockSetup = createMockVscodeSetup({ preflightResult: failedPreflight });
      const api = new LifecycleApi(mockSetup, mockApp, onSetupComplete, emitProgress);

      const state = await api.getState();

      expect(state).toBe("setup");
    });

    it("caches preflight result for use by setup()", async () => {
      mockSetup = createMockVscodeSetup({ preflightResult: createPreflightNeedsSetup() });
      const api = new LifecycleApi(mockSetup, mockApp, onSetupComplete, emitProgress);

      // Call getState to cache preflight result
      await api.getState();

      // Call setup - should use cached result
      await api.setup();

      // preflight should only be called once (in getState)
      expect(mockSetup.preflight).toHaveBeenCalledTimes(1);
    });
  });

  describe("setup()", () => {
    it("does NOT call cleanVscodeDir before running setup (selective clean only)", async () => {
      mockSetup = createMockVscodeSetup({ preflightResult: createPreflightNeedsSetup() });
      const api = new LifecycleApi(mockSetup, mockApp, onSetupComplete, emitProgress);

      await api.setup();

      // cleanVscodeDir should NOT be called - selective cleaning happens in VscodeSetupService
      expect(mockSetup.cleanVscodeDir).not.toHaveBeenCalled();
      expect(mockSetup.setup).toHaveBeenCalled();
    });

    it("passes preflight result to setup() for selective installation", async () => {
      const preflightResult = createPreflightNeedsSetup({
        missingBinaries: ["opencode"],
        outdatedExtensions: ["codehydra.codehydra"],
      });
      mockSetup = createMockVscodeSetup({ preflightResult });
      const api = new LifecycleApi(mockSetup, mockApp, onSetupComplete, emitProgress);

      await api.setup();

      // setup should be called with the preflight result
      expect(mockSetup.setup).toHaveBeenCalledWith(preflightResult, expect.any(Function));
    });

    it("emits progress events during setup", async () => {
      const mockSetupService = createMockVscodeSetup({
        preflightResult: createPreflightNeedsSetup(),
      });
      // Capture the progress callback and invoke it
      (mockSetupService.setup as ReturnType<typeof vi.fn>).mockImplementation(
        async (
          _preflight: unknown,
          onProgress: (progress: { step: string; message: string }) => void
        ) => {
          onProgress({ step: "binary-download", message: "Setting up code-server..." });
          onProgress({ step: "extensions", message: "Installing extensions..." });
          onProgress({ step: "config", message: "Configuring settings..." });
          return { success: true };
        }
      );

      const api = new LifecycleApi(mockSetupService, mockApp, onSetupComplete, emitProgress);
      await api.setup();

      expect(emitProgress).toHaveBeenCalledTimes(3);
      expect(emitProgress).toHaveBeenCalledWith({
        step: "binary-download",
        message: "Setting up code-server...",
      });
      expect(emitProgress).toHaveBeenCalledWith({
        step: "extensions",
        message: "Installing extensions...",
      });
      expect(emitProgress).toHaveBeenCalledWith({
        step: "settings",
        message: "Configuring settings...",
      });
    });

    it("calls onSetupComplete callback on success", async () => {
      mockSetup = createMockVscodeSetup({ preflightResult: createPreflightNeedsSetup() });
      const api = new LifecycleApi(mockSetup, mockApp, onSetupComplete, emitProgress);

      const result = await api.setup();

      expect(result).toEqual({ success: true });
      expect(onSetupComplete).toHaveBeenCalledTimes(1);
    });

    it("returns failure result on error", async () => {
      mockSetup = createMockVscodeSetup({
        preflightResult: createPreflightNeedsSetup(),
        setupResult: { success: false, error: { type: "network", message: "Failed to install" } },
      });
      const api = new LifecycleApi(mockSetup, mockApp, onSetupComplete, emitProgress);

      const result = await api.setup();

      expect(result).toEqual({
        success: false,
        message: "Failed to install",
        code: "network",
      });
      // onSetupComplete should NOT be called on failure
      expect(onSetupComplete).not.toHaveBeenCalled();
    });

    it("guards against concurrent setup calls", async () => {
      mockSetup = createMockVscodeSetup({ preflightResult: createPreflightNeedsSetup() });
      // Make setup take time
      let resolveSetup: () => void;
      (mockSetup.setup as ReturnType<typeof vi.fn>).mockReturnValue(
        new Promise<SetupResult>((resolve) => {
          resolveSetup = () => resolve({ success: true });
        })
      );

      const api = new LifecycleApi(mockSetup, mockApp, onSetupComplete, emitProgress);

      // Start first setup
      const promise1 = api.setup();

      // Try to start second setup immediately
      const promise2 = api.setup();

      // Second call should return immediately with SETUP_IN_PROGRESS
      const result2 = await promise2;
      expect(result2).toEqual({
        success: false,
        message: "Setup already in progress",
        code: "SETUP_IN_PROGRESS",
      });

      // Complete first setup
      resolveSetup!();
      const result1 = await promise1;
      expect(result1).toEqual({ success: true });
    });

    it("returns success immediately if no setup needed (preflight.needsSetup is false)", async () => {
      mockSetup = createMockVscodeSetup({ preflightResult: createPreflightReady() });
      const api = new LifecycleApi(mockSetup, mockApp, onSetupComplete, emitProgress);

      const result = await api.setup();

      expect(result).toEqual({ success: true });
      // Should not run cleanVscodeDir or setup
      expect(mockSetup.cleanVscodeDir).not.toHaveBeenCalled();
      expect(mockSetup.setup).not.toHaveBeenCalled();
      // Should still call onSetupComplete (services need to be started)
      expect(onSetupComplete).toHaveBeenCalledTimes(1);
    });

    it("handles error in onSetupComplete callback", async () => {
      mockSetup = createMockVscodeSetup({ preflightResult: createPreflightNeedsSetup() });
      onSetupComplete = vi.fn().mockRejectedValue(new Error("Services failed to start"));

      const api = new LifecycleApi(mockSetup, mockApp, onSetupComplete, emitProgress);
      const result = await api.setup();

      // Should propagate the error as a failure result
      expect(result).toEqual({
        success: false,
        message: "Services failed to start",
        code: "SERVICE_START_ERROR",
      });
    });

    it("resets setupInProgress flag on error", async () => {
      mockSetup = createMockVscodeSetup({ preflightResult: createPreflightNeedsSetup() });
      (mockSetup.setup as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Setup failed"));

      const api = new LifecycleApi(mockSetup, mockApp, onSetupComplete, emitProgress);

      // First call fails
      await api.setup();

      // Second call should work (flag reset)
      (mockSetup.setup as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
      const result = await api.setup();

      expect(result).toEqual({ success: true });
    });

    it("filters out finalize step from progress events", async () => {
      const mockSetupService = createMockVscodeSetup({
        preflightResult: createPreflightNeedsSetup(),
      });
      (mockSetupService.setup as ReturnType<typeof vi.fn>).mockImplementation(
        async (
          _preflight: unknown,
          onProgress: (progress: { step: string; message: string }) => void
        ) => {
          onProgress({ step: "extensions", message: "Installing..." });
          onProgress({ step: "finalize", message: "Finalizing..." });
          return { success: true };
        }
      );

      const api = new LifecycleApi(mockSetupService, mockApp, onSetupComplete, emitProgress);
      await api.setup();

      // Should only emit extensions, not finalize
      expect(emitProgress).toHaveBeenCalledTimes(1);
      expect(emitProgress).toHaveBeenCalledWith({
        step: "extensions",
        message: "Installing...",
      });
    });

    it("runs preflight if not cached (setup called without prior getState)", async () => {
      mockSetup = createMockVscodeSetup({ preflightResult: createPreflightNeedsSetup() });
      const api = new LifecycleApi(mockSetup, mockApp, onSetupComplete, emitProgress);

      // Call setup directly without getState
      await api.setup();

      // preflight should be called
      expect(mockSetup.preflight).toHaveBeenCalled();
      expect(mockSetup.setup).toHaveBeenCalled();
    });

    it("clears cached preflight result after use", async () => {
      mockSetup = createMockVscodeSetup({ preflightResult: createPreflightNeedsSetup() });
      const api = new LifecycleApi(mockSetup, mockApp, onSetupComplete, emitProgress);

      // Call getState to cache preflight result
      await api.getState();

      // Call setup - uses cached result
      await api.setup();

      // Call setup again - should run preflight again since cache was cleared
      await api.setup();

      // preflight should be called twice (once in getState, once in second setup)
      expect(mockSetup.preflight).toHaveBeenCalledTimes(2);
    });
  });

  describe("quit()", () => {
    it("calls app.quit()", async () => {
      const api = new LifecycleApi(mockSetup, mockApp, onSetupComplete, emitProgress);

      await api.quit();

      expect(mockApp.quit).toHaveBeenCalledTimes(1);
    });
  });
});
