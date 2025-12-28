/**
 * OpenCode integration services.
 * Public API for the opencode module.
 */

export { OpenCodeClient, type SessionEventCallback } from "./opencode-client";
export { AgentStatusManager, type StatusChangedCallback } from "./agent-status-manager";
export { OpenCodeServerManager } from "./opencode-server-manager";

// Re-export types
export type { Result, SessionStatus, IDisposable, Unsubscribe } from "./types";

export { ok, err } from "./types";
