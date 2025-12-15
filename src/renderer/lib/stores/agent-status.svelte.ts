/**
 * Agent status store using Svelte 5 runes.
 * Manages agent status for workspaces.
 * This is a pure state container - IPC subscriptions are handled externally.
 */

import { SvelteMap } from "svelte/reactivity";
import type { AggregatedAgentStatus } from "@shared/ipc";
import type { ProjectId, WorkspaceName, WorkspaceRef } from "@shared/api/types";
import { workspaceRefKey } from "$lib/utils/id-utils";

// ============ State ============

const _statuses = new SvelteMap<string, AggregatedAgentStatus>();

// ============ Default Status ============

const DEFAULT_STATUS: AggregatedAgentStatus = {
  status: "none",
  counts: { idle: 0, busy: 0 },
};

// ============ Actions ============

/**
 * Update the status for a specific workspace.
 * @param workspacePath - Path to the workspace
 * @param status - New aggregated agent status
 */
export function updateStatus(workspacePath: string, status: AggregatedAgentStatus): void {
  _statuses.set(workspacePath, status);
}

/**
 * Set all statuses at once from a record (typically from getAllAgentStatuses).
 * Clears existing statuses before setting new ones.
 * @param statuses - Record of workspace paths to their statuses
 */
export function setAllStatuses(statuses: Record<string, AggregatedAgentStatus>): void {
  _statuses.clear();
  for (const [path, status] of Object.entries(statuses)) {
    _statuses.set(path, status);
  }
}

/**
 * Get the status for a specific workspace.
 * @param workspacePath - Path to the workspace
 * @returns Aggregated status, or 'none' status if not found
 */
export function getStatus(workspacePath: string): AggregatedAgentStatus {
  return _statuses.get(workspacePath) ?? DEFAULT_STATUS;
}

/**
 * Reset store to initial state. Used for testing.
 */
export function reset(): void {
  _statuses.clear();
  _statusesByRef.clear();
}

// =============================================================================
// v2 API (WorkspaceRef-based)
// Uses composite key "projectId/workspaceName" for storage
// =============================================================================

const _statusesByRef = new SvelteMap<string, AggregatedAgentStatus>();

/**
 * Update status for a workspace using WorkspaceRef.
 * Stores using composite key "projectId/workspaceName".
 * @param ref - The workspace reference
 * @param status - The new status
 */
export function updateStatusByRef(ref: WorkspaceRef, status: AggregatedAgentStatus): void {
  const key = workspaceRefKey(ref);
  _statusesByRef.set(key, status);
}

/**
 * Get status for a workspace using WorkspaceRef.
 * @param ref - The workspace reference (projectId + workspaceName)
 * @returns Aggregated status, or 'none' status if not found
 */
export function getStatusByRef(ref: {
  projectId: ProjectId;
  workspaceName: WorkspaceName;
}): AggregatedAgentStatus {
  const key = `${ref.projectId}/${ref.workspaceName}`;
  return _statusesByRef.get(key) ?? DEFAULT_STATUS;
}

/**
 * Set all statuses using composite keys.
 * Clears existing statuses before setting new ones.
 * @param statuses - Map of composite keys to statuses
 */
export function setAllStatusesByRef(statuses: Map<string, AggregatedAgentStatus>): void {
  _statusesByRef.clear();
  for (const [key, status] of statuses) {
    _statusesByRef.set(key, status);
  }
}
