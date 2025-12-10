/**
 * OpenCode client for communicating with OpenCode instances.
 * Handles HTTP requests and SSE connections.
 */

import { EventSource } from "eventsource";
import { fetchWithTimeout } from "../platform/http";
import { OpenCodeError } from "../errors";
import {
  ok,
  err,
  type Result,
  type Session,
  type SessionListResponse,
  type SessionStatus,
  type SessionStatusResponse,
  type IDisposable,
  type Unsubscribe,
} from "./types";

/**
 * Callback for session events.
 */
export type SessionEventCallback = (event: SessionStatus) => void;

/**
 * Type guard for SessionStatusResponse.
 * OpenCode returns a direct array of sessions.
 */
function isSessionStatusResponse(value: unknown): value is SessionStatusResponse {
  if (!Array.isArray(value)) return false;

  return value.every(
    (s) =>
      typeof s === "object" &&
      s !== null &&
      typeof s.id === "string" &&
      (s.status === "idle" || s.status === "busy")
  );
}

/**
 * Type guard for SessionListResponse.
 * Validates session list from /session endpoint.
 */
function isSessionListResponse(value: unknown): value is SessionListResponse {
  if (!Array.isArray(value)) return false;

  return value.every(
    (s) =>
      typeof s === "object" &&
      s !== null &&
      typeof s.id === "string" &&
      typeof s.directory === "string" &&
      (s.parentID === undefined || typeof s.parentID === "string")
  );
}

/**
 * Client for communicating with a single OpenCode instance.
 */
export class OpenCodeClient implements IDisposable {
  private readonly baseUrl: string;
  private readonly listeners = new Set<SessionEventCallback>();
  private eventSource: EventSource | null = null;
  private disposed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 30000;

  /**
   * Set of root session IDs (sessions without a parentID).
   * Only events for these sessions are emitted.
   */
  private readonly rootSessionIds = new Set<string>();

  constructor(port: number) {
    this.baseUrl = `http://localhost:${port}`;
  }

