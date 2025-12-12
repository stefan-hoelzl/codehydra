/**
 * Test utilities for network layer mocking and boundary testing.
 *
 * Provides mock factories for HttpClient, SseClient, PortManager, and SseConnection
 * to enable easy unit testing of consumers.
 *
 * Also provides test server helpers for boundary tests against real HTTP/SSE servers.
 */

import {
  createServer as createHttpServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "http";
import {
  type HttpClient,
  type HttpRequestOptions,
  type SseClient,
  type SseConnection,
  type SseConnectionOptions,
  type PortManager,
  type ListeningPort,
} from "./network";

// ============================================================================
// SSE Synchronization Helpers for Boundary Tests
// ============================================================================

/**
 * Collects SSE messages for testing.
 *
 * @example
 * const collector = new MessageCollector();
 * conn.onMessage(collector.handler);
 * server.sendSseMessage('{"type":"test"}');
 * const messages = await collector.waitForCount(1);
 * expect(messages[0]).toBe('{"type":"test"}');
 */
export class MessageCollector {
  readonly messages: string[] = [];
  private resolvers: Array<() => void> = [];

  readonly handler = (data: string): void => {
    this.messages.push(data);
    // Resolve any waiting promises
    const resolver = this.resolvers.shift();
    if (resolver) resolver();
  };

  /**
   * Wait for at least `count` messages to be collected.
   * @param count - Number of messages to wait for
   * @param timeout - Timeout in ms (default 5000)
   * @returns Array of collected messages (may contain more than count)
   * @throws If timeout expires before count messages received
   */
  async waitForCount(count: number, timeout = 5000): Promise<string[]> {
    const start = Date.now();
    while (this.messages.length < count) {
      if (Date.now() - start > timeout) {
        throw new Error(`Timeout waiting for ${count} messages, got ${this.messages.length}`);
      }
      await new Promise<void>((resolve) => {
        this.resolvers.push(resolve);
        setTimeout(resolve, 100); // Poll fallback
      });
    }
    return this.messages.slice(0, count);
  }

  /**
   * Clear collected messages.
   */
  clear(): void {
    this.messages.length = 0;
  }
}

/**
 * Wait for SSE connection to reach expected state.
 *
 * @param conn - SSE connection to monitor
 * @param expectedConnected - Expected connected state
 * @param timeout - Timeout in ms (default 5000)
 *
 * @example
 * const conn = sseClient.createSseConnection(url);
 * await waitForConnectionState(conn, true); // Wait for connected
 * server.closeSseConnections();
 * await waitForConnectionState(conn, false); // Wait for disconnected
 */
export function waitForConnectionState(
  conn: SseConnection,
  expectedConnected: boolean,
  timeout = 5000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for connected=${expectedConnected}`));
    }, timeout);

    conn.onStateChange((connected) => {
      if (connected === expectedConnected) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

/**
 * Wait for SSE disconnect then reconnect cycle.
 *
 * @param conn - SSE connection to monitor
 * @param timeout - Timeout in ms (default 10000)
 *
 * @example
 * const conn = sseClient.createSseConnection(url);
 * await waitForConnectionState(conn, true);
 * server.closeSseConnections(); // Trigger disconnect
 * await waitForReconnection(conn); // Wait for reconnect
 */
export async function waitForReconnection(conn: SseConnection, timeout = 10000): Promise<void> {
  let sawDisconnect = false;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timeout waiting for reconnection"));
    }, timeout);

    conn.onStateChange((connected) => {
      if (!connected) {
        sawDisconnect = true;
      } else if (sawDisconnect && connected) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

// ============================================================================
// Mock Option Types
// ============================================================================

/**
 * Options for creating a mock HttpClient.
 */
export interface MockHttpClientOptions {
  /** Response to return from fetch. Default: 200 OK with empty body */
  readonly response?: Response;
  /** Error to throw from fetch */
  readonly error?: Error;
  /** Custom implementation for fetch */
  readonly implementation?: (url: string, options?: HttpRequestOptions) => Promise<Response>;
}

/**
 * Options for creating a mock PortManager.
 */
export interface MockPortManagerOptions {
  /** Options for findFreePort */
  readonly findFreePort?: { port?: number; error?: Error };
  /** Options for getListeningPorts */
  readonly getListeningPorts?: { ports?: ListeningPort[]; error?: Error };
}

/**
 * Options for creating a mock SseClient.
 */
export interface MockSseClientOptions {
  /** Connection to return from createSseConnection */
  readonly connection?: SseConnection;
  /** Custom implementation for createSseConnection */
  readonly implementation?: (url: string, options?: SseConnectionOptions) => SseConnection;
}

/**
 * Options for creating a mock SseConnection.
 */
export interface MockSseConnectionOptions {
  /** Messages to emit (will be emitted asynchronously) */
  readonly messages?: string[];
  /** Initial connected state. Default: true */
  readonly connected?: boolean;
}

// ============================================================================
// Mock HTTP Client
// ============================================================================

/**
 * Create a mock HttpClient for testing.
 *
 * @example Basic usage - returns 200 OK
 * const httpClient = createMockHttpClient();
 *
 * @example Return custom response
 * const httpClient = createMockHttpClient({
 *   response: new Response('{"status":"ok"}', { status: 200 })
 * });
 *
 * @example Throw error
 * const httpClient = createMockHttpClient({
 *   error: new Error('Connection refused')
 * });
 *
 * @example Custom implementation
 * const httpClient = createMockHttpClient({
 *   implementation: async (url) => {
 *     if (url.includes('/health')) return new Response('ok');
 *     throw new Error('Not found');
 *   }
 * });
 */
export function createMockHttpClient(options?: MockHttpClientOptions): HttpClient {
  const defaultResponse = new Response("", { status: 200 });

  return {
    fetch: async (url: string, fetchOptions?: HttpRequestOptions): Promise<Response> => {
      if (options?.implementation) {
        return options.implementation(url, fetchOptions);
      }
      if (options?.error) {
        throw options.error;
      }
      return options?.response ?? defaultResponse;
    },
  };
}

// ============================================================================
// Mock Port Manager
// ============================================================================

/**
 * Create a mock PortManager for testing.
 *
 * @example Basic usage - returns port 8080 and empty ports list
 * const portManager = createMockPortManager();
 *
 * @example Return custom port
 * const portManager = createMockPortManager({
 *   findFreePort: { port: 3000 }
 * });
 *
 * @example Return listening ports
 * const portManager = createMockPortManager({
 *   getListeningPorts: { ports: [{ port: 8080, pid: 1234 }] }
 * });
 *
 * @example Throw errors
 * const portManager = createMockPortManager({
 *   findFreePort: { error: new Error('No ports available') }
 * });
 */
export function createMockPortManager(options?: MockPortManagerOptions): PortManager {
  return {
    findFreePort: async (): Promise<number> => {
      if (options?.findFreePort?.error) {
        throw options.findFreePort.error;
      }
      return options?.findFreePort?.port ?? 8080;
    },
    getListeningPorts: async (): Promise<readonly ListeningPort[]> => {
      if (options?.getListeningPorts?.error) {
        throw options.getListeningPorts.error;
      }
      return options?.getListeningPorts?.ports ?? [];
    },
  };
}

// ============================================================================
// Mock SSE Connection
// ============================================================================

/**
 * Create a mock SseConnection for testing.
 *
 * @example Basic usage - connected, no messages
 * const connection = createMockSseConnection();
 *
 * @example With messages (emitted asynchronously)
 * const connection = createMockSseConnection({
 *   messages: ['{"type":"status","data":"idle"}', '{"type":"status","data":"busy"}']
 * });
 *
 * @example Disconnected state
 * const connection = createMockSseConnection({
 *   connected: false
 * });
 */
export function createMockSseConnection(options?: MockSseConnectionOptions): SseConnection {
  let messageHandler: ((data: string) => void) | null = null;
  let stateHandler: ((connected: boolean) => void) | null = null;
  let disposed = false;

  // Schedule initial state and messages
  if (options?.connected !== false) {
    queueMicrotask(() => {
      if (!disposed && stateHandler) {
        stateHandler(true);
      }
      // Emit messages after connected
      if (!disposed && messageHandler && options?.messages) {
        for (const message of options.messages) {
          if (!disposed) {
            messageHandler(message);
          }
        }
      }
    });
  } else {
    queueMicrotask(() => {
      if (!disposed && stateHandler) {
        stateHandler(false);
      }
    });
  }

  return {
    onMessage(handler: (data: string) => void): void {
      messageHandler = handler;
    },
    onStateChange(handler: (connected: boolean) => void): void {
      stateHandler = handler;
    },
    disconnect(): void {
      disposed = true;
      if (stateHandler) {
        stateHandler(false);
      }
    },
  };
}

// ============================================================================
// Mock SSE Client
// ============================================================================

/**
 * Create a mock SseClient for testing.
 *
 * @example Basic usage - returns mock connection
 * const sseClient = createMockSseClient();
 *
 * @example With custom connection
 * const connection = createMockSseConnection({ messages: ['test'] });
 * const sseClient = createMockSseClient({ connection });
 *
 * @example Custom implementation
 * const sseClient = createMockSseClient({
 *   implementation: (url) => {
 *     if (url.includes('error')) throw new Error('Invalid URL');
 *     return createMockSseConnection();
 *   }
 * });
 */
export function createMockSseClient(options?: MockSseClientOptions): SseClient {
  return {
    createSseConnection(url: string, connOptions?: SseConnectionOptions): SseConnection {
      if (options?.implementation) {
        return options.implementation(url, connOptions);
      }
      return options?.connection ?? createMockSseConnection();
    },
  };
}

// ============================================================================
// Test Server for Boundary Tests
// ============================================================================

/**
 * Delay for slow endpoint responses in boundary tests.
 */
export const SLOW_ENDPOINT_DELAY_MS = 2000;

/**
 * Route handler for test server.
 */
export type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Test HTTP server for boundary tests.
 */
export interface TestServer {
  /** Get the port the server is listening on. Throws if not started. */
  getPort(): number;
  /** Start the server. Resolves when listening. */
  start(): Promise<void>;
  /** Stop the server. Resolves when closed. Safe to call multiple times. */
  stop(): Promise<void>;
  /** Build URL for a given path. */
  url(path: string): string;
  /** Send SSE message to all connected clients. */
  sendSseMessage(data: string): void;
  /** Close all SSE connections (triggers reconnection in clients). */
  closeSseConnections(): void;
}

/**
 * Create a test HTTP server for boundary tests.
 *
 * By default includes these routes:
 * - GET /json → 200, {"status": "ok"}
 * - GET /echo-headers → 200, returns request headers as JSON
 * - GET /slow → 200 after SLOW_ENDPOINT_DELAY_MS (2000ms)
 * - GET /timeout → Never responds (for timeout testing)
 * - GET /error/404 → 404 Not Found
 * - GET /error/500 → 500 Internal Server Error
 * - GET /events → SSE stream
 *
 * @param routes - Custom routes to add or override defaults
 *
 * @example Basic usage
 * const server = createTestServer();
 * await server.start();
 * const response = await fetch(server.url('/json'));
 * await server.stop();
 *
 * @example Custom routes
 * const server = createTestServer({
 *   '/custom': (req, res) => {
 *     res.writeHead(200);
 *     res.end('custom response');
 *   }
 * });
 */
export function createTestServer(routes?: Record<string, RouteHandler>): TestServer {
  let serverPort: number | null = null;
  let server: Server | null = null;
  const sseConnections = new Set<ServerResponse>();

  const defaultRoutes: Record<string, RouteHandler> = {
    "/json": (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    },
    "/echo-headers": (req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(req.headers));
    },
    "/slow": (_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      }, SLOW_ENDPOINT_DELAY_MS);
    },
    "/timeout": () => {
      // Never responds - for timeout testing
    },
    "/error/404": (_req, res) => {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
    },
    "/error/500": (_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal Server Error" }));
    },
    "/events": (req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      // Send initial comment to flush headers and establish connection
      // This is valid SSE - lines starting with : are comments
      res.write(": connected\n\n");
      sseConnections.add(res);
      req.on("close", () => sseConnections.delete(res));
    },
  };

  const allRoutes = { ...defaultRoutes, ...routes };

  return {
    getPort(): number {
      if (serverPort === null) {
        throw new Error("Server not started - call start() first");
      }
      return serverPort;
    },

    async start(): Promise<void> {
      if (server) return; // Already started

      server = createHttpServer((req, res) => {
        const handler = allRoutes[req.url ?? ""];
        if (handler) {
          handler(req, res);
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      await new Promise<void>((resolve, reject) => {
        // CRITICAL: Bind to localhost only for security
        server!.listen(0, "localhost", () => {
          const addr = server!.address();
          if (addr && typeof addr === "object") {
            serverPort = addr.port;
            resolve();
          } else {
            reject(new Error("Failed to get server address"));
          }
        });
        server!.on("error", reject);
      });
    },

    async stop(): Promise<void> {
      // Close all SSE connections first
      for (const res of sseConnections) {
        res.end();
      }
      sseConnections.clear();

      if (!server || serverPort === null) {
        return; // Already stopped or never started
      }

      await new Promise<void>((resolve) => {
        // Always resolve, even on error (server may already be closed)
        server!.close(() => {
          serverPort = null;
          server = null;
          resolve();
        });
      });
    },

    url(path: string): string {
      if (serverPort === null) {
        throw new Error("Server not started - call start() first");
      }
      return `http://localhost:${serverPort}${path}`;
    },

    sendSseMessage(data: string): void {
      for (const res of sseConnections) {
        if (!res.writableEnded) {
          try {
            res.write(`data: ${data}\n\n`);
          } catch {
            // Connection closed, remove from set
            sseConnections.delete(res);
          }
        }
      }
    },

    closeSseConnections(): void {
      for (const res of sseConnections) {
        res.end();
      }
      sseConnections.clear();
    },
  };
}
