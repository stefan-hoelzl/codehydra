/**
 * Preload script for the UI layer.
 * Exposes type-safe IPC API via contextBridge.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { IpcCommands } from "../shared/ipc";
import type {
  ProjectOpenedEvent,
  ProjectClosedEvent,
  WorkspaceCreatedEvent,
  WorkspaceRemovedEvent,
  WorkspaceSwitchedEvent,
} from "../shared/ipc";

/**
 * Function to unsubscribe from an event.
 */
type Unsubscribe = () => void;

/**
 * Type-safe invoke wrapper.
 */
function invoke<K extends keyof IpcCommands>(
  channel: K,
  payload: IpcCommands[K]["payload"]
): Promise<IpcCommands[K]["response"]> {
  return ipcRenderer.invoke(channel, payload);
}

/**
 * Creates a type-safe event subscription function.
 */
function createEventSubscription<T>(channel: string) {
  return (callback: (event: T) => void): Unsubscribe => {
    const handler = (_event: IpcRendererEvent, data: T) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

// Expose the Electron API to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  // Type-safe invoke for commands
  invoke,

  // Event subscriptions with cleanup
  onProjectOpened: createEventSubscription<ProjectOpenedEvent>("project:opened"),
  onProjectClosed: createEventSubscription<ProjectClosedEvent>("project:closed"),
  onWorkspaceCreated: createEventSubscription<WorkspaceCreatedEvent>("workspace:created"),
  onWorkspaceRemoved: createEventSubscription<WorkspaceRemovedEvent>("workspace:removed"),
  onWorkspaceSwitched: createEventSubscription<WorkspaceSwitchedEvent>("workspace:switched"),
});