  /**
   * Get all sessions and identify root sessions (those without parentID).
   * Must be called before connect() to properly filter events.
   */
  async fetchRootSessions(): Promise<Result<Session[], OpenCodeError>> {
    const url = `${this.baseUrl}/session`;

    try {
      const response = await fetchWithTimeout(url);

      if (!response.ok) {
        return err(new OpenCodeError(`HTTP ${response.status}`, "REQUEST_FAILED"));
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        return err(new OpenCodeError("Invalid JSON response", "INVALID_RESPONSE"));
      }

      if (!isSessionListResponse(data)) {
        return err(new OpenCodeError("Invalid response structure", "INVALID_RESPONSE"));
      }

      // Clear and rebuild root session set
      this.rootSessionIds.clear();
      for (const session of data) {
        if (!session.parentID) {
          this.rootSessionIds.add(session.id);
        }
      }

      // Return only root sessions
      const rootSessions = data.filter((s) => !s.parentID);
      return ok(rootSessions);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return err(new OpenCodeError("Request timeout", "TIMEOUT"));
      }
      return err(
        new OpenCodeError(
          error instanceof Error ? error.message : "Unknown error",
          "REQUEST_FAILED"
        )
      );
    }
  }

  /**
   * Check if a session ID is a root session.
   */
  isRootSession(sessionId: string): boolean {
    return this.rootSessionIds.has(sessionId);
  }

  /**
   * Get current session statuses.
   */
  async getSessionStatuses(): Promise<Result<SessionStatus[], OpenCodeError>> {
    const url = `${this.baseUrl}/session/status`;

    try {
      const response = await fetchWithTimeout(url);

      if (!response.ok) {
        return err(new OpenCodeError(`HTTP ${response.status}`, "REQUEST_FAILED"));
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        return err(new OpenCodeError("Invalid JSON response", "INVALID_RESPONSE"));
      }

      if (!isSessionStatusResponse(data)) {
        return err(new OpenCodeError("Invalid response structure", "INVALID_RESPONSE"));
      }

      // Only return statuses for root sessions
      const statuses: SessionStatus[] = data
        .filter((s) => this.rootSessionIds.has(s.id))
        .map((s) => ({
          type: s.status,
          sessionId: s.id,
        }));

      return ok(statuses);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return err(new OpenCodeError("Request timeout", "TIMEOUT"));
      }
      return err(
        new OpenCodeError(
          error instanceof Error ? error.message : "Unknown error",
          "REQUEST_FAILED"
        )
      );
    }
  }

  /**
   * Subscribe to session events.
   */
  onSessionEvent(callback: SessionEventCallback): Unsubscribe {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Connect to SSE event stream.
   */
  connect(): void {
    if (this.disposed || this.eventSource) return;

    try {
      this.eventSource = new EventSource(`${this.baseUrl}/event`);

      this.eventSource.onopen = () => {
        // Reset reconnect delay on successful connection
        this.reconnectDelay = 1000;
      };

      this.eventSource.onerror = () => {
        this.handleDisconnect();
      };

      this.eventSource.onmessage = (event) => {
        this.handleMessage(event);
      };

      // Listen for specific event types
      this.eventSource.addEventListener("session.status", (event) => {
        const parsed = this.parseSSEEvent("session.status", event.data);
        if (parsed) this.emitSessionEvent(parsed);
      });

      this.eventSource.addEventListener("session.deleted", (event) => {
        const parsed = this.parseSSEEvent("session.deleted", event.data);
        if (parsed) this.emitSessionEvent(parsed);
      });

      this.eventSource.addEventListener("session.idle", (event) => {
        const parsed = this.parseSSEEvent("session.idle", event.data);
        if (parsed) this.emitSessionEvent(parsed);
      });

      this.eventSource.addEventListener("session.created", (event) => {
        this.handleSessionCreated(event.data);
      });
    } catch {
      this.handleDisconnect();
    }
  }

  /**
   * Disconnect from SSE event stream.
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  /**
   * Dispose the client.
   */
  dispose(): void {
    this.disposed = true;
    this.disconnect();
    this.listeners.clear();
  }

  /**
   * Parse an SSE event into a SessionStatus.
   * Exposed for testing.
   */
  private parseSSEEvent(eventType: string, data: string): SessionStatus | null {
    try {
      const parsed = JSON.parse(data) as { id?: string; status?: string };

      if (typeof parsed.id !== "string") return null;

      switch (eventType) {
        case "session.status":
          if (parsed.status === "idle" || parsed.status === "busy") {
            return { type: parsed.status, sessionId: parsed.id };
          }
          return null;
        case "session.idle":
          return { type: "idle", sessionId: parsed.id };
        case "session.deleted":
          return { type: "deleted", sessionId: parsed.id };
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  /**
   * Emit a session event to all listeners.
   * Only emits for root sessions (those without parentID).
   */
  private emitSessionEvent(event: SessionStatus): void {
    // Only emit events for root sessions
    if (!this.rootSessionIds.has(event.sessionId)) {
      return;
    }

    // Handle deleted events - remove from root set
    if (event.type === "deleted") {
      this.rootSessionIds.delete(event.sessionId);
    }

    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /**
   * Handle session.created events.
   * Adds new root sessions to the tracking set.
   */
  private handleSessionCreated(data: string): void {
    try {
      const parsed = JSON.parse(data) as {
        info?: { id?: string; parentID?: string };
      };

      const sessionInfo = parsed.info;
      if (!sessionInfo || typeof sessionInfo.id !== "string") return;

      // Only track root sessions (those without parentID)
      if (!sessionInfo.parentID) {
        this.rootSessionIds.add(sessionInfo.id);
        // Emit idle status for new root session
        this.emitSessionEvent({ type: "idle", sessionId: sessionInfo.id });
      }
    } catch {
      // Ignore parse errors
    }
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data as string) as {
        type?: string;
        properties?: {
          sessionID?: string;
          status?: { type?: string };
          info?: { id?: string; parentID?: string };
        };
      };

      if (!data.type) return;

      // Handle session.created specially - needs info.parentID check
      if (data.type === "session.created") {
        const sessionInfo = data.properties?.info;
        if (sessionInfo && typeof sessionInfo.id === "string" && !sessionInfo.parentID) {
          this.rootSessionIds.add(sessionInfo.id);
          this.emitSessionEvent({ type: "idle", sessionId: sessionInfo.id });
        }
        return;
      }

      if (!data.properties?.sessionID) return;

      let sessionEvent: SessionStatus | null = null;

      switch (data.type) {
        case "session.status": {
          const statusType = data.properties.status?.type;
          if (statusType === "idle" || statusType === "busy") {
            sessionEvent = { type: statusType, sessionId: data.properties.sessionID };
          }
          break;
        }
        case "session.idle":
          sessionEvent = { type: "idle", sessionId: data.properties.sessionID };
          break;
        case "session.deleted":
          sessionEvent = { type: "deleted", sessionId: data.properties.sessionID };
          break;
      }

      if (sessionEvent) {
        this.emitSessionEvent(sessionEvent);
      }
    } catch {
      // Ignore parse errors for non-session events
    }
  }

  private handleDisconnect(): void {
    this.disconnect();

    if (this.disposed) return;

    // Exponential backoff reconnection
    this.reconnectTimer = setTimeout(() => {
      if (!this.disposed) {
        this.connect();
      }
    }, this.reconnectDelay);

    // Increase delay for next attempt (capped at max)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }
}
