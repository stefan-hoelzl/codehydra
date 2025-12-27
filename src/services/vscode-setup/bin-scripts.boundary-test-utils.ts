/**
 * Test utilities for bin-scripts boundary tests.
 *
 * Provides mock OpenCode server for testing session restoration.
 */

import * as http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Session data returned by mock server.
 */
export interface MockSession {
  id: string;
  directory: string;
  parentID: string | null;
  time: { updated: number };
}

/**
 * Message data returned by mock server.
 */
export interface MockMessage {
  info: {
    role: "user" | "assistant";
    agent?: string;
    mode?: string;
  };
  parts: unknown[];
}

/**
 * Configuration for mock OpenCode server.
 */
export interface MockOpencodeServerConfig {
  /** Sessions to return from GET /session */
  sessions?: MockSession[] | null;
  /** Messages to return from GET /session/:id/message */
  messages?: Record<string, MockMessage[]>;
  /** HTTP status code to return for /session endpoint (default: 200) */
  sessionStatusCode?: number;
  /** HTTP status code to return for /session/:id/message endpoint (default: 200) */
  messageStatusCode?: number;
  /** Delay in ms before responding to /session (for timeout tests) */
  sessionDelay?: number;
  /** Delay in ms before responding to /session/:id/message (for timeout tests) */
  messageDelay?: number;
}

/**
 * Mock OpenCode server for testing session restoration.
 */
export interface MockOpencodeServer {
  /** Port the server is listening on */
  readonly port: number;
  /** Update sessions (can be changed between requests) */
  setSessions: (sessions: MockSession[] | null) => void;
  /** Update messages for a session (can be changed between requests) */
  setMessages: (sessionId: string, messages: MockMessage[]) => void;
  /** Start the server */
  start: () => Promise<void>;
  /** Stop the server */
  stop: () => Promise<void>;
  /** Records of requests received */
  readonly requests: { method: string; url: string }[];
}

/**
 * Create a mock OpenCode server for testing.
 *
 * @param config Initial configuration
 * @returns MockOpencodeServer instance
 */
export function createMockOpencodeServer(
  config: MockOpencodeServerConfig = {}
): MockOpencodeServer {
  let sessions: MockSession[] | null = config.sessions ?? null;
  const messages: Record<string, MockMessage[]> = config.messages ?? {};
  const sessionStatusCode = config.sessionStatusCode ?? 200;
  const messageStatusCode = config.messageStatusCode ?? 200;
  const sessionDelay = config.sessionDelay ?? 0;
  const messageDelay = config.messageDelay ?? 0;
  const requests: { method: string; url: string }[] = [];

  let server: http.Server | null = null;
  let port = 0;

  const requestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = req.url ?? "";
    requests.push({ method: req.method ?? "GET", url });

    // Route: GET /session
    if (url === "/session" && req.method === "GET") {
      setTimeout(() => {
        res.statusCode = sessionStatusCode;
        res.setHeader("Content-Type", "application/json");
        if (sessions === null) {
          res.end("null");
        } else {
          res.end(JSON.stringify(sessions));
        }
      }, sessionDelay);
      return;
    }

    // Route: GET /session/:id/message
    const messageMatch = url.match(/^\/session\/([^/]+)\/message$/);
    if (messageMatch && req.method === "GET") {
      const sessionId = messageMatch[1]!;
      setTimeout(() => {
        res.statusCode = messageStatusCode;
        res.setHeader("Content-Type", "application/json");
        const sessionMessages = messages[sessionId];
        if (sessionMessages === undefined) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "Session not found" }));
        } else {
          res.end(JSON.stringify(sessionMessages));
        }
      }, messageDelay);
      return;
    }

    // Unknown route
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Not found" }));
  };

  return {
    get port() {
      return port;
    },

    setSessions: (newSessions: MockSession[] | null) => {
      sessions = newSessions;
    },

    setMessages: (sessionId: string, newMessages: MockMessage[]) => {
      messages[sessionId] = newMessages;
    },

    start: () => {
      return new Promise<void>((resolve, reject) => {
        server = http.createServer(requestHandler);
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const addr = server!.address() as AddressInfo;
          port = addr.port;
          resolve();
        });
      });
    },

    stop: () => {
      return new Promise<void>((resolve) => {
        if (server) {
          server.close(() => {
            server = null;
            resolve();
          });
        } else {
          resolve();
        }
      });
    },

    get requests() {
      return requests;
    },
  };
}
