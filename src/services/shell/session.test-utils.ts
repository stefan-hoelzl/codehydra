/**
 * Behavioral mock for SessionLayer.
 *
 * This mock maintains internal state that mirrors the behavior of the real
 * DefaultSessionLayer, allowing integration tests to verify behavior without
 * requiring Electron.
 */

import type { SessionLayer, PermissionRequestHandler, PermissionCheckHandler } from "./session";
import type { SessionHandle } from "./types";
import { ShellError } from "./errors";

/**
 * Internal state for a session.
 */
interface SessionState {
  partition: string;
  cleared: boolean;
  hasPermissionRequestHandler: boolean;
  hasPermissionCheckHandler: boolean;
}

/**
 * State exposed for test assertions.
 */
export interface SessionLayerState {
  sessions: Map<string, SessionState>;
}

/**
 * Behavioral mock of SessionLayer with state inspection.
 */
export interface BehavioralSessionLayer extends SessionLayer {
  /**
   * Get the internal state for test assertions.
   */
  _getState(): SessionLayerState;

  /**
   * Get the partition name for a session handle.
   */
  _getPartition(handle: SessionHandle): string;
}

/**
 * Creates a behavioral mock of SessionLayer.
 *
 * The mock maintains state and validates operations just like the real
 * implementation, making it suitable for integration tests.
 */
export function createBehavioralSessionLayer(): BehavioralSessionLayer {
  const sessions = new Map<string, SessionState>();
  // Map partition name to handle ID for quick lookup
  const partitionToId = new Map<string, string>();
  let nextId = 1;

  function getSession(handle: SessionHandle): SessionState {
    const state = sessions.get(handle.id);
    if (!state) {
      throw new ShellError("SESSION_NOT_FOUND", `Session ${handle.id} not found`, handle.id);
    }
    return state;
  }

  return {
    fromPartition(partition: string): SessionHandle {
      // Check if we already have a handle for this partition
      const existingId = partitionToId.get(partition);
      if (existingId) {
        return { id: existingId, __brand: "SessionHandle" };
      }

      // Create new session
      const id = `session-${nextId++}`;
      sessions.set(id, {
        partition,
        cleared: false,
        hasPermissionRequestHandler: false,
        hasPermissionCheckHandler: false,
      });
      partitionToId.set(partition, id);

      return { id, __brand: "SessionHandle" };
    },

    async clearStorageData(handle: SessionHandle): Promise<void> {
      const state = getSession(handle);
      state.cleared = true;
    },

    setPermissionRequestHandler(
      handle: SessionHandle,
      handler: PermissionRequestHandler | null
    ): void {
      const state = getSession(handle);
      state.hasPermissionRequestHandler = handler !== null;
    },

    setPermissionCheckHandler(handle: SessionHandle, handler: PermissionCheckHandler | null): void {
      const state = getSession(handle);
      state.hasPermissionCheckHandler = handler !== null;
    },

    async dispose(): Promise<void> {
      sessions.clear();
      partitionToId.clear();
    },

    // Test helper methods
    _getState(): SessionLayerState {
      const state = new Map<string, SessionState>();
      for (const [id, sessionState] of sessions) {
        state.set(id, { ...sessionState });
      }
      return { sessions: state };
    },

    _getPartition(handle: SessionHandle): string {
      const state = getSession(handle);
      return state.partition;
    },
  };
}
