/**
 * View manager for managing WebContentsViews.
 * Handles UI layer, workspace views, bounds, and focus management.
 */

import { WebContentsView } from "electron";
import type { IViewManager, Unsubscribe } from "./view-manager.interface";
import type { WindowManager } from "./window-manager";
import { openExternal } from "../utils/external-url";

/**
 * Sidebar width in pixels.
 */
export const SIDEBAR_WIDTH = 250;

/**
 * Minimum window dimensions.
 */
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;

/**
 * Configuration for creating a ViewManager.
 */
export interface ViewManagerConfig {
  /** Path to the UI layer preload script */
  readonly uiPreloadPath: string;
  /** Path to the webview preload script */
  readonly webviewPreloadPath: string;
  /** Code-server port number */
  readonly codeServerPort: number;
}

/**
 * Manages WebContentsViews for the application.
 * Implements the IViewManager interface.
 */
export class ViewManager implements IViewManager {
  private readonly windowManager: WindowManager;
  private readonly config: ViewManagerConfig;
  private readonly uiView: WebContentsView;
  /**
   * Map of workspace paths to their WebContentsViews.
   *
   * Note: Uses `string` instead of branded `WorkspacePath` type because:
   * 1. Paths come from various sources (IPC payloads, providers, app state)
   * 2. Using WorkspacePath would require type guards at every entry point
   * 3. The validation happens at the IPC boundary, so paths here are already validated
   */
  private readonly workspaceViews: Map<string, WebContentsView> = new Map();
  private activeWorkspacePath: string | null = null;
  private readonly unsubscribeResize: Unsubscribe;

  private constructor(
    windowManager: WindowManager,
    config: ViewManagerConfig,
    uiView: WebContentsView
  ) {
    this.windowManager = windowManager;
    this.config = config;
    this.uiView = uiView;

    // Subscribe to resize events
    this.unsubscribeResize = this.windowManager.onResize(() => {
      this.updateBounds();
    });
  }

  /**
   * Creates a new ViewManager with a UI layer view.
   *
   * @param windowManager - The WindowManager instance
   * @param config - Configuration options
   * @returns A new ViewManager instance
   */
  static create(windowManager: WindowManager, config: ViewManagerConfig): ViewManager {
    // Create UI layer with security settings
    const uiView = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: config.uiPreloadPath,
      },
    });

    // Set transparent background for UI layer
    uiView.setBackgroundColor("#00000000");

    // Add UI layer to window
    windowManager.getWindow().contentView.addChildView(uiView);

    const manager = new ViewManager(windowManager, config, uiView);

    // Initial bounds update
    manager.updateBounds();

    return manager;
  }

  /**
   * Returns the UI layer WebContentsView.
   */
  getUIView(): WebContentsView {
    return this.uiView;
  }

  /**
   * Creates a new workspace view.
   *
   * @param workspacePath - Absolute path to the workspace directory
   * @param url - URL to load in the view (code-server URL)
   * @returns The created WebContentsView
   */
  createWorkspaceView(workspacePath: string, url: string): WebContentsView {
    // Create workspace view with security settings
    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: this.config.webviewPreloadPath,
      },
    });

    // Configure window open handler to open external URLs
    view.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      openExternal(targetUrl);
      return { action: "deny" };
    });

    // Configure navigation handler to prevent navigation away from code-server
    view.webContents.on("will-navigate", (event, navigationUrl) => {
      const codeServerOrigin = `http://localhost:${this.config.codeServerPort}`;
      if (!navigationUrl.startsWith(codeServerOrigin)) {
        event.preventDefault();
        openExternal(navigationUrl);
      }
    });

    // Configure permission handler
    view.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
      // Allow clipboard access, deny everything else
      if (permission === "clipboard-read" || permission === "clipboard-sanitized-write") {
        callback(true);
      } else {
        callback(false);
      }
    });

    // Load the URL
    void view.webContents.loadURL(url);

    // Add to window (workspace views are in front of UI layer)
    this.windowManager.getWindow().contentView.addChildView(view);

    // Store in map
    this.workspaceViews.set(workspacePath, view);

    // Update bounds
    this.updateBounds();

    return view;
  }

  /**
   * Destroys a workspace view.
   *
   * @param workspacePath - Absolute path to the workspace directory
   */
  destroyWorkspaceView(workspacePath: string): void {
    const view = this.workspaceViews.get(workspacePath);
    if (!view) {
      return;
    }

    // Remove from window
    this.windowManager.getWindow().contentView.removeChildView(view);

    // Close webContents
    view.webContents.close();

    // Remove from map
    this.workspaceViews.delete(workspacePath);

    // If this was the active workspace, clear it
    if (this.activeWorkspacePath === workspacePath) {
      this.activeWorkspacePath = null;
    }
  }

  /**
   * Gets a workspace view by path.
   *
   * @param workspacePath - Absolute path to the workspace directory
   * @returns The WebContentsView or undefined if not found
   */
  getWorkspaceView(workspacePath: string): WebContentsView | undefined {
    return this.workspaceViews.get(workspacePath);
  }

  /**
   * Updates all view bounds.
   * Called on window resize.
   */
  updateBounds(): void {
    const bounds = this.windowManager.getBounds();

    // Clamp to minimum dimensions
    const width = Math.max(bounds.width, MIN_WIDTH);
    const height = Math.max(bounds.height, MIN_HEIGHT);

    // UI layer: sidebar area only
    this.uiView.setBounds({
      x: 0,
      y: 0,
      width: SIDEBAR_WIDTH,
      height,
    });

    // Workspace views
    for (const [path, view] of this.workspaceViews) {
      if (path === this.activeWorkspacePath) {
        // Active workspace: content area
        view.setBounds({
          x: SIDEBAR_WIDTH,
          y: 0,
          width: width - SIDEBAR_WIDTH,
          height,
        });
      } else {
        // Inactive workspace: zero bounds (hidden)
        view.setBounds({
          x: 0,
          y: 0,
          width: 0,
          height: 0,
        });
      }
    }
  }

  /**
   * Sets the active workspace.
   * Active workspace has full content bounds, others have zero bounds.
   *
   * @param workspacePath - Path to the workspace to activate, or null for none
   */
  setActiveWorkspace(workspacePath: string | null): void {
    this.activeWorkspacePath = workspacePath;
    this.updateBounds();
  }

  /**
   * Focuses the active workspace view.
   */
  focusActiveWorkspace(): void {
    if (!this.activeWorkspacePath) {
      return;
    }

    const view = this.workspaceViews.get(this.activeWorkspacePath);
    if (view) {
      view.webContents.focus();
    }
  }

  /**
   * Focuses the UI layer view.
   */
  focusUI(): void {
    this.uiView.webContents.focus();
  }

  /**
   * Destroys the ViewManager and cleans up all views.
   * Called on application shutdown.
   */
  destroy(): void {
    // Unsubscribe from resize events
    this.unsubscribeResize();

    // Destroy all workspace views
    for (const path of this.workspaceViews.keys()) {
      this.destroyWorkspaceView(path);
    }

    // Close UI view
    this.uiView.webContents.close();
  }
}
