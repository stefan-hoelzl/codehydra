/**
 * Lifecycle IPC handlers.
 *
 * These handlers are registered early in bootstrap() before startServices() runs,
 * making lifecycle operations available immediately when the renderer loads.
 *
 * IMPORTANT: These handlers must be registered BEFORE loading the UI.
 * The renderer calls lifecycle.getState() in onMount to determine which view to show.
 *
 * Timing:
 * 1. bootstrap() creates LifecycleApi
 * 2. registerLifecycleHandlers() is called
 * 3. UI is loaded
 * 4. Renderer calls lifecycle.getState() → handlers are ready
 */

import { ipcMain } from "electron";
import type { ILifecycleApi } from "../../shared/api/interfaces";
import { ApiIpcChannels } from "../../shared/ipc";

/**
 * Register lifecycle IPC handlers.
 *
 * These handlers delegate to the provided ILifecycleApi instance.
 * They are thin adapters with no business logic.
 *
 * @param lifecycleApi - The LifecycleApi instance to delegate to
 */
export function registerLifecycleHandlers(lifecycleApi: ILifecycleApi): void {
  // Get application state (ready or setup)
  ipcMain.handle(ApiIpcChannels.LIFECYCLE_GET_STATE, async () => {
    return await lifecycleApi.getState();
  });

  // Run setup process
  ipcMain.handle(ApiIpcChannels.LIFECYCLE_SETUP, async () => {
    return await lifecycleApi.setup();
  });

  // Quit application
  ipcMain.handle(ApiIpcChannels.LIFECYCLE_QUIT, async () => {
    return await lifecycleApi.quit();
  });
}
