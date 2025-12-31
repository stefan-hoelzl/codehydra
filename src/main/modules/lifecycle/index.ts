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
import type { SetupResult, AppState } from "../../../shared/api/types";
import type { IVscodeSetup, PreflightResult } from "../../../services/vscode-setup/types";
import type { Logger } from "../../../services/logging/index";
import { ApiIpcChannels } from "../../../shared/ipc";
import { SILENT_LOGGER } from "../../../services/logging";
import { getErrorMessage } from "../../../shared/error-utils";

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
  /** Function to start application services (code-server, OpenCode, etc.) */
  readonly doStartServices: () => Promise<void>;
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
 */
export class LifecycleModule implements IApiModule {
  private setupInProgress = false;
  /** Cached preflight result from getState() for use in setup() */
  private cachedPreflightResult: PreflightResult | null = null;
  /** Flag to track if services have been started (idempotent guard) */
  private servicesStarted = false;

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
    this.logger = deps.logger ?? SILENT_LOGGER;
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
    this.api.register("lifecycle.startServices", this.startServices.bind(this), {
      ipc: ApiIpcChannels.LIFECYCLE_START_SERVICES,
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
   *
   * Returns:
   * - "setup" if setup is needed
   * - "loading" if setup is complete but services not yet started
   * - Never returns "ready" (that state is only reached after startServices())
   */
  private async getState(payload: EmptyPayload): Promise<AppState> {
    void payload; // Required by MethodHandler interface but unused for no-arg methods
    // If no setup service, return "loading" (skip setup, but still need to start services)
    if (!this.deps.vscodeSetup) {
      return "loading";
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
        return "setup";
      } else {
        this.logger.debug("Preflight: no setup required", {});
        return "loading";
      }
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
   * - If no setup needed: returns success immediately (no service start)
   * - If setup is already in progress: returns SETUP_IN_PROGRESS error
   * - Otherwise: runs selective setup based on preflight results
   *
   * Note: This method does NOT start services. The renderer must call
   * startServices() after setup() completes successfully.
   */
  private async setup(payload: EmptyPayload): Promise<SetupResult> {
    void payload; // Required by MethodHandler interface but unused for no-arg methods
    // If no setup service, just return success (no setup to do)
    if (!this.deps.vscodeSetup) {
      return { success: true };
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
        // No setup needed - return success (renderer will call startServices)
        return { success: true };
      }

      // Run setup with progress callbacks (logged only, no IPC emission)
      // Note: Pass preflight result directly - if preflight failed, setup will handle full install
      const result = await this.deps.vscodeSetup.setup(preflightResult, (serviceProgress) => {
        this.logger.debug("Setup progress", {
          step: serviceProgress.step,
          message: serviceProgress.message,
        });
      });

      if (result.success) {
        this.logger.info("Setup complete", {});
        // Return success - renderer will call startServices
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
      const errorMessage = getErrorMessage(error);
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
   * Start application services (code-server, OpenCode, etc.).
   *
   * Idempotent - second call returns success immediately without side effects.
   * Called by renderer after getState() returns "loading" or after setup() succeeds.
   */
  private async startServices(payload: EmptyPayload): Promise<SetupResult> {
    void payload; // Required by MethodHandler interface but unused for no-arg methods

    // Idempotent guard - second call returns success immediately
    if (this.servicesStarted) {
      return { success: true };
    }
    this.servicesStarted = true;

    try {
      await this.deps.doStartServices();
      this.logger.info("Services started", {});
      return { success: true };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.warn("Service start failed", { error: errorMessage });
      // Reset flag to allow retry
      this.servicesStarted = false;
      return {
        success: false,
        message: errorMessage,
        code: "SERVICE_START_ERROR",
      };
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
