/**
 * Boundary tests for network layer - tests against real HTTP/SSE servers and network operations.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "net";
import {
  DefaultNetworkLayer,
  type HttpClient,
  type PortManager,
  type SseClient,
  type SseConnection,
} from "./network";
import {
  createTestServer,
  MessageCollector,
  waitForConnectionState,
  waitForReconnection,
  type TestServer,
} from "./network.test-utils";

// ============================================================================
// Constants
// ============================================================================

const TEST_TIMEOUT_MS = process.env.CI ? 30000 : 10000;
const SSE_RECONNECT_TOLERANCE_MS = 200; // ±20% of 1000ms

// ============================================================================
// Test Server Helper Tests (validates our test infrastructure)
// ============================================================================

describe("TestServer helper", () => {
  let server: TestServer;

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
  });

  it("start() resolves without error", async () => {
    server = createTestServer();
    await expect(server.start()).resolves.not.toThrow();
  });

  it("getPort() returns port > 0 after start", async () => {
    server = createTestServer();
    await server.start();

    const port = server.getPort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65535);
  });

  it("getPort() throws if called before start", () => {
    server = createTestServer();

    expect(() => server.getPort()).toThrow("Server not started");
  });

  it(
    "server responds to GET /json with 200 status",
    async () => {
      server = createTestServer();
      await server.start();

      const response = await fetch(server.url("/json"));
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toEqual({ status: "ok" });
    },
    TEST_TIMEOUT_MS
  );

  it(
    "stop() resolves within 1000ms",
    async () => {
      server = createTestServer();
      await server.start();

      const start = Date.now();
      await server.stop();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(1000);
    },
    TEST_TIMEOUT_MS
  );

  it("stop() resolves even if server already stopped", async () => {
    server = createTestServer();
    await server.start();
    await server.stop();

    // Second stop should not throw
    await expect(server.stop()).resolves.not.toThrow();
  });

  describe("SSE endpoint", () => {
    it(
      "returns Content-Type: text/event-stream header",
      async () => {
        server = createTestServer();
        await server.start();

        const response = await fetch(server.url("/events"));
        expect(response.headers.get("Content-Type")).toBe("text/event-stream");

        // Read the stream to allow cleanup
        const reader = response.body?.getReader();
        reader?.cancel();
      },
      TEST_TIMEOUT_MS
    );

    it(
      "returns Cache-Control: no-cache header",
      async () => {
        server = createTestServer();
        await server.start();

        const response = await fetch(server.url("/events"));
        expect(response.headers.get("Cache-Control")).toBe("no-cache");

        // Read the stream to allow cleanup
        const reader = response.body?.getReader();
        reader?.cancel();
      },
      TEST_TIMEOUT_MS
    );

    it(
      "sends messages with data: prefix",
      async () => {
        server = createTestServer();
        await server.start();

        // Start listening
        const response = await fetch(server.url("/events"));
        const reader = response.body?.getReader();
        expect(reader).toBeDefined();

        // First read gets the initial ": connected" comment
        await reader!.read();

        // Send a message from server
        server.sendSseMessage("test-message");

        // Read the actual message
        const { value } = await reader!.read();
        const text = new TextDecoder().decode(value);

        expect(text).toContain("data: test-message");
        expect(text).toContain("\n\n");

        reader?.cancel();
      },
      TEST_TIMEOUT_MS
    );

    it("sendSseMessage handles closed connections gracefully", async () => {
      server = createTestServer();
      await server.start();

      // Connect and immediately disconnect
      const response = await fetch(server.url("/events"));
      const reader = response.body?.getReader();
      await reader?.cancel();

      // Give time for connection to close
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should not throw when sending to closed connection
      expect(() => server.sendSseMessage("test")).not.toThrow();
    });
  });
});

// ============================================================================
// PortManager Boundary Tests
// ============================================================================
//
// NOTE: These tests cover the PortManager interface functionality that was
// originally tested through a standalone `findAvailablePort()` function in
// `process.test.ts`. That file was deleted when the function was moved into
// the `DefaultNetworkLayer` class as `PortManager.findFreePort()`. The same
// test coverage (valid port range, bindability, concurrent calls) is provided
// here through the unified NetworkLayer interface.
// ============================================================================

describe("DefaultNetworkLayer boundary tests", () => {
  describe("PortManager.findFreePort()", () => {
    let networkLayer: PortManager;

    beforeEach(() => {
      networkLayer = new DefaultNetworkLayer();
    });

    it("findFreePort returns valid port number (1024-65535)", async () => {
      const port = await networkLayer.findFreePort();

      expect(port).toBeGreaterThanOrEqual(1024);
      expect(port).toBeLessThanOrEqual(65535);
    });

    it("findFreePort returns port that can be bound immediately", async () => {
      const port = await networkLayer.findFreePort();

      // Try to bind to the returned port
      const server = createServer();

      await new Promise<void>((resolve, reject) => {
        server.on("error", reject);
        server.listen(port, () => {
          server.close(() => resolve());
        });
      });
    });

    it("findFreePort handles concurrent calls", async () => {
      const ports = await Promise.all([
        networkLayer.findFreePort(),
        networkLayer.findFreePort(),
        networkLayer.findFreePort(),
      ]);

      // All ports should be valid
      for (const port of ports) {
        expect(port).toBeGreaterThanOrEqual(1024);
        expect(port).toBeLessThanOrEqual(65535);
      }

      // All ports should be unique
      const uniquePorts = new Set(ports);
      expect(uniquePorts.size).toBe(3);
    });

    it("handles 100 concurrent calls with all unique ports", async () => {
      const COUNT = 100;
      const ports = await Promise.all(
        Array.from({ length: COUNT }, () => networkLayer.findFreePort())
      );

      // All ports should be valid
      for (const port of ports) {
        expect(port).toBeGreaterThanOrEqual(1024);
        expect(port).toBeLessThanOrEqual(65535);
      }

      // All ports should be unique
      const uniquePorts = new Set(ports);
      expect(uniquePorts.size).toBe(COUNT);

      // All ports should be bindable (verify first 5 to avoid test slowness)
      const serversToTest = ports.slice(0, 5);
      for (const port of serversToTest) {
        const server = createServer();
        await new Promise<void>((resolve, reject) => {
          server.on("error", reject);
          server.listen(port, () => {
            server.close(() => resolve());
          });
        });
      }
    }, 30000); // 30s timeout for stress test
  });

  describe("PortManager.getListeningPorts()", () => {
    let networkLayer: PortManager;
    let testServer: Server | null = null;

    beforeEach(() => {
      networkLayer = new DefaultNetworkLayer();
    });

    afterEach(async () => {
      if (testServer) {
        await new Promise<void>((resolve, reject) => {
          testServer!.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        }).catch(() => {
          // Server already closed
        });
        testServer = null;
      }
    });

    it("getListeningPorts returns array of ListeningPort", async () => {
      // Create a server to ensure at least one listening port
      testServer = createServer();
      await new Promise<void>((resolve) => testServer!.listen(0, () => resolve()));

      const ports = await networkLayer.getListeningPorts();

      expect(Array.isArray(ports)).toBe(true);

      // There should be at least one port (our test server)
      expect(ports.length).toBeGreaterThan(0);

      // Verify structure
      for (const portInfo of ports) {
        expect(typeof portInfo.port).toBe("number");
        expect(typeof portInfo.pid).toBe("number");
        expect(portInfo.pid).toBeGreaterThan(0);
      }
    });

    it("getListeningPorts includes our test server port", async () => {
      // Create a server on a specific port
      testServer = createServer();
      await new Promise<void>((resolve) => testServer!.listen(0, () => resolve()));

      const serverAddress = testServer.address();
      const serverPort =
        typeof serverAddress === "object" && serverAddress ? serverAddress.port : 0;

      const ports = await networkLayer.getListeningPorts();
      const foundPort = ports.find((p) => p.port === serverPort);

      expect(foundPort).toBeDefined();
      expect(foundPort?.pid).toBe(process.pid);
    });

    it("getListeningPorts detects multiple servers", async () => {
      const servers: Server[] = [];
      const serverPorts: number[] = [];

      // Create 3 servers
      for (let i = 0; i < 3; i++) {
        const server = createServer();
        await new Promise<void>((resolve) => server.listen(0, () => resolve()));

        const addr = server.address();
        if (addr && typeof addr === "object") {
          serverPorts.push(addr.port);
        }
        servers.push(server);
      }

      try {
        const ports = await networkLayer.getListeningPorts();

        // All our server ports should be detected
        for (const serverPort of serverPorts) {
          const found = ports.find((p) => p.port === serverPort);
          expect(found).toBeDefined();
          expect(found?.pid).toBe(process.pid);
        }
      } finally {
        // Cleanup all servers
        await Promise.all(
          servers.map(
            (s) =>
              new Promise<void>((resolve) => {
                s.close(() => resolve());
              })
          )
        );
      }
    });
  });

  // ============================================================================
  // HttpClient Boundary Tests
  // ============================================================================

  describe("HttpClient", () => {
    let httpServer: TestServer;
    let httpClient: HttpClient;

    beforeAll(async () => {
      httpServer = createTestServer();
      await httpServer.start();
    });

    afterAll(async () => {
      await httpServer.stop();
    });

    beforeEach(() => {
      httpClient = new DefaultNetworkLayer();
    });

    describe("successful requests", () => {
      it(
        "fetches JSON from real endpoint",
        async () => {
          const response = await httpClient.fetch(httpServer.url("/json"));

          expect(response.ok).toBe(true);
          expect(response.status).toBe(200);

          const data = await response.json();
          expect(data).toEqual({ status: "ok" });
        },
        TEST_TIMEOUT_MS
      );

      it(
        "returns non-2xx status without throwing",
        async () => {
          const response = await httpClient.fetch(httpServer.url("/error/404"));

          // Should NOT throw - returns the response
          expect(response.ok).toBe(false);
          expect(response.status).toBe(404);

          const data = await response.json();
          expect(data).toEqual({ error: "Not Found" });
        },
        TEST_TIMEOUT_MS
      );

      it(
        "returns 500 error status without throwing",
        async () => {
          const response = await httpClient.fetch(httpServer.url("/error/500"));

          expect(response.ok).toBe(false);
          expect(response.status).toBe(500);

          const data = await response.json();
          expect(data).toEqual({ error: "Internal Server Error" });
        },
        TEST_TIMEOUT_MS
      );

      it(
        "uses default 5000ms timeout when not specified",
        async () => {
          // The /slow endpoint has SLOW_ENDPOINT_DELAY_MS = 2000ms
          // Default timeout is 5000ms, so this should succeed
          const response = await httpClient.fetch(httpServer.url("/slow"));

          expect(response.ok).toBe(true);
          expect(response.status).toBe(200);
        },
        TEST_TIMEOUT_MS
      );
    });

    describe("timeout behavior", () => {
      it(
        "times out on slow endpoint when timeout < delay",
        async () => {
          // /timeout never responds, so any timeout should trigger
          await expect(
            httpClient.fetch(httpServer.url("/timeout"), { timeout: 100 })
          ).rejects.toThrow();
        },
        TEST_TIMEOUT_MS
      );

      it(
        "respects custom timeout value",
        async () => {
          // Use a 200ms timeout with /timeout endpoint (never responds)
          const start = Date.now();

          await expect(
            httpClient.fetch(httpServer.url("/timeout"), { timeout: 200 })
          ).rejects.toThrow();

          const elapsed = Date.now() - start;
          // Should timeout at roughly 200ms (allow some tolerance)
          expect(elapsed).toBeGreaterThanOrEqual(180);
          expect(elapsed).toBeLessThan(500); // Should not wait too long
        },
        TEST_TIMEOUT_MS
      );

      it(
        "throws AbortError on timeout",
        async () => {
          try {
            await httpClient.fetch(httpServer.url("/timeout"), { timeout: 100 });
            // Should not reach here
            expect.fail("Expected fetch to throw");
          } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).name).toBe("AbortError");
          }
        },
        TEST_TIMEOUT_MS
      );

      it(
        "timeout triggers AFTER the timeout duration",
        async () => {
          const timeout = 300;
          const start = Date.now();

          try {
            await httpClient.fetch(httpServer.url("/timeout"), { timeout });
            expect.fail("Expected fetch to throw");
          } catch {
            const elapsed = Date.now() - start;
            // Should NOT timeout before the specified duration
            expect(elapsed).toBeGreaterThanOrEqual(timeout - 20); // Small tolerance for timing
          }
        },
        TEST_TIMEOUT_MS
      );

      it(
        "handles multiple concurrent requests with different timeouts",
        async () => {
          // Request 1: Fast (100ms timeout) - should timeout first
          // Request 2: Slow (500ms timeout) - should timeout second
          const fast = httpClient.fetch(httpServer.url("/timeout"), { timeout: 100 });
          const slow = httpClient.fetch(httpServer.url("/timeout"), { timeout: 500 });

          const fastStart = Date.now();

          // Fast should timeout around 100ms
          await expect(fast).rejects.toThrow();
          const fastElapsed = Date.now() - fastStart;
          expect(fastElapsed).toBeGreaterThanOrEqual(80);
          expect(fastElapsed).toBeLessThan(300);

          // Slow should still be pending (not resolved yet)
          // Wait for it to timeout
          await expect(slow).rejects.toThrow();
          const totalElapsed = Date.now() - fastStart;
          // Total should be at least 500ms (slow timeout)
          expect(totalElapsed).toBeGreaterThanOrEqual(480);
        },
        TEST_TIMEOUT_MS
      );
    });

    describe("error handling", () => {
      // Platform detection following process.boundary.test.ts pattern
      const isWindows = process.platform === "win32";

      it.skipIf(isWindows)(
        "handles connection refused when no server",
        async () => {
          // Port 59999 should not have a server running
          // (If flaky, could find an unused port first)
          const unusedPort = 59999;

          try {
            await httpClient.fetch(`http://localhost:${unusedPort}/test`, { timeout: 1000 });
            expect.fail("Expected fetch to throw");
          } catch (error) {
            // On Node.js, connection refused errors are wrapped in TypeError with "fetch failed"
            // The actual ECONNREFUSED is in error.cause
            expect(error).toBeInstanceOf(Error);
            const err = error as Error & { cause?: Error & { code?: string } };

            // Either the message contains "fetch failed" (Node.js native fetch)
            // or it contains ECONNREFUSED directly
            const message = err.message.toLowerCase();
            const causeCode = err.cause?.code?.toLowerCase();

            expect(
              message.includes("fetch failed") ||
                message.includes("econnrefused") ||
                causeCode === "econnrefused"
            ).toBe(true);
          }
        },
        TEST_TIMEOUT_MS
      );

      it(
        "handles abort signal cancellation",
        async () => {
          const controller = new AbortController();

          // Start a slow request
          const fetchPromise = httpClient.fetch(httpServer.url("/slow"), {
            signal: controller.signal,
          });

          // Abort after a short delay
          setTimeout(() => controller.abort(), 50);

          try {
            await fetchPromise;
            expect.fail("Expected fetch to throw on abort");
          } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).name).toBe("AbortError");
          }
        },
        TEST_TIMEOUT_MS
      );

      it(
        "abort signal takes precedence over timeout",
        async () => {
          const controller = new AbortController();
          const start = Date.now();

          // Request with 1000ms timeout, but abort after 100ms
          const fetchPromise = httpClient.fetch(httpServer.url("/timeout"), {
            timeout: 1000,
            signal: controller.signal,
          });

          setTimeout(() => controller.abort(), 100);

          try {
            await fetchPromise;
            expect.fail("Expected fetch to throw");
          } catch (error) {
            const elapsed = Date.now() - start;
            // Should abort around 100ms, not wait for 1000ms timeout
            expect(elapsed).toBeLessThan(500);
            expect((error as Error).name).toBe("AbortError");
          }
        },
        TEST_TIMEOUT_MS
      );

      it(
        "already-aborted signal throws immediately",
        async () => {
          const controller = new AbortController();
          controller.abort(); // Pre-abort

          try {
            await httpClient.fetch(httpServer.url("/json"), {
              signal: controller.signal,
            });
            expect.fail("Expected fetch to throw");
          } catch (error) {
            expect((error as Error).name).toBe("AbortError");
          }
        },
        TEST_TIMEOUT_MS
      );
    });
  });

  // ============================================================================
  // SseClient Boundary Tests
  // ============================================================================

  describe("SseClient", () => {
    let sseServer: TestServer;
    let sseClient: SseClient;
    const activeConnections: SseConnection[] = [];

    beforeAll(async () => {
      sseServer = createTestServer();
      await sseServer.start();
    });

    afterAll(async () => {
      await sseServer.stop();
    });

    beforeEach(() => {
      sseClient = new DefaultNetworkLayer();
    });

    afterEach(() => {
      // Clean up any SSE connections created during test
      for (const conn of activeConnections) {
        conn.disconnect();
      }
      activeConnections.length = 0;
      // Clean up server-side SSE connections
      sseServer.closeSseConnections();
    });

    describe("connection lifecycle", () => {
      it(
        "connects and fires onStateChange(true)",
        async () => {
          const conn = sseClient.createSseConnection(sseServer.url("/events"));
          activeConnections.push(conn);

          await waitForConnectionState(conn, true);
          // If we reach here, onStateChange(true) was fired
        },
        TEST_TIMEOUT_MS
      );

      it(
        "disconnect() closes cleanly without errors",
        async () => {
          const conn = sseClient.createSseConnection(sseServer.url("/events"));
          activeConnections.push(conn);

          await waitForConnectionState(conn, true);

          // disconnect() should not throw
          expect(() => conn.disconnect()).not.toThrow();

          // Give it a moment to ensure cleanup happens
          await new Promise((resolve) => setTimeout(resolve, 50));

          // Connection should be closed - attempting to reconnect would be prevented
          // This is verified by the fact that no error was thrown
        },
        TEST_TIMEOUT_MS
      );

      it(
        "disconnect() is safe to call multiple times",
        async () => {
          const conn = sseClient.createSseConnection(sseServer.url("/events"));
          activeConnections.push(conn);

          await waitForConnectionState(conn, true);

          // Multiple disconnects should not throw
          conn.disconnect();
          conn.disconnect();
          conn.disconnect();
        },
        TEST_TIMEOUT_MS
      );
    });

    describe("message delivery", () => {
      it(
        "receives messages via onMessage",
        async () => {
          const collector = new MessageCollector();
          const conn = sseClient.createSseConnection(sseServer.url("/events"));
          activeConnections.push(conn);

          conn.onMessage(collector.handler);
          await waitForConnectionState(conn, true);

          // Send a message from server
          sseServer.sendSseMessage('{"type":"test","data":"hello"}');

          // Wait for message to be received
          const messages = await collector.waitForCount(1);
          expect(messages[0]).toBe('{"type":"test","data":"hello"}');
        },
        TEST_TIMEOUT_MS
      );

      it(
        "receives multiple messages in order",
        async () => {
          const collector = new MessageCollector();
          const conn = sseClient.createSseConnection(sseServer.url("/events"));
          activeConnections.push(conn);

          conn.onMessage(collector.handler);
          await waitForConnectionState(conn, true);

          // Send multiple messages
          sseServer.sendSseMessage("message-1");
          sseServer.sendSseMessage("message-2");
          sseServer.sendSseMessage("message-3");

          // Wait for all messages
          const messages = await collector.waitForCount(3);
          expect(messages).toEqual(["message-1", "message-2", "message-3"]);
        },
        TEST_TIMEOUT_MS
      );

      it(
        "message data is raw string (not parsed)",
        async () => {
          const collector = new MessageCollector();
          const conn = sseClient.createSseConnection(sseServer.url("/events"));
          activeConnections.push(conn);

          conn.onMessage(collector.handler);
          await waitForConnectionState(conn, true);

          // Send JSON message
          const jsonData = '{"type":"test","value":42}';
          sseServer.sendSseMessage(jsonData);

          const messages = await collector.waitForCount(1);
          // Should be raw string, not parsed
          expect(typeof messages[0]).toBe("string");
          expect(messages[0]).toBe(jsonData);
        },
        TEST_TIMEOUT_MS
      );
    });

    // Run reconnection tests sequentially to avoid server state conflicts
    describe.sequential("reconnection", () => {
      it(
        "reconnects after server closes connection",
        async () => {
          const conn = sseClient.createSseConnection(sseServer.url("/events"), {
            initialReconnectDelay: 100, // Fast reconnection for testing
          });
          activeConnections.push(conn);

          await waitForConnectionState(conn, true);

          // Server closes all connections
          sseServer.closeSseConnections();

          // Wait for reconnection
          await waitForReconnection(conn, 5000);
          // If we reach here, reconnection succeeded
        },
        TEST_TIMEOUT_MS
      );

      it(
        "onStateChange fires false then true on reconnect",
        async () => {
          const stateChanges: boolean[] = [];
          const conn = sseClient.createSseConnection(sseServer.url("/events"), {
            initialReconnectDelay: 100,
          });
          activeConnections.push(conn);

          conn.onStateChange((connected) => {
            stateChanges.push(connected);
          });

          // Wait for initial connection
          await new Promise<void>((resolve) => {
            const check = (): void => {
              if (stateChanges.includes(true)) resolve();
              else setTimeout(check, 10);
            };
            check();
          });

          // Clear state changes to track only the reconnect
          stateChanges.length = 0;

          // Close server connections
          sseServer.closeSseConnections();

          // Wait for reconnection
          await new Promise<void>((resolve) => {
            const check = (): void => {
              // Looking for false then true
              const falseIdx = stateChanges.indexOf(false);
              const trueIdx = stateChanges.lastIndexOf(true);
              if (falseIdx >= 0 && trueIdx > falseIdx) resolve();
              else setTimeout(check, 10);
            };
            setTimeout(check, 50);
          });

          // Verify we saw: disconnected (false), then reconnected (true)
          expect(stateChanges).toContain(false);
          expect(stateChanges).toContain(true);
        },
        TEST_TIMEOUT_MS
      );

      it(
        "disconnect() stops reconnection attempts",
        async () => {
          let connectionCount = 0;
          const conn = sseClient.createSseConnection(sseServer.url("/events"), {
            initialReconnectDelay: 100,
          });
          activeConnections.push(conn);

          // Wait for initial connection using a custom wait that doesn't replace handler
          await new Promise<void>((resolve) => {
            conn.onStateChange((connected) => {
              if (connected) {
                connectionCount++;
                resolve();
              }
            });
          });

          expect(connectionCount).toBe(1);

          // Close server connections (triggers reconnection) and immediately disconnect
          sseServer.closeSseConnections();

          // Small delay to ensure disconnect event is processed
          await new Promise((resolve) => setTimeout(resolve, 20));

          // Call disconnect to prevent reconnection
          conn.disconnect();

          // Wait longer than multiple reconnect cycles would take
          await new Promise((resolve) => setTimeout(resolve, 500));

          // Should have only connected once - no reconnection should have happened
          expect(connectionCount).toBe(1);
        },
        TEST_TIMEOUT_MS
      );

      it(
        "handles multiple reconnection cycles",
        async () => {
          const conn = sseClient.createSseConnection(sseServer.url("/events"), {
            initialReconnectDelay: 100,
          });
          activeConnections.push(conn);

          await waitForConnectionState(conn, true);

          // First reconnection cycle
          sseServer.closeSseConnections();
          await waitForReconnection(conn, 5000);

          // Second reconnection cycle
          sseServer.closeSseConnections();
          await waitForReconnection(conn, 5000);

          // Third reconnection cycle
          sseServer.closeSseConnections();
          await waitForReconnection(conn, 5000);

          // If we reach here, all reconnections succeeded
        },
        TEST_TIMEOUT_MS
      );

      it(
        "resets backoff to 1s after successful connection",
        async () => {
          // Use 1000ms initial delay (default)
          const conn = sseClient.createSseConnection(sseServer.url("/events"), {
            initialReconnectDelay: 1000,
          });
          activeConnections.push(conn);

          // Wait for initial connection
          await waitForConnectionState(conn, true);

          // First disconnect → reconnect cycle
          const firstReconnectStart = Date.now();
          sseServer.closeSseConnections();
          await waitForReconnection(conn, 5000);
          const firstReconnectTime = Date.now() - firstReconnectStart;

          // First reconnection should be ~1s (initial delay)
          expect(firstReconnectTime).toBeGreaterThanOrEqual(1000 - SSE_RECONNECT_TOLERANCE_MS);
          expect(firstReconnectTime).toBeLessThanOrEqual(1000 + SSE_RECONNECT_TOLERANCE_MS);

          // Second disconnect → reconnect cycle
          // If backoff wasn't reset, this would be ~2s (doubled)
          // If backoff WAS reset (correct behavior), this should be ~1s again
          const secondReconnectStart = Date.now();
          sseServer.closeSseConnections();
          await waitForReconnection(conn, 5000);
          const secondReconnectTime = Date.now() - secondReconnectStart;

          // Second reconnection should ALSO be ~1s (backoff reset after success)
          expect(secondReconnectTime).toBeGreaterThanOrEqual(1000 - SSE_RECONNECT_TOLERANCE_MS);
          expect(secondReconnectTime).toBeLessThanOrEqual(1000 + SSE_RECONNECT_TOLERANCE_MS);
        },
        TEST_TIMEOUT_MS
      );
    });
  });
});
