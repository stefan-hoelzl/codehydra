---
status: CLEANUP
last_updated: 2025-12-12
reviewers:
  [review-testing, review-typescript, review-arch, review-senior, review-docs, review-electron]
---

# NETWORK_BOUNDARY_TESTS

## Overview

- **Problem**: The `DefaultNetworkLayer` class has comprehensive unit tests that mock external dependencies (`globalThis.fetch`, `EventSource`), but these mocks may not accurately reflect real network behavior. We need boundary tests to verify the networking code works correctly against actual HTTP and SSE servers.

- **Solution**: Create boundary tests for `src/services/platform/network.ts` that test:
  - `HttpClient.fetch()` against a real local HTTP server
  - `SseClient.createSseConnection()` against a real SSE endpoint
  - Reorganize existing `PortManager` tests (already boundary-style) into proper boundary test file

- **Risks**:
  - Network tests can be flaky due to timing issues
  - SSE reconnection tests require careful coordination with server state
  - Tests may behave differently across platforms (connection refused errors)
  - Mitigation: Use appropriate timeouts, deterministic server behavior, skip problematic tests on specific platforms using `it.skipIf(isWindows)` pattern

- **Alternatives Considered**:
  - Using external test servers (httpbin, etc.): Rejected - adds external dependency, network latency
  - Mock-only approach: Current state - mocks may drift from real behavior
  - Contract testing: Overkill for HTTP/SSE which are well-defined protocols

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Network Boundary Test Setup                          │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    Test Process                                  │    │
│  │                                                                  │    │
│  │   ┌──────────────────┐         ┌──────────────────────────┐     │    │
│  │   │ DefaultNetwork   │         │   Local Test Server      │     │    │
│  │   │    Layer         │ ──────► │   (http.createServer)    │     │    │
│  │   │                  │  HTTP   │   BINDS TO LOCALHOST ONLY │     │    │
│  │   │ - HttpClient     │ ◄────── │                          │     │    │
│  │   │ - SseClient      │  SSE    │   Routes:                │     │    │
│  │   │ - PortManager    │  TCP    │   /json    → 200 + JSON  │     │    │
│  │   │                  │         │   /slow    → delayed     │     │    │
│  │   └──────────────────┘         │   /error   → 500         │     │    │
│  │           │                    │   /events  → SSE stream  │     │    │
│  │           │                    └──────────────────────────┘     │    │
│  │           │                                │                    │    │
│  │           │                    ┌───────────┴───────────┐        │    │
│  │           ▼                    │  Server Lifecycle     │        │    │
│  │   ┌──────────────────┐         │  - beforeAll: start   │        │    │
│  │   │   Real Systems   │         │  - afterAll: stop     │        │    │
│  │   │                  │         │  - afterEach: cleanup │        │    │
│  │   │ • TCP sockets    │         │    SSE connections    │        │    │
│  │   │ • globalThis.    │         └───────────────────────┘        │    │
│  │   │   fetch          │                                          │    │
│  │   │ • EventSource    │   Note: EventSource is provided by       │    │
│  │   │   (eventsource   │   the 'eventsource' npm package (v4),    │    │
│  │   │    npm package)  │   not Node.js built-in APIs.             │    │
│  │   │ • systeminfo     │                                          │    │
│  │   └──────────────────┘                                          │    │
│  │                                                                  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Test Server Routes

```
GET /json           → 200, {"status": "ok"}
GET /echo-headers   → 200, returns request headers as JSON
GET /slow           → 200 after SLOW_ENDPOINT_DELAY_MS (2000ms)
GET /timeout        → Never responds (for timeout testing)
GET /error/404      → 404 Not Found
GET /error/500      → 500 Internal Server Error
GET /events         → SSE stream (text/event-stream)
GET /events/single  → SSE: sends one message, closes
GET /events/multi   → SSE: sends multiple messages
```

## Implementation Steps

### Phase 1: Test Infrastructure

- [x] **Step 1.1: Create test server helper in network.test-utils.ts**
  - Create reusable test server factory in `src/services/platform/network.test-utils.ts`
  - **CRITICAL**: Bind to localhost only: `server.listen(0, 'localhost', callback)`
  - Support multiple route handlers via typed `RouteHandler` pattern
  - Automatic port allocation (port 0)
  - Proper startup/shutdown lifecycle with error handling
  - Encapsulate SSE connection tracking within server instance (not module-level)
  - Files affected: `src/services/platform/network.test-utils.ts` (new)
  - Test criteria:
    - `start()` resolves without error
    - `getPort()` returns port > 0 after start
    - `getPort()` throws if called before start
    - Server responds to GET `/json` with 200 status
    - `stop()` resolves within 1000ms
    - `stop()` resolves even if server already stopped

