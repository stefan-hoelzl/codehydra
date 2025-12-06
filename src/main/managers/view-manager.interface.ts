/**
 * Interface for ViewManager to enable testability.
 * Allows mocking in handler tests.
 */

import type { WebContentsView } from "electron";

/**
 * Function to unsubscribe from an event.
 */
export type Unsubscribe = () => void;

/**
 * Interface for managing WebContentsViews.
 * Used for dependency injection and testability.
 */
export interface IViewManager {
  /**
   * Returns the UI layer WebContentsView.
   */
  getUIView(): WebContentsView;

  /**
   * Creates a new workspace view.
   *
   * @param workspacePath - Absolute path to the workspace directory
   * @param url - URL to load in the view (code-server URL)
   * @returns The created WebContentsView
   */
  createWorkspaceView(workspacePath: string, url: string): WebContentsView;

  /**
   * Destroys a workspace view.
   *
   * @param workspacePath - Absolute path to the workspace directory
   */
  destroyWorkspaceView(workspacePath: string): void;

  /**
   * Gets a workspace view by path.
   *
   * @param workspacePath - Absolute path to the workspace directory
   * @returns The WebContentsView or undefined if not found
   */
  getWorkspaceView(workspacePath: string): WebContentsView | undefined;

  /**
   * Updates all view bounds (called on window resize).
   */
  updateBounds(): void;

  /**
   * Sets the active workspace.
   * Active workspace has full content bounds, others have zero bounds.
   *
   * @param workspacePath - Path to the workspace to activate, or null for none
   */
  setActiveWorkspace(workspacePath: string | null): void;

  /**
   * Focuses the active workspace view.
   */
  focusActiveWorkspace(): void;

  /**
   * Focuses the UI layer view.
   */
  focusUI(): void;
}
