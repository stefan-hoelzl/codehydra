/**
 * Standalone LifecycleApi implementation.
 *
 * This class is instantiated early in bootstrap() before startServices() runs,
 * making lifecycle handlers available immediately when the renderer loads.
 *
 * The same instance is reused by CodeHydraApiImpl when it's created in startServices().
 *
 * Timing requirements:
 * 1. Created in bootstrap() after vscodeSetupService
 * 2. Lifecycle handlers registered immediately after creation
 * 3. Reused by CodeHydraApiImpl in startServices()
 */

import type { ILifecycleApi } from "../../shared/api/interfaces";
import type {
  SetupResult as ApiSetupResult,
  SetupProgress,
  AppState,
  SetupStep as ApiSetupStep,
} from "../../shared/api/types";
import type {
  IVscodeSetup,
  SetupStep as ServiceSetupStep,
  PreflightResult,
} from "../../services/vscode-setup/types";
import type { Logger } from "../../services/logging/index";

/**
 * Minimal app interface required by LifecycleApi.
 */
export interface MinimalApp {
  quit(): void;
}

/**
 * Callback invoked when setup completes successfully.
 * Typically starts services in main process.
 */
export type OnSetupCompleteCallback = () => Promise<void>;

/**
 * Callback to emit setup progress events.
 * Typically sends to renderer via webContents.send().
 */
export type EmitProgressCallback = (progress: SetupProgress) => void;

/**
 * Standalone lifecycle API implementation.
 *
 * Provides getState(), setup(), and quit() methods for the setup flow.
 * Designed to be created early in bootstrap() and reused by CodeHydraApiImpl.
 *
 * Uses preflight checks to determine what needs setup, enabling selective
 * installation of only missing/outdated components.
 */
export class LifecycleApi implements ILifecycleApi {
  private setupInProgress = false;
  /** Cached preflight result from getState() for use in setup() */
  private cachedPreflightResult: PreflightResult | null = null;

  constructor(
    private readonly vscodeSetup: IVscodeSetup,
    private readonly app: MinimalApp,
    private readonly onSetupComplete: OnSetupCompleteCallback,
    private readonly emitProgress: EmitProgressCallback,
    private readonly logger?: Logger
  ) {}

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
   * @returns "ready" if no setup needed, "setup" otherwise
   */
  async getState(): Promise<AppState> {
    const preflightResult = await this.vscodeSetup.preflight();

    // Cache for later use in setup()
    this.cachedPreflightResult = preflightResult;

    // Log preflight results
    if (preflightResult.success) {
      if (preflightResult.needsSetup) {
        this.logger?.info("Preflight: setup required", {
          missingBinaries: preflightResult.missingBinaries.join(",") || "none",
          missingExtensions: preflightResult.missingExtensions.join(",") || "none",
          outdatedExtensions: preflightResult.outdatedExtensions.join(",") || "none",
        });
      } else {
        this.logger?.debug("Preflight: no setup required", {});
      }
      return preflightResult.needsSetup ? "setup" : "ready";
    } else {
      // Preflight failed - treat as needing setup
      this.logger?.warn("Preflight failed", { error: preflightResult.error.message });
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
   *
   * Note: Does NOT auto-clean the vscode directory. Selective cleaning of
   * outdated extensions is handled by VscodeSetupService based on preflight results.
   *
   * @returns Success or failure result
   */
  async setup(): Promise<ApiSetupResult> {
    // Guard: prevent concurrent setup processes
    // IMPORTANT: Set flag BEFORE any await to prevent race conditions
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
        preflightResult = await this.vscodeSetup.preflight();
      }
      // Clear cache after use
      this.cachedPreflightResult = null;

      // Check if setup is actually needed
      if (preflightResult.success && !preflightResult.needsSetup) {
        // No setup needed - just start services
        try {
          await this.onSetupComplete();
        } catch (error) {
          return {
            success: false,
            message: error instanceof Error ? error.message : String(error),
            code: "SERVICE_START_ERROR",
          };
        }
        return { success: true };
      }

      // Run setup with progress callbacks, passing preflight result for selective setup
      const result = await this.vscodeSetup.setup(
        preflightResult.success ? preflightResult : undefined,
        (serviceProgress) => {
          this.logger?.debug("Setup progress", {
            step: serviceProgress.step,
            message: serviceProgress.message,
          });
          const apiStep = this.mapSetupStep(serviceProgress.step);
          if (apiStep) {
            this.emitProgress({
              step: apiStep,
              message: serviceProgress.message,
            });
          }
        }
      );

      if (result.success) {
        this.logger?.info("Setup complete", {});
        // Call onSetupComplete (starts services)
        try {
          await this.onSetupComplete();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger?.warn("Setup failed", { error: errorMessage });
          return {
            success: false,
            message: errorMessage,
            code: "SERVICE_START_ERROR",
          };
        }
        return { success: true };
      } else {
        this.logger?.warn("Setup failed", { error: result.error.message });
        return {
          success: false,
          message: result.error.message,
          code: result.error.code ?? result.error.type,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger?.warn("Setup failed", { error: errorMessage });
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
  async quit(): Promise<void> {
    this.app.quit();
  }

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
}