- [x] **Step 1.2: Create SSE test endpoint and helpers**
  - Implement SSE-compliant response streaming with proper headers
  - Encapsulate `sseConnections: Set<ServerResponse>` within server instance
  - Provide `sendSseMessage(data: string)` helper with error handling
  - Provide `closeSseConnections()` for cleanup and reconnection testing
  - Add `MessageCollector` helper class for async message collection
  - Files affected: `src/services/platform/network.test-utils.ts`
  - Test criteria:
    - Response has `Content-Type: text/event-stream` header
    - Response has `Cache-Control: no-cache` header
    - `data: ` prefix is present in response stream
    - `sendSseMessage()` handles closed connections gracefully

- [x] **Step 1.3: Create SSE synchronization helpers**
  - `waitForConnectionState(conn, expectedState, timeout)` - Promise that resolves when state matches
  - `waitForMessages(conn, count, timeout)` - Collects N messages or times out
  - `waitForReconnection(conn, timeout)` - Waits for disconnect→reconnect cycle
  - Files affected: `src/services/platform/network.test-utils.ts`
  - Test criteria: Helpers work correctly with real SSE connections

### Phase 2: PortManager Boundary Tests (Move Existing)

- [x] **Step 2.1: Move existing PortManager tests**
  - Move (relocate AND delete from source) `findFreePort()` tests from `network.test.ts` lines 186-231
  - Move (relocate AND delete from source) `getListeningPorts()` tests from `network.test.ts` lines 233-290
  - Delete tests from `network.test.ts` after verifying they pass in new location
  - Keep `network.test.ts` as pure unit test file with only mocked tests
  - Files affected: `src/services/platform/network.boundary.test.ts` (new), `src/services/platform/network.test.ts`
  - Test criteria: Tests pass in new location, no duplication, `network.test.ts` contains only mocked tests

- [x] **Step 2.2: Add missing PortManager boundary tests**
  - Test `findFreePort()` handles 100 concurrent calls (all unique ports, all bindable)
  - Test `getListeningPorts()` with multiple servers (3+)
  - Test `findFreePort()` binds to localhost (verify returned port is localhost-only)
  - Files affected: `src/services/platform/network.boundary.test.ts`
  - Test criteria: Edge cases covered with real sockets, 30s timeout for stress test

### Phase 3: HttpClient Boundary Tests

- [x] **Step 3.1: Basic HTTP operations**
  - Test successful GET request returns response
  - Test response body can be read as JSON
  - Test non-2xx status codes are returned (not thrown)
  - Test uses default 5000ms timeout when not specified
  - Files affected: `src/services/platform/network.boundary.test.ts`
  - Test criteria: Real HTTP requests work as expected

- [x] **Step 3.2: Timeout behavior**
  - Test request times out when server delay > timeout
  - Test custom timeout value is respected
  - Test AbortError is thrown on timeout (verify `error.name === 'AbortError'`)
  - Test timeout triggers AFTER the timeout duration, not before
  - Test cleans up AbortController after timeout
  - Test handles multiple concurrent requests with different timeouts
  - Files affected: `src/services/platform/network.boundary.test.ts`
  - Test criteria: Timeout triggers correctly with real delays

- [x] **Step 3.3: Connection error handling**
  - Test connection refused when no server (use `it.skipIf(isWindows)` if error format differs)
  - Test abort signal cancels request
  - Files affected: `src/services/platform/network.boundary.test.ts`
  - Test criteria: Network errors handled correctly

### Phase 4: SseClient Boundary Tests

- [x] **Step 4.1: Basic SSE connection**
  - Test connection established (onStateChange fires true)
  - Test messages received via onMessage handler
  - Test disconnect() closes connection cleanly
  - Test SSE endpoint returns correct Content-Type header
  - Files affected: `src/services/platform/network.boundary.test.ts`
  - Test criteria: SSE basics work with real EventSource from `eventsource` package

- [x] **Step 4.2: SSE message delivery**
  - Test single message delivery
  - Test multiple sequential messages received in order
  - Test message data is raw string (not parsed)
  - Use `MessageCollector` helper for async assertions
  - Files affected: `src/services/platform/network.boundary.test.ts`
  - Test criteria: All messages received in order

