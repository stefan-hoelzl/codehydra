/**
 * LifecycleModule - Handles application lifecycle operations.
 *
 * Responsibilities:
 * - getState: Check if setup is needed
 * - setup: Run VS Code setup process
 * - quit: Quit the application
 *
 * Created in bootstrap() before UI loads, making lifecycle handlers
 * available immediately when the renderer starts.
 */

import type { IApiRegistry, IApiModule, EmptyPayload } from "../../api/registry-types";
import type { SetupResult, AppState, SetupStep as ApiSetupStep } from "../../../shared/api/types";
import type {
  IVscodeSetup,
  SetupStep as ServiceSetupStep,
  PreflightResult,
} from "../../../services/vscode-setup/types";
import type { Logger } from "../../../services/logging/index";
import { ApiIpcChannels } from "../../../shared/ipc";
import { createSilentLogger } from "../../../services/logging";

// =============================================================================
// Types
// =============================================================================

/**
 * Minimal app interface required by LifecycleModule.
 */
export interface MinimalApp {
  quit(): void;
}

/**
 * Dependencies for LifecycleModule.
 */
export interface LifecycleModuleDeps {
  /** VS Code setup service (undefined in dev mode without setup) */
  readonly vscodeSetup: IVscodeSetup | undefined;
  /** Electron app instance for quit() */
  readonly app: MinimalApp;
  /** Callback when setup completes successfully */
  readonly onSetupComplete: () => Promise<void>;
  /** Optional logger */
  readonly logger?: Logger;
}

// =============================================================================
// Module Implementation
// =============================================================================

/**
 * LifecycleModule handles application lifecycle operations.
 *
 * Registered methods:
 * - lifecycle.getState: Check if setup is needed
 * - lifecycle.setup: Run VS Code setup process
 * - lifecycle.quit: Quit the application
 *
 * Events emitted:
 * - setup:progress: Progress updates during setup
 */
export class LifecycleModule implements IApiModule {
  private setupInProgress = false;
  /** Cached preflight result from getState() for use in setup() */
  private cachedPreflightResult: PreflightResult | null = null;

  private readonly logger: Logger;

  /**
   * Create a new LifecycleModule.
   *
   * @param api The API registry to register methods on
   * @param deps Module dependencies
   */
  constructor(
    private readonly api: IApiRegistry,
    private readonly deps: LifecycleModuleDeps
  ) {
    this.logger = deps.logger ?? createSilentLogger();
    this.registerMethods();
  }

  /**
   * Register all lifecycle methods with the API registry.
   */
  private registerMethods(): void {
    this.api.register("lifecycle.getState", this.getState.bind(this), {
      ipc: ApiIpcChannels.LIFECYCLE_GET_STATE,
    });
    this.api.register("lifecycle.setup", this.setup.bind(this), {
      ipc: ApiIpcChannels.LIFECYCLE_SETUP,
    });
    this.api.register("lifecycle.quit", this.quit.bind(this), {
      ipc: ApiIpcChannels.LIFECYCLE_QUIT,
    });
  }

  // ===========================================================================
  // Lifecycle Methods
  // ===========================================================================

  /**
   * Get the current application state.
   *
   * Uses preflight checks to determine if setup is needed:
   * - Checks binary versions (code-server, opencode)
   * - Checks installed extension versions
   * - Checks setup marker validity
   *
   * The preflight result is cached for use by setup().
   */
  private async getState(payload: EmptyPayload): Promise<AppState> {
    void payload; // Required by MethodHandler interface but unused for no-arg methods
    // If no setup service, assume ready
    if (!this.deps.vscodeSetup) {
      return "ready";
    }

    const preflightResult = await this.deps.vscodeSetup.preflight();

    // Cache for later use in setup()
    this.cachedPreflightResult = preflightResult;

    // Log preflight results
    if (preflightResult.success) {
      if (preflightResult.needsSetup) {
        this.logger.info("Preflight: setup required", {
          missingBinaries: preflightResult.missingBinaries.join(",") || "none",
          missingExtensions: preflightResult.missingExtensions.join(",") || "none",
          outdatedExtensions: preflightResult.outdatedExtensions.join(",") || "none",
        });
      } else {
        this.logger.debug("Preflight: no setup required", {});
      }
      return preflightResult.needsSetup ? "setup" : "ready";
    } else {
      // Preflight failed - treat as needing setup
      this.logger.warn("Preflight failed", { error: preflightResult.error.message });
      return "setup";
    }
  }

