/**
 * Type definitions for the Electron API exposed via contextBridge.
 * This file is in shared/ so both main/preload and renderer can access the types.
 */

import type {
  IpcCommands,
  ProjectOpenedEvent,
  ProjectClosedEvent,
  WorkspaceCreatedEvent,
  WorkspaceRemovedEvent,
  WorkspaceSwitchedEvent,
} from "./ipc";

/**
 * Function to unsubscribe from an event.
 */
export type Unsubscribe = () => void;

/**
 * Type-safe Electron API exposed to the renderer via contextBridge.
 */
export interface ElectronAPI {
  /**
   * Type-safe invoke for IPC commands.
   * @param channel - The IPC channel name
   * @param payload - The payload for the command (type-checked per channel)
   * @returns Promise resolving to the command's response type
   */
  invoke<K extends keyof IpcCommands>(
    channel: K,
    payload: IpcCommands[K]["payload"]
  ): Promise<IpcCommands[K]["response"]>;

  /**
   * Subscribe to project opened events.
   * @param callback - Called when a project is opened
   * @returns Unsubscribe function to remove the listener
   */
  onProjectOpened(callback: (event: ProjectOpenedEvent) => void): Unsubscribe;

  /**
   * Subscribe to project closed events.
   * @param callback - Called when a project is closed
   * @returns Unsubscribe function to remove the listener
   */
  onProjectClosed(callback: (event: ProjectClosedEvent) => void): Unsubscribe;

  /**
   * Subscribe to workspace created events.
   * @param callback - Called when a workspace is created
   * @returns Unsubscribe function to remove the listener
   */
  onWorkspaceCreated(callback: (event: WorkspaceCreatedEvent) => void): Unsubscribe;

  /**
   * Subscribe to workspace removed events.
   * @param callback - Called when a workspace is removed
   * @returns Unsubscribe function to remove the listener
   */
  onWorkspaceRemoved(callback: (event: WorkspaceRemovedEvent) => void): Unsubscribe;

  /**
   * Subscribe to workspace switched events.
   * @param callback - Called when the active workspace changes
   * @returns Unsubscribe function to remove the listener
   */
  onWorkspaceSwitched(callback: (event: WorkspaceSwitchedEvent) => void): Unsubscribe;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
