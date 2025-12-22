/**
 * Unit tests for shutdown commands.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SHUTDOWN_COMMAND,
  SHUTDOWN_COMMAND_TIMEOUT_MS,
  sendShutdownCommand,
} from "./shutdown-commands";
import type { PluginServer } from "./plugin-server";
import type { PluginResult } from "../../shared/plugin-protocol";
import { createMockLogger } from "../logging/logging.test-utils";

// ============================================================================
// Mock Factory
// ============================================================================

interface MockPluginServerOptions {
  /**
   * Whether the workspace is connected.
   */
  readonly isConnected?: boolean;

  /**
   * Result to return for sendCommand.
   */
  readonly commandResult?: PluginResult<unknown>;
}

function createMockPluginServer(options?: MockPluginServerOptions): {
  server: PluginServer;
  sendCommand: ReturnType<typeof vi.fn>;
  isConnected: ReturnType<typeof vi.fn>;
} {
  const isConnectedValue = options?.isConnected ?? true;
  const commandResult = options?.commandResult ?? { success: true, data: undefined };

  const isConnected = vi.fn().mockReturnValue(isConnectedValue);
  const sendCommand = vi.fn().mockResolvedValue(commandResult);

  const server = {
    isConnected,
    sendCommand,
    // Minimal mock - only isConnected and sendCommand are needed
    start: vi.fn(),
    close: vi.fn(),
    getPort: vi.fn().mockReturnValue(3000),
    onConnect: vi.fn(),
  } as unknown as PluginServer;

  return { server, sendCommand, isConnected };
}

// ============================================================================
// Tests
// ============================================================================

describe("SHUTDOWN_COMMAND", () => {
  it("equals workbench.action.terminal.killAll", () => {
    expect(SHUTDOWN_COMMAND).toBe("workbench.action.terminal.killAll");
  });
});

describe("SHUTDOWN_COMMAND_TIMEOUT_MS", () => {
  it("equals 5000", () => {
    expect(SHUTDOWN_COMMAND_TIMEOUT_MS).toBe(5000);
  });
});

describe("sendShutdownCommand", () => {
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    logger = createMockLogger();
  });

  describe("workspace connected", () => {
    it("sends SHUTDOWN_COMMAND to correct workspace with timeout", async () => {
      const { server, sendCommand, isConnected } = createMockPluginServer();

      await sendShutdownCommand(server, "/test/workspace", logger);

      expect(isConnected).toHaveBeenCalledWith("/test/workspace");
      expect(sendCommand).toHaveBeenCalledWith(
        "/test/workspace",
        SHUTDOWN_COMMAND,
        [],
        SHUTDOWN_COMMAND_TIMEOUT_MS
      );
    });

    it("logs debug on success", async () => {
      const { server } = createMockPluginServer({
        commandResult: { success: true, data: undefined },
      });

      await sendShutdownCommand(server, "/test/workspace", logger);

      expect(logger.debug).toHaveBeenCalledWith("Shutdown command executed", {
        workspace: "/test/workspace",
        command: SHUTDOWN_COMMAND,
      });
    });

    it("logs warning on command failure", async () => {
      const { server } = createMockPluginServer({
        commandResult: { success: false, error: "Terminal not available" },
      });

      await sendShutdownCommand(server, "/test/workspace", logger);

      expect(logger.warn).toHaveBeenCalledWith("Shutdown command failed", {
        workspace: "/test/workspace",
        command: SHUTDOWN_COMMAND,
        error: "Terminal not available",
      });
    });

    it("logs warning on timeout", async () => {
      const { server } = createMockPluginServer({
        commandResult: { success: false, error: "Command timed out" },
      });

      await sendShutdownCommand(server, "/test/workspace", logger);

      expect(logger.warn).toHaveBeenCalledWith("Shutdown command failed", {
        workspace: "/test/workspace",
        command: SHUTDOWN_COMMAND,
        error: "Command timed out",
      });
    });

    it("does not throw on failure", async () => {
      const { server } = createMockPluginServer({
        commandResult: { success: false, error: "Any error" },
      });

      await expect(sendShutdownCommand(server, "/test/workspace", logger)).resolves.not.toThrow();
    });
  });

  describe("workspace not connected", () => {
    it("skips command when workspace not connected", async () => {
      const { server, sendCommand } = createMockPluginServer({
        isConnected: false,
      });

      await sendShutdownCommand(server, "/test/workspace", logger);

      expect(sendCommand).not.toHaveBeenCalled();
    });

    it("logs debug when workspace not connected", async () => {
      const { server } = createMockPluginServer({
        isConnected: false,
      });

      await sendShutdownCommand(server, "/test/workspace", logger);

      expect(logger.debug).toHaveBeenCalledWith(
        "Shutdown command skipped: workspace not connected",
        {
          workspace: "/test/workspace",
        }
      );
    });

    it("does not log warning when workspace not connected", async () => {
      const { server } = createMockPluginServer({
        isConnected: false,
      });

      await sendShutdownCommand(server, "/test/workspace", logger);

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("logging", () => {
    it("logs debug when sending command", async () => {
      const { server } = createMockPluginServer();

      await sendShutdownCommand(server, "/test/workspace", logger);

      expect(logger.debug).toHaveBeenCalledWith("Sending shutdown command", {
        workspace: "/test/workspace",
        command: SHUTDOWN_COMMAND,
      });
    });
  });
});