- [x] **Step 4.3: SSE reconnection (run sequentially)**
  - **Note**: Use `describe.sequential` for this group to avoid server state conflicts
  - Test reconnection after server closes connection
  - Test onStateChange fires false then true on reconnect
  - Test reconnection occurs within tolerance (1s ± 20% = 800ms-1200ms for first retry)
  - Test `dispose()` stops reconnection attempts (prevents resource leak)
  - Test multiple reconnection cycles work correctly
  - Test backoff resets to 1s after successful connection
  - Use `waitForReconnection()` helper to avoid race conditions
  - Files affected: `src/services/platform/network.boundary.test.ts`
  - Test criteria: Auto-reconnection works with real server, no flakiness

### Phase 5: Cleanup and Documentation

- [x] **Step 5.1: Update BOUNDARY_TESTS.md**
  - Update Step 2.B (OS Networking):
    - Change modules from `findAvailablePort, SiPortScanner` to `PortManager (DefaultNetworkLayer)`
    - Change file references from `process.boundary.test.ts, port-scanner.boundary.test.ts` to `network.boundary.test.ts`
    - Update module table to reference `src/services/platform/network.ts`
  - Update Step 2.C (HTTP):
    - Change modules from `fetchWithTimeout, HttpInstanceProbe` to `HttpClient, SseClient (DefaultNetworkLayer)`
    - Change file references from `http.boundary.test.ts, instance-probe.boundary.test.ts` to `network.boundary.test.ts`
    - Update module table to reference `src/services/platform/network.ts`
    - Add note: HttpClient, SseClient, and PortManager are tested together since DefaultNetworkLayer is a unified module
  - Mark Steps 2.B and 2.C as complete
  - Files affected: `planning/BOUNDARY_TESTS.md`
  - Test criteria: Plan reflects actual implementation with correct file paths

## Testing Strategy

### Named Constants

```typescript
// Timing constants
const TEST_TIMEOUT_MS = process.env.CI ? 30000 : 10000;
const SLOW_ENDPOINT_DELAY_MS = 2000;
const SSE_RECONNECT_TOLERANCE_MS = 200; // ±20% of 1000ms

// Test data
const TEST_JSON_RESPONSE = { status: "ok" };
const TEST_SSE_MESSAGE = JSON.stringify({ type: "test", data: "hello" });

// Platform detection (following process.boundary.test.ts pattern)
const isWindows = process.platform === "win32";
```

### Test Server Implementation

```typescript
// src/services/platform/network.test-utils.ts

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "http";

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void;

export interface TestServer {
  getPort(): number;
  start(): Promise<void>;
  stop(): Promise<void>;
  url(path: string): string;
  // SSE helpers
  sendSseMessage(data: string): void;
  closeSseConnections(): void;
}

export function createTestServer(routes?: Record<string, RouteHandler>): TestServer {
  let serverPort: number | null = null;
  const sseConnections = new Set<ServerResponse>();

  const defaultRoutes: Record<string, RouteHandler> = {
    "/json": (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    },
    "/slow": (_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      }, SLOW_ENDPOINT_DELAY_MS);
    },
    "/events": (req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      sseConnections.add(res);
      req.on("close", () => sseConnections.delete(res));
    },
    // ... other routes
  };

  const allRoutes = { ...defaultRoutes, ...routes };

  const server = createServer((req, res) => {
    const handler = allRoutes[req.url ?? ""];
    if (handler) {
      handler(req, res);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  return {
    getPort(): number {
      if (serverPort === null) {
        throw new Error("Server not started - call start() first");
      }
      return serverPort;
    },

    async start(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        // CRITICAL: Bind to localhost only for security
        server.listen(0, "localhost", () => {
          const addr = server.address();
          if (addr && typeof addr === "object") {
            serverPort = addr.port;
            resolve();
          } else {
            reject(new Error("Failed to get server address"));
          }
        });
        server.on("error", reject);
      });
    },

    async stop(): Promise<void> {
      // Close all SSE connections first
      for (const res of sseConnections) {
        res.end();
      }
      sseConnections.clear();

      await new Promise<void>((resolve) => {
        if (serverPort === null) {
          resolve();
          return;
        }
        // Always resolve, even on error (server may already be closed)
        server.close(() => {
          serverPort = null;
          resolve();
        });
      });
    },

    url(path: string): string {
      return `http://localhost:${this.getPort()}${path}`;
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
```

### SSE Synchronization Helpers

```typescript
// src/services/platform/network.test-utils.ts

import type { SseConnection } from "./network";

