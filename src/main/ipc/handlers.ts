/**
 * IPC handler registration with type-safe wrappers and error serialization.
 */

import { ipcMain, BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import type { IpcCommands, IpcEvents } from "../../shared/ipc";
import { ValidationError, validate } from "./validation";
import { isServiceError } from "../../services/errors";

/**
 * Serialized IPC error format for transport.
 */
interface IpcErrorResponse {
  readonly type: "git" | "workspace" | "code-server" | "project-store" | "validation" | "unknown";
  readonly message: string;
  readonly code?: string;
}

/**
 * Type for IPC handler functions.
 */
export type IpcHandler<K extends keyof IpcCommands> = (
  event: IpcMainInvokeEvent,
  payload: IpcCommands[K]["payload"]
) => Promise<IpcCommands[K]["response"]>;

/**
 * Serializes an error for IPC transport.
 *
 * @param error - The error to serialize
 * @returns Serialized error object
 */
export function serializeError(error: unknown): IpcErrorResponse {
  // ServiceError subclasses have toJSON
  if (isServiceError(error)) {
    return error.toJSON() as IpcErrorResponse;
  }

  // ValidationError from our validation module
  if (error instanceof ValidationError) {
    return error.toJSON();
  }

  // Standard Error - wrap as unknown
  if (error instanceof Error) {
    return {
      type: "unknown",
      message: error.message,
    };
  }

  // Non-Error values
  return {
    type: "unknown",
    message: "Unknown error",
  };
}

/**
 * Registers a type-safe IPC handler with validation and error serialization.
 *
 * @param channel - The IPC channel name
 * @param schema - Zod schema for payload validation (null for void payload)
 * @param handler - The handler function
 */
export function registerHandler<K extends keyof IpcCommands>(
  channel: K,
  schema: z.ZodSchema | null,
  handler: IpcHandler<K>
): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, payload: unknown) => {
    try {
      // Validate payload if schema provided
      const validatedPayload = schema ? validate(schema, payload) : payload;

      // Execute handler
      return await handler(event, validatedPayload as IpcCommands[K]["payload"]);
    } catch (error) {
      // Serialize and re-throw for IPC
      throw serializeError(error);
    }
  });
}

/**
 * Emits an event to all renderer windows.
 *
 * @param channel - The event channel name
 * @param payload - The event payload
 */
export function emitEvent<K extends keyof IpcEvents>(channel: K, payload: IpcEvents[K]): void {
  const windows = BrowserWindow.getAllWindows();
  for (const window of windows) {
    window.webContents.send(channel, payload);
  }
}

// Import handlers and schemas
import {
  createProjectOpenHandler,
  createProjectCloseHandler,
  createProjectListHandler,
  createProjectSelectFolderHandler,
} from "./project-handlers";
import {
  createWorkspaceCreateHandler,
  createWorkspaceRemoveHandler,
  createWorkspaceSwitchHandler,
  createWorkspaceListBasesHandler,
  createWorkspaceUpdateBasesHandler,
  createWorkspaceIsDirtyHandler,
} from "./workspace-handlers";
import {
  ProjectOpenPayloadSchema,
  ProjectClosePayloadSchema,
  WorkspaceCreatePayloadSchema,
  WorkspaceRemovePayloadSchema,
  WorkspaceSwitchPayloadSchema,
  WorkspaceListBasesPayloadSchema,
  WorkspaceUpdateBasesPayloadSchema,
  WorkspaceIsDirtyPayloadSchema,
} from "./validation";
import type { AppState } from "../app-state";
import type { IViewManager } from "../managers/view-manager.interface";

/**
 * Registers all IPC handlers for the application.
 *
 * @param appState - The application state manager
 * @param viewManager - The view manager
 */
export function registerAllHandlers(appState: AppState, viewManager: IViewManager): void {
  // Project handlers
  registerHandler("project:open", ProjectOpenPayloadSchema, createProjectOpenHandler(appState));
  registerHandler("project:close", ProjectClosePayloadSchema, createProjectCloseHandler(appState));
  registerHandler("project:list", null, createProjectListHandler(appState));
  registerHandler("project:select-folder", null, createProjectSelectFolderHandler());

  // Workspace handlers
  registerHandler(
    "workspace:create",
    WorkspaceCreatePayloadSchema,
    createWorkspaceCreateHandler(appState, viewManager)
  );
  registerHandler(
    "workspace:remove",
    WorkspaceRemovePayloadSchema,
    createWorkspaceRemoveHandler(appState)
  );
  registerHandler(
    "workspace:switch",
    WorkspaceSwitchPayloadSchema,
    createWorkspaceSwitchHandler(appState, viewManager)
  );
  registerHandler(
    "workspace:list-bases",
    WorkspaceListBasesPayloadSchema,
    createWorkspaceListBasesHandler(appState)
  );
  registerHandler(
    "workspace:update-bases",
    WorkspaceUpdateBasesPayloadSchema,
    createWorkspaceUpdateBasesHandler(appState)
  );
  registerHandler(
    "workspace:is-dirty",
    WorkspaceIsDirtyPayloadSchema,
    createWorkspaceIsDirtyHandler(appState)
  );
}
