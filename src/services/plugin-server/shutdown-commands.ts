/**
 * Shutdown commands for VS Code workspace cleanup.
 *
 * These commands are sent to workspaces before they are destroyed
 * to ensure proper cleanup of running processes (e.g., terminals).
 */

import type { PluginServer } from "./plugin-server";
import type { Logger } from "../logging";

// ============================================================================
// Constants
// ============================================================================

/**
 * VS Code command to kill all terminal processes in a workspace.
 */
export const SHUTDOWN_COMMAND = "workbench.action.terminal.killAll" as const;

/**
 * Timeout for shutdown command (5 seconds).
 * If the command doesn't complete in time, we proceed with deletion anyway.
 */
export const SHUTDOWN_COMMAND_TIMEOUT_MS = 5000;

// ============================================================================
// sendShutdownCommand
// ============================================================================

/**
 * Send the shutdown command to terminate all terminal processes in a workspace.
 *
 * This is a best-effort operation:
 * - If the workspace is not connected, logs debug and returns (no error)
 * - If the command times out or fails, logs warning and returns (no error)
 * - Never throws - deletion should proceed regardless of shutdown command success
 *
 * @param server - PluginServer instance to send commands through
 * @param workspacePath - Normalized workspace path
 * @param logger - Logger for command execution logging
 */
export async function sendShutdownCommand(
  server: PluginServer,
  workspacePath: string,
  logger: Logger
): Promise<void> {
  // Check if workspace is connected
  if (!server.isConnected(workspacePath)) {
    logger.debug("Shutdown command skipped: workspace not connected", {
      workspace: workspacePath,
    });
    return;
  }

  logger.debug("Sending shutdown command", {
    workspace: workspacePath,
    command: SHUTDOWN_COMMAND,
  });

  const result = await server.sendCommand(
    workspacePath,
    SHUTDOWN_COMMAND,
    [],
    SHUTDOWN_COMMAND_TIMEOUT_MS
  );

  if (!result.success) {
    logger.warn("Shutdown command failed", {
      workspace: workspacePath,
      command: SHUTDOWN_COMMAND,
      error: result.error,
    });
  } else {
    logger.debug("Shutdown command executed", {
      workspace: workspacePath,
      command: SHUTDOWN_COMMAND,
    });
  }
}
