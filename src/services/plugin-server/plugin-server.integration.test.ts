/**
 * Integration tests for PluginServer with startup commands.
 *
 * Tests the full flow: PluginServer start → onConnect registration → connection → sendStartupCommands called
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PluginServer } from "./plugin-server";
import { STARTUP_COMMANDS, sendStartupCommands } from "./startup-commands";
import { DefaultNetworkLayer } from "../platform/network";
import { createSilentLogger } from "../logging/logging.test-utils";
import {
  createTestClient,
  waitForConnect,
  createMockCommandHandler,
  type TestClientSocket,
} from "./plugin-server.test-utils";

// Longer timeout for integration tests
const TEST_TIMEOUT = 15000;

describe("PluginServer (integration)", { timeout: TEST_TIMEOUT }, () => {
  let server: PluginServer;
  let networkLayer: DefaultNetworkLayer;
  let port: number;
  let clients: TestClientSocket[] = [];

  beforeEach(async () => {
    networkLayer = new DefaultNetworkLayer(createSilentLogger());
    server = new PluginServer(networkLayer, createSilentLogger(), { transports: ["polling"] });
    port = await server.start();
  });

  afterEach(async () => {
    // Disconnect all clients
    for (const client of clients) {
      if (client.connected) {
        client.disconnect();
      }
    }
    clients = [];

    // Close server
    if (server) {
      await server.close();
    }
  });

  // Helper to create and track clients
  function createClient(workspacePath: string): TestClientSocket {
    const client = createTestClient(port, { workspacePath });
    clients.push(client);
    return client;
  }

  describe("startup commands on connection", () => {
    it("sends all 5 startup commands when client connects", async () => {
      const receivedCommands: string[] = [];
      const client = createClient("/test/workspace");

      // Set up command handler to track received commands
      const handler = createMockCommandHandler();
      client.on("command", (request, ack) => {
        receivedCommands.push(request.command);
        handler(request, ack);
      });

      // Register onConnect callback to send startup commands
      server.onConnect((workspacePath) => {
        void sendStartupCommands(server, workspacePath, createSilentLogger(), 0);
      });

      // Connect and wait for startup commands
      await waitForConnect(client);

      // Wait for all commands to be processed (give some time for async commands)
      await new Promise((resolve) => setTimeout(resolve, 500));

      // All 5 startup commands should be received
      expect(receivedCommands).toHaveLength(STARTUP_COMMANDS.length);
      expect(receivedCommands).toEqual([...STARTUP_COMMANDS]);
    });

    it("sends commands in correct order", async () => {
      const receivedCommands: string[] = [];
      const client = createClient("/test/workspace");

      // Set up command handler to track order
      client.on("command", (request, ack) => {
        receivedCommands.push(request.command);
        ack({ success: true, data: undefined });
      });

      // Register onConnect callback
      server.onConnect((workspacePath) => {
        void sendStartupCommands(server, workspacePath, createSilentLogger(), 0);
      });

      await waitForConnect(client);
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Commands should be in exact order
      expect(receivedCommands[0]).toBe("workbench.action.closeSidebar");
      expect(receivedCommands[1]).toBe("workbench.action.closeAuxiliaryBar");
      expect(receivedCommands[2]).toBe("opencode.openTerminal");
      expect(receivedCommands[3]).toBe("workbench.action.unlockEditorGroup");
      expect(receivedCommands[4]).toBe("workbench.action.closeEditorsInOtherGroups");
    });

    it("sends commands only after connection established", async () => {
      let commandsReceivedBeforeConnect = false;
      let connectEventFired = false;
      const receivedCommands: string[] = [];

      const client = createClient("/test/workspace");

      // Track when connect event fires
      client.on("connect", () => {
        connectEventFired = true;
      });

      // Track commands
      client.on("command", (request, ack) => {
        if (!connectEventFired) {
          commandsReceivedBeforeConnect = true;
        }
        receivedCommands.push(request.command);
        ack({ success: true, data: undefined });
      });

      // Register onConnect callback
      server.onConnect((workspacePath) => {
        void sendStartupCommands(server, workspacePath, createSilentLogger(), 0);
      });

      await waitForConnect(client);
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Commands should only come after connect
      expect(commandsReceivedBeforeConnect).toBe(false);
      expect(receivedCommands.length).toBeGreaterThan(0);
    });

    it("handles concurrent workspace connections independently", async () => {
      const workspace1Commands: string[] = [];
      const workspace2Commands: string[] = [];

      const client1 = createClient("/workspace/one");
      const client2 = createClient("/workspace/two");

      // Set up handlers for each workspace
      client1.on("command", (request, ack) => {
        workspace1Commands.push(request.command);
        ack({ success: true, data: undefined });
      });

      client2.on("command", (request, ack) => {
        workspace2Commands.push(request.command);
        ack({ success: true, data: undefined });
      });

      // Register onConnect callback
      server.onConnect((workspacePath) => {
        void sendStartupCommands(server, workspacePath, createSilentLogger(), 0);
      });

      // Connect both clients
      await Promise.all([waitForConnect(client1), waitForConnect(client2)]);
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Each workspace should receive its own set of startup commands
      expect(workspace1Commands).toHaveLength(STARTUP_COMMANDS.length);
      expect(workspace2Commands).toHaveLength(STARTUP_COMMANDS.length);

      // Commands should be the same for both workspaces
      expect(workspace1Commands).toEqual([...STARTUP_COMMANDS]);
      expect(workspace2Commands).toEqual([...STARTUP_COMMANDS]);
    });
  });
});
