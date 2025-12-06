/**
 * Electron main process entry point.
 * Initializes all components and manages the application lifecycle.
 */

import { app, Menu, dialog } from "electron";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import nodePath from "node:path";
import {
  CodeServerManager,
  ProjectStore,
  getDataRootDir,
  getDataProjectsDir,
  type CodeServerConfig,
} from "../services";
import { WindowManager } from "./managers/window-manager";
import { ViewManager } from "./managers/view-manager";
import { AppState } from "./app-state";
import { registerAllHandlers } from "./ipc/handlers";

const __dirname = nodePath.dirname(fileURLToPath(import.meta.url));

/**
 * Creates the code-server configuration.
 */
function createCodeServerConfig(): CodeServerConfig {
  const dataRoot = getDataRootDir();
  return {
    runtimeDir: nodePath.join(dataRoot, "runtime"),
    extensionsDir: nodePath.join(dataRoot, "extensions"),
    userDataDir: nodePath.join(dataRoot, "user-data"),
  };
}

// Global state
let windowManager: WindowManager | null = null;
let viewManager: ViewManager | null = null;
let appState: AppState | null = null;
let codeServerManager: CodeServerManager | null = null;

/**
 * Initializes the application.
 */
async function initialize(): Promise<void> {
  // 1. Disable application menu
  Menu.setApplicationMenu(null);

  // 2. Start code-server
  const config = createCodeServerConfig();

  // Ensure required directories exist
  await Promise.all([
    mkdir(config.runtimeDir, { recursive: true }),
    mkdir(config.extensionsDir, { recursive: true }),
    mkdir(config.userDataDir, { recursive: true }),
  ]);

  codeServerManager = new CodeServerManager(config);

  try {
    await codeServerManager.ensureRunning();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    dialog.showErrorBox(
      "Code Server Error",
      `Failed to start code-server: ${message}\n\nThe application will run in degraded mode.`
    );
    // Don't exit - allow app to run in degraded mode
  }

  const port = codeServerManager.port() ?? 0;

  // 3. Create WindowManager
  windowManager = WindowManager.create();

  // 4. Create ViewManager
  viewManager = ViewManager.create(windowManager, {
    uiPreloadPath: nodePath.join(__dirname, "../preload/index.cjs"),
    webviewPreloadPath: nodePath.join(__dirname, "../preload/webview-preload.cjs"),
    codeServerPort: port,
  });

  // 5. Create ProjectStore and AppState
  const projectStore = new ProjectStore(getDataProjectsDir());
  appState = new AppState(projectStore, viewManager, port);

  // 6. Register IPC handlers
  registerAllHandlers(appState, viewManager);

  // 7. Load UI layer HTML
  const uiView = viewManager.getUIView();
  await uiView.webContents.loadFile(nodePath.join(__dirname, "../renderer/index.html"));

  // 8. Open DevTools in development only
  if (!app.isPackaged) {
    uiView.webContents.openDevTools({ mode: "bottom" });
  }

  // 9. Load persisted projects
  await appState.loadPersistedProjects();

  // 10. Set first workspace active if any projects loaded
  const projects = appState.getAllProjects();
  if (projects.length > 0) {
    const firstWorkspace = projects[0]?.workspaces[0];
    if (firstWorkspace) {
      viewManager.setActiveWorkspace(firstWorkspace.path);
    }
  }
}

/**
 * Cleans up resources on shutdown.
 */
async function cleanup(): Promise<void> {
  // Destroy all views
  if (viewManager) {
    viewManager.destroy();
    viewManager = null;
  }

  // Stop code-server
  if (codeServerManager) {
    await codeServerManager.stop();
    codeServerManager = null;
  }

  windowManager = null;
  appState = null;
}

// App lifecycle handlers
app.whenReady().then(initialize).catch(console.error);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    void cleanup().then(() => app.quit());
  }
});

app.on("activate", () => {
  if (windowManager === null) {
    void initialize().catch(console.error);
  }
});

app.on("before-quit", () => {
  void cleanup();
});
