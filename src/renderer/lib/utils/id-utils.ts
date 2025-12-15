/**
 * ID utilities for the renderer.
 *
 * NOTE: Project IDs come from the v2 API and should NOT be generated client-side.
 * The main process uses SHA-256 for deterministic ID generation; the renderer
 * should always use IDs from API responses.
 */

import type { ProjectId, WorkspaceName, WorkspaceRef } from "@shared/api/types";

/**
 * Minimal reference type for workspace identification (without path).
 * Used when creating references before the workspace exists.
 */
export interface WorkspaceKey {
  readonly projectId: ProjectId;
  readonly workspaceName: WorkspaceName;
}

/**
 * Creates a workspace reference from project ID and workspace name.
 * @param projectId - The project ID
 * @param workspaceName - The workspace name
 * @returns A WorkspaceKey with the provided identifiers
 */
export function createWorkspaceRef(projectId: string, workspaceName: string): WorkspaceKey {
  return {
    projectId: projectId as ProjectId,
    workspaceName: workspaceName as WorkspaceName,
  };
}

/**
 * Compares two workspace references for equality.
 * Two refs are equal if they have the same projectId and workspaceName.
 * @param a - First reference (can be null)
 * @param b - Second reference (can be null)
 * @returns True if both refs are null, or both have matching projectId and workspaceName
 */
export function workspaceRefEquals(
  a: WorkspaceRef | WorkspaceKey | null,
  b: WorkspaceRef | WorkspaceKey | null
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.projectId === b.projectId && a.workspaceName === b.workspaceName;
}

/**
 * Creates a composite string key from a workspace reference.
 * Useful for Map keys or Set lookups.
 * @param ref - The workspace reference
 * @returns A string in the format "projectId/workspaceName"
 */
export function workspaceRefKey(ref: WorkspaceRef | WorkspaceKey): string {
  return `${ref.projectId}/${ref.workspaceName}`;
}