  /**
   * Run the setup process.
   *
   * Behavior:
   * - Uses cached preflight result (from getState()) or runs preflight if not cached
   * - If no setup needed: calls onSetupComplete and returns success
   * - If setup is already in progress: returns SETUP_IN_PROGRESS error
   * - Otherwise: runs selective setup based on preflight results
   */
  private async setup(payload: EmptyPayload): Promise<SetupResult> {
    void payload; // Required by MethodHandler interface but unused for no-arg methods
    // If no setup service, just call onSetupComplete
    if (!this.deps.vscodeSetup) {
      try {
        await this.deps.onSetupComplete();
        return { success: true };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
          code: "SERVICE_START_ERROR",
        };
      }
    }

    // Guard: prevent concurrent setup processes
    if (this.setupInProgress) {
      return {
        success: false,
        message: "Setup already in progress",
        code: "SETUP_IN_PROGRESS",
      };
    }
    this.setupInProgress = true;

    try {
      // Use cached preflight result or run preflight if not available
      let preflightResult = this.cachedPreflightResult;
      if (!preflightResult) {
        preflightResult = await this.deps.vscodeSetup.preflight();
      }
      // Clear cache after use
      this.cachedPreflightResult = null;

      // Check if setup is actually needed
      if (preflightResult.success && !preflightResult.needsSetup) {
        // No setup needed - just start services
        try {
          await this.deps.onSetupComplete();
        } catch (error) {
          return {
            success: false,
            message: error instanceof Error ? error.message : String(error),
            code: "SERVICE_START_ERROR",
          };
        }
        return { success: true };
      }

      // Run setup with progress callbacks
      // Note: Pass preflight result directly - if preflight failed, setup will handle full install
      const result = await this.deps.vscodeSetup.setup(preflightResult, (serviceProgress) => {
        this.logger.debug("Setup progress", {
          step: serviceProgress.step,
          message: serviceProgress.message,
        });
        const apiStep = this.mapSetupStep(serviceProgress.step);
        if (apiStep) {
          this.api.emit("setup:progress", {
            step: apiStep,
            message: serviceProgress.message,
          });
        }
      });

      if (result.success) {
        this.logger.info("Setup complete", {});
        // Call onSetupComplete (starts services)
        try {
          await this.deps.onSetupComplete();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.warn("Service start failed", { error: errorMessage });
          return {
            success: false,
            message: errorMessage,
            code: "SERVICE_START_ERROR",
          };
        }
        return { success: true };
      } else {
        this.logger.warn("Setup failed", { error: result.error.message });
        return {
          success: false,
          message: result.error.message,
          code: result.error.code ?? result.error.type,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn("Setup failed", { error: errorMessage });
      return {
        success: false,
        message: errorMessage,
        code: "UNKNOWN",
      };
    } finally {
      this.setupInProgress = false;
    }
  }

  /**
   * Quit the application.
   */
  private async quit(payload: EmptyPayload): Promise<void> {
    void payload; // Required by MethodHandler interface but unused for no-arg methods
    this.deps.app.quit();
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Map service setup step to API setup step.
   * Returns undefined for steps that should be filtered out.
   */
  private mapSetupStep(serviceStep: ServiceSetupStep): ApiSetupStep | undefined {
    switch (serviceStep) {
      case "binary-download":
        return "binary-download";
      case "extensions":
        return "extensions";
      case "config":
        return "settings";
      case "finalize":
        // Finalize step is not exposed in the API
        return undefined;
      default:
        return undefined;
    }
  }

  // ===========================================================================
  // IApiModule Implementation
  // ===========================================================================

  /**
   * Dispose module resources.
   * LifecycleModule has no resources to dispose (IPC handlers cleaned up by ApiRegistry).
   */
  dispose(): void {
    // No resources to dispose
  }
}
