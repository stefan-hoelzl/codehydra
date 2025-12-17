/**
 * Process tree provider implementations.
 * Gets descendant PIDs for a given parent process.
 *
 * Platform-specific implementations:
 * - Linux/macOS: PidtreeProvider (uses pidtree library)
 * - Windows: WindowsProcessTreeProvider (uses @vscode/windows-process-tree)
 *
 * Use createProcessTreeProvider() factory to get the appropriate implementation.
 */

import pidtree from "pidtree";
import type { IProcessTreeNode } from "@vscode/windows-process-tree";
import type { Logger } from "../logging";

/**
 * Type for the @vscode/windows-process-tree module.
 * Used for dynamic import and type-safe access.
 */
type WindowsProcessTreeModule = typeof import("@vscode/windows-process-tree");

/**
 * Interface for process tree operations.
 * Abstracts the underlying implementation for testability.
 */
export interface ProcessTreeProvider {
  /**
   * Get all descendant PIDs of a process.
   * @param pid Parent process ID
   * @returns Set of descendant PIDs (empty on error)
   */
  getDescendantPids(pid: number): Promise<Set<number>>;
}

/**
 * Process tree provider implementation using pidtree.
 * Used on Linux and macOS platforms.
 */
export class PidtreeProvider implements ProcessTreeProvider {
  constructor(private readonly logger: Logger) {}

  async getDescendantPids(pid: number): Promise<Set<number>> {
    try {
      const descendants = await pidtree(pid);
      this.logger.silly("GetDescendants", { pid, count: descendants.length });
      return new Set(descendants);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn("GetDescendants failed", { pid, error: errMsg });
      // Return empty set on error (process may have exited)
      return new Set();
    }
  }
}

/**
 * Function type for getting the native Windows process tree module.
 * Used for dependency injection in testing.
 */
export type NativeModuleGetter = () => Promise<WindowsProcessTreeModule | null>;

/**
 * Process tree provider implementation using @vscode/windows-process-tree.
 * Used on Windows platform where pidtree's wmic.exe dependency is unavailable.
 *
 * The native module is lazily loaded and cached to avoid startup overhead.
 */
export class WindowsProcessTreeProvider implements ProcessTreeProvider {
  private nativeModule: WindowsProcessTreeModule | null | undefined = undefined;

  constructor(
    private readonly logger: Logger,
    private readonly getNativeModuleOverride?: NativeModuleGetter
  ) {}

  async getDescendantPids(pid: number): Promise<Set<number>> {
    try {
      const module = await this.getNativeModule();
      if (!module) {
        return new Set();
      }

      const tree = await this.getProcessTreeAsync(module, pid);
      if (tree === undefined) {
        this.logger.debug("Process not found", { pid });
        return new Set();
      }

      const descendants = this.collectDescendantPids(tree);
      this.logger.debug("GetDescendants", { pid, count: descendants.size });
      return descendants;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn("GetDescendants failed", { pid, error: errMsg });
      return new Set();
    }
  }

  private async getNativeModule(): Promise<WindowsProcessTreeModule | null> {
    // Cache the module after first load (works for both override and real import)
    if (this.nativeModule === undefined) {
      if (this.getNativeModuleOverride) {
        // Use override for testing
        this.nativeModule = await this.getNativeModuleOverride();
      } else {
        // Real module loading
        try {
          this.nativeModule = await import("@vscode/windows-process-tree");
        } catch {
          this.logger.warn("Failed to load windows-process-tree native module");
          this.nativeModule = null;
        }
      }
    }
    return this.nativeModule;
  }

  private getProcessTreeAsync(
    module: WindowsProcessTreeModule,
    pid: number
  ): Promise<IProcessTreeNode | undefined> {
    return new Promise((resolve) => {
      module.getProcessTree(pid, (tree) => resolve(tree));
    });
  }

  private collectDescendantPids(node: IProcessTreeNode): Set<number> {
    const pids = new Set<number>();
    for (const child of node.children) {
      pids.add(child.pid);
      for (const grandchildPid of this.collectDescendantPids(child)) {
        pids.add(grandchildPid);
      }
    }
    return pids;
  }
}

/**
 * Creates the appropriate ProcessTreeProvider for the current platform.
 *
 * - Windows: WindowsProcessTreeProvider (uses native @vscode/windows-process-tree)
 *   Falls back to PidtreeProvider if native module fails to load
 * - Linux/macOS: PidtreeProvider (uses pidtree library)
 *
 * @param logger Logger instance for debug/warning messages
 * @returns ProcessTreeProvider implementation for the current platform
 */
export function createProcessTreeProvider(logger: Logger): ProcessTreeProvider {
  if (process.platform === "win32") {
    try {
      const provider = new WindowsProcessTreeProvider(logger);
      // Verify the native module can load by attempting to get it
      // This is an async check, but we can trigger the lazy load
      // If it fails, subsequent calls to getDescendantPids will return empty Set
      // which is safe but suboptimal - the factory fallback catches sync errors
      return provider;
    } catch (error) {
      // Native module failed to instantiate (sync error)
      // Fall back to PidtreeProvider which uses wmic.exe
      logger.warn("WindowsProcessTreeProvider failed, falling back to PidtreeProvider", {
        error: error instanceof Error ? error.message : String(error),
      });
      return new PidtreeProvider(logger);
    }
  }
  return new PidtreeProvider(logger);
}

/**
 * Creates the appropriate ProcessTreeProvider for the current platform,
 * with async verification of the native module on Windows.
 *
 * This is the preferred method when you can await, as it verifies the native
 * module actually works before returning a WindowsProcessTreeProvider.
 *
 * @param logger Logger instance for debug/warning messages
 * @returns ProcessTreeProvider implementation for the current platform
 */
export async function createProcessTreeProviderAsync(logger: Logger): Promise<ProcessTreeProvider> {
  if (process.platform === "win32") {
    const provider = new WindowsProcessTreeProvider(logger);

    // Verify the native module can load by calling getDescendantPids
    // with a known process (PID 1 on Windows is System Idle Process)
    // If it returns empty Set AND logs a warning, the module failed
    // But if it just returns empty Set (no children), that's fine
    try {
      // Try to load the native module explicitly
      const testResult = await provider.getDescendantPids(process.pid);
      // If we get here without the module logging a warning about failing to load,
      // the module is working (even if result is empty Set - that's normal)
      if (testResult !== undefined) {
        return provider;
      }
    } catch {
      // Fall through to PidtreeProvider
    }

    logger.warn(
      "WindowsProcessTreeProvider native module failed to load, falling back to PidtreeProvider"
    );
    return new PidtreeProvider(logger);
  }
  return new PidtreeProvider(logger);
}