/**
 * Collects SSE messages for testing.
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
}

/**
 * Wait for SSE connection to reach expected state.
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
```

### Test Cases Table

| Test Case                              | Description                                 | File                     |
| -------------------------------------- | ------------------------------------------- | ------------------------ |
| HttpClient fetch success               | GET request returns response                | network.boundary.test.ts |
| HttpClient fetch JSON                  | Response body parsed as JSON                | network.boundary.test.ts |
| HttpClient default timeout             | Uses 5000ms when not specified              | network.boundary.test.ts |
| HttpClient custom timeout              | Request aborts after custom timeout         | network.boundary.test.ts |
| HttpClient timeout error               | AbortError thrown on timeout                | network.boundary.test.ts |
| HttpClient concurrent timeouts         | Multiple requests with different timeouts   | network.boundary.test.ts |
| HttpClient connection refused          | Error when no server                        | network.boundary.test.ts |
| HttpClient abort signal                | External abort cancels request              | network.boundary.test.ts |
| SSE connect                            | Connection established, onStateChange(true) | network.boundary.test.ts |
| SSE Content-Type header                | Endpoint returns text/event-stream          | network.boundary.test.ts |
| SSE receive message                    | Message delivered via handler               | network.boundary.test.ts |
| SSE multiple messages                  | All messages received in order              | network.boundary.test.ts |
| SSE disconnect                         | Clean disconnect, no reconnect              | network.boundary.test.ts |
| SSE reconnect                          | Auto-reconnect after server close           | network.boundary.test.ts |
| SSE dispose stops reconnect            | dispose() prevents reconnection             | network.boundary.test.ts |
| SSE multiple reconnects                | Multiple cycles work correctly              | network.boundary.test.ts |
| SSE backoff reset                      | Backoff resets after success                | network.boundary.test.ts |
| PortManager findFreePort               | Returns bindable port                       | network.boundary.test.ts |
| PortManager findFreePort concurrent    | 100 concurrent calls return unique ports    | network.boundary.test.ts |
| PortManager getListeningPorts          | Detects listening servers                   | network.boundary.test.ts |
| PortManager getListeningPorts multiple | Detects multiple servers                    | network.boundary.test.ts |

### Manual Testing Checklist

- [ ] Run `npm run test:boundary` - all tests pass
- [ ] Tests complete within timeout (30s local, may be slower in CI)
- [ ] No resource leaks: `server.listening === false` after afterAll
- [ ] No EventSource leaks: all connections tracked and cleaned up
- [ ] Tests are deterministic (run 10x without failures)

## Dependencies

| Package | Purpose                    | Approved |
| ------- | -------------------------- | -------- |
| (none)  | No new dependencies needed | N/A      |

**Existing dependencies used:**

- `http` (Node.js built-in) - Test HTTP server
- `vitest` - Test runner
- `eventsource` (v4.1.0) - Real EventSource polyfill for Node.js

**Note**: Verify `eventsource` v4's reconnection behavior matches test expectations. The package had a major version bump that may have changed reconnection semantics.

## Documentation Updates

### Files to Update

| File                         | Changes Required                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `planning/BOUNDARY_TESTS.md` | Update Steps 2.B and 2.C with correct module names and file paths (see Step 5.1 for details) |

### New Documentation Required

| File   | Purpose                                        |
| ------ | ---------------------------------------------- |
| (none) | Test utilities are self-documenting with JSDoc |

## Definition of Done

- [ ] All implementation steps complete
- [ ] `npm run test:boundary` passes with new tests
- [ ] `npm run validate:fix` passes
- [ ] No test flakiness (run 10x without failures)
- [ ] Resource cleanup verified:
  - `server.listening === false` after `afterAll()`
  - All SSE connections closed
  - No EventSource instances remain open
- [ ] BOUNDARY_TESTS.md updated with correct file references
- [ ] Changes committed

## Test File Structure

```typescript
// src/services/platform/network.boundary.test.ts

// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { DefaultNetworkLayer } from "./network";
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
const isWindows = process.platform === "win32";

// ============================================================================
// Test Suite
// ============================================================================

describe("DefaultNetworkLayer boundary tests", () => {
  let server: TestServer;
  let networkLayer: DefaultNetworkLayer;
  const activeConnections: SseConnection[] = []; // Track for cleanup

  beforeAll(async () => {
    server = createTestServer();
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    networkLayer = new DefaultNetworkLayer();
  });

  afterEach(() => {
    // Clean up any SSE connections created during test
    for (const conn of activeConnections) {
      conn.disconnect();
    }
    activeConnections.length = 0;
    // Clean up server-side SSE connections
    server.closeSseConnections();
  });

  // ============================================================================
  // PortManager Tests (moved from network.test.ts)
  // ============================================================================

  describe("PortManager", () => {
    describe("findFreePort", () => {
      it("returns valid port number (1024-65535)", async () => {
        /* ... */
      });
      it("returns port that can be bound immediately", async () => {
        /* ... */
      });
      it("handles 100 concurrent calls with unique ports", async () => {
        /* ... */
      }, 30000);
    });

    describe("getListeningPorts", () => {
      it("returns array of ListeningPort", async () => {
        /* ... */
      });
      it("includes our test server port", async () => {
        /* ... */
      });
      it("detects multiple listening servers", async () => {
        /* ... */
      });
    });
  });

  // ============================================================================
  // HttpClient Tests
  // ============================================================================

  describe("HttpClient", () => {
    describe("successful requests", () => {
      it(
        "fetches JSON from real endpoint",
        async () => {
          /* ... */
        },
        TEST_TIMEOUT_MS
      );
      it(
        "returns non-2xx status without throwing",
        async () => {
          /* ... */
        },
        TEST_TIMEOUT_MS
      );
      it(
        "uses default 5000ms timeout when not specified",
        async () => {
          /* ... */
        },
        TEST_TIMEOUT_MS
      );
    });

    describe("timeout behavior", () => {
      it(
        "times out on slow endpoint",
        async () => {
          /* ... */
        },
        TEST_TIMEOUT_MS
      );
      it(
        "respects custom timeout value",
        async () => {
          /* ... */
        },
        TEST_TIMEOUT_MS
      );
      it(
        "throws AbortError on timeout",
        async () => {
          /* ... */
        },
        TEST_TIMEOUT_MS
      );
      it(
        "handles multiple concurrent requests with different timeouts",
        async () => {
          /* ... */
        },
        TEST_TIMEOUT_MS
      );
    });

    describe("error handling", () => {
      it.skipIf(isWindows)(
        "handles connection refused",
        async () => {
          /* ... */
        },
        TEST_TIMEOUT_MS
      );
      it(
        "handles abort signal",
        async () => {
          /* ... */
        },
        TEST_TIMEOUT_MS
      );
    });
  });

  // ============================================================================
  // SseClient Tests
  // ============================================================================

  describe("SseClient", () => {
    describe("connection lifecycle", () => {
      it(
        "connects and fires onStateChange(true)",
        async () => {
          /* ... */
        },
        TEST_TIMEOUT_MS
      );
      it(
        "returns correct Content-Type header",
        async () => {
          /* ... */
        },
        TEST_TIMEOUT_MS
      );
      it(
        "disconnect() closes cleanly",
        async () => {
          /* ... */
        },
        TEST_TIMEOUT_MS
      );
    });

    describe("message delivery", () => {
      it(
        "receives messages via onMessage",
        async () => {
          /* ... */
        },
        TEST_TIMEOUT_MS
      );
      it(
        "receives multiple messages in order",
        async () => {
          /* ... */
        },
        TEST_TIMEOUT_MS
      );
    });

    // Run reconnection tests sequentially to avoid server state conflicts
    describe.sequential("reconnection", () => {
      it(
        "reconnects after server closes connection",
        async () => {
          /* ... */
        },
        TEST_TIMEOUT_MS
      );
      it(
        "dispose() stops reconnection attempts",
        async () => {
          /* ... */
        },
        TEST_TIMEOUT_MS
      );
      it(
        "handles multiple reconnection cycles",
        async () => {
          /* ... */
        },
        TEST_TIMEOUT_MS
      );
      it(
        "resets backoff to 1s after successful connection",
        async () => {
          /* ... */
        },
        TEST_TIMEOUT_MS
      );
    });
  });
});
```

## Notes

- **Real timers**: Unlike unit tests, boundary tests use real timers. Use tolerance values (e.g., 1s ± 20%) for timing assertions.
- **Port allocation**: Always use port 0 for automatic assignment. **Always bind to 'localhost'** to avoid security issues.
- **SSE reconnection timing**: Testing exact backoff is flaky. Test that reconnection happens within tolerance, not exact delays.
- **Platform differences**: Connection refused errors have different formats on Windows vs Unix. Use `it.skipIf(isWindows)` pattern from `process.boundary.test.ts`.
- **Test isolation**: Each test gets a fresh `DefaultNetworkLayer` instance. Server is shared via `beforeAll`/`afterAll`. SSE connections are cleaned up in `afterEach`.
- **EventSource package**: The `eventsource` npm package provides EventSource for Node.js. It's not a built-in API. Tests exercise the same code path as production.
- **CI timeouts**: Tests may be slower in CI. Use environment-aware timeout: `process.env.CI ? 30000 : 10000`.
