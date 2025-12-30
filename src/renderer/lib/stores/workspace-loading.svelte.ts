/**
 * Workspace loading state store using Svelte 5 runes.
 * Tracks which workspaces are currently loading (waiting for OpenCode client to attach).
 * This is a pure state container - IPC subscriptions are handled externally.
 */

import { SvelteSet } from "svelte/reactivity";

// ============ State ============

const _loadingWorkspaces = new SvelteSet<string>();

// ============ Actions ============

/**
 * Check if a workspace is currently loading.
 * @param path - Path to the workspace
 * @returns True if the workspace is loading, false otherwise
 */
export function isWorkspaceLoading(path: string): boolean {
  return _loadingWorkspaces.has(path);
}

/**
 * Set the loading state for a workspace.
 * @param path - Path to the workspace
 * @param loading - True to mark as loading, false to mark as loaded
 */
export function setWorkspaceLoading(path: string, loading: boolean): void {
  if (loading) {
    _loadingWorkspaces.add(path);
  } else {
    _loadingWorkspaces.delete(path);
  }
}

/**
 * Reactive getter for all loading workspaces.
 * Useful for debugging or displaying all loading states.
 */
export const loadingWorkspaces = {
  get value(): ReadonlySet<string> {
    return _loadingWorkspaces;
  },
};

/**
 * Reset store to initial state. Used for testing.
 */
export function reset(): void {
  _loadingWorkspaces.clear();
}
