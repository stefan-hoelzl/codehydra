---
status: COMPLETED
last_updated: 2025-12-06
reviewers: [review-electron, review-typescript, review-arch, review-testing, review-docs]
---

# Phase 3: Electron Backend

## Overview

- **Problem**: The application has pure Node.js services (Phase 2) but no way to connect them to the UI layer. The current main process is a minimal shell with a single WebContentsView.
- **Solution**: Implement the Electron main process architecture with IPC handlers, view management, and preload scripts that bridge the renderer to services.
- **Risks**:
  - IPC type safety across process boundaries → Mitigated by mapped types with compile-time enforcement
  - IPC payload security → Mitigated by zod schema validation on all inputs
  - WebContentsView lifecycle management → Mitigated by centralized ViewManager with proper cleanup
  - Code-server process management → Mitigated by existing CodeServerManager with health checks
- **Alternatives Considered**:
  - BrowserWindow instead of BaseWindow+WebContentsView: Rejected - doesn't support the transparent overlay pattern needed for keyboard navigation
  - electron-trpc for IPC: Rejected - adds complexity; typed IPC handlers with zod validation are sufficient

**Scope Boundaries**:

- ✅ IN SCOPE: Window management, view management, IPC contract, preload scripts, code-server integration
- ❌ OUT OF SCOPE: Keyboard shortcuts (Phase 5), UI components (Phase 4), OpenCode integration (Phase 6)

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              BaseWindow                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                         contentView                                      │ │
│  │  ┌─────────────────┐  ┌─────────────────────────────────────────────┐   │ │
│  │  │   UI Layer      │  │           Workspace Views                   │   │ │
│  │  │ WebContentsView │  │  ┌───────────┐ ┌───────────┐ ┌───────────┐  │   │ │
│  │  │                 │  │  │ View 1    │ │ View 2    │ │ View 3    │  │   │ │
│  │  │ Bounds: sidebar │  │  │ (visible) │ │ (hidden)  │ │ (hidden)  │  │   │ │
│  │  │ only in normal  │  │  │ bounds:   │ │ bounds:   │ │ bounds:   │  │   │ │
│  │  │ mode            │  │  │ content   │ │ 0x0       │ │ 0x0       │  │   │ │
│  │  │                 │  │  │ area      │ │           │ │           │  │   │ │
│  │  │ Z-order: behind │  │  └───────────┘ └───────────┘ └───────────┘  │   │ │
│  │  │ workspace views │  │                                             │   │ │
│  │  └─────────────────┘  └─────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘

Z-order (front to back): workspace views → UI layer
Visibility: Active workspace has content bounds; inactive have 0x0 bounds
```

### ViewManager State Diagram

```
View Lifecycle:

  [not created] ──createWorkspaceView()──► [created/hidden]
                                               │
                                               │ bounds: (0, 0, 0, 0)
                                               │
                                    setActiveWorkspace()
                                               │
                                               ▼
                                          [active/visible]
                                               │
                                               │ bounds: (SIDEBAR_WIDTH, 0, w, h)
                                               │
                                    setActiveWorkspace(other)
                                               │
                                               ▼
                                          [hidden]
                                               │
                                    destroyWorkspaceView()
                                               │
                                               ▼
                                          [destroyed]
```

### File Structure

```
src/
├── main/
│   ├── index.ts                    # Entry point, app lifecycle, wiring
│   ├── managers/
│   │   ├── window-manager.ts       # BaseWindow creation, resize
│   │   ├── view-manager.ts         # WebContentsView lifecycle, bounds, z-order
│   │   ├── view-manager.interface.ts # IViewManager interface for testability
│   │   └── index.ts                # Manager exports
│   ├── ipc/
│   │   ├── handlers.ts             # IPC handler registration with error wrapper
│   │   ├── project-handlers.ts     # Project-related IPC handlers
│   │   ├── workspace-handlers.ts   # Workspace-related IPC handlers
│   │   ├── validation.ts           # Zod schemas for payload validation
│   │   └── index.ts                # IPC exports
│   ├── utils/
│   │   └── external-url.ts         # Cross-platform external URL opening
│   └── test-utils.ts               # Mock factories for Electron APIs
├── preload/
│   ├── index.ts                    # UI layer preload (existing, expand)
│   └── webview-preload.ts          # Code-server views preload (NEW)
└── shared/
    ├── ipc.ts                      # IPC contract with type-safe mapping
    └── electron-api.d.ts           # ElectronAPI type definition
```

### Component Wiring

```typescript
// src/main/index.ts - Component instantiation and wiring

app.whenReady().then(async () => {
  // 1. Start code-server first (may take a few seconds)
  const codeServerManager = new CodeServerManager(config);
  await codeServerManager.ensureRunning();
  const port = codeServerManager.port();

  // 2. Create managers
  const windowManager = WindowManager.create();
  const viewManager = ViewManager.create(windowManager, {
    uiPreloadPath: path.join(__dirname, "../preload/index.js"),
    webviewPreloadPath: path.join(__dirname, "../preload/webview-preload.js"),
    codeServerPort: port,
  });

  // 3. Create app state (manages projects/workspaces data)
  const projectStore = new ProjectStore();
  const appState = new AppState(projectStore, viewManager, port);

  // 4. Register IPC handlers
  registerAllHandlers(appState, viewManager);

  // 5. Load persisted projects
  await appState.loadPersistedProjects();
});
```

### Data Flow

```
┌─────────────┐     IPC invoke      ┌─────────────┐     direct call    ┌─────────────┐
│  Renderer   │ ──────────────────▶ │    Main     │ ─────────────────▶ │  Services   │
│  (Svelte)   │                     │  (handlers) │                    │  (Node.js)  │
│             │ ◀────────────────── │             │ ◀───────────────── │             │
└─────────────┘   IPC response/     └─────────────┘    return value/   └─────────────┘
                  events                               throw error

Handler Coordination (example: workspace:create):
┌─────────────────────────────────────────────────────────────────────┐
│  workspace:create handler                                           │
│    1. Validate payload with zod schema                              │
│    2. Call appState.getWorkspaceProvider(projectPath)               │
│    3. Call provider.createWorkspace(name, baseBranch)               │
│    4. Call viewManager.createWorkspaceView(path, url)               │
│    5. Call viewManager.setActiveWorkspace(path)                     │
│    6. Emit 'workspace:created' event to renderer                    │
│    7. Return Workspace                                              │
└─────────────────────────────────────────────────────────────────────┘
```

## IPC Contract

### Type-Safe Contract Definition

```typescript
// src/shared/ipc.ts

import { z } from "zod";

// ============ Branded Path Types ============

declare const ProjectPathBrand: unique symbol;
declare const WorkspacePathBrand: unique symbol;

export type ProjectPath = string & { readonly [ProjectPathBrand]: true };
export type WorkspacePath = string & { readonly [WorkspacePathBrand]: true };

// ============ Domain Types ============

// Re-export Workspace from services - do not redefine!
export type { Workspace, BaseInfo, RemovalResult, UpdateBasesResult } from "../services";
import type { Workspace, BaseInfo, RemovalResult, UpdateBasesResult } from "../services";

export interface Project {
  readonly path: ProjectPath;
  readonly name: string; // folder name
  readonly workspaces: readonly Workspace[];
}

// ============ Validation Schemas ============

// Path validation: absolute, no traversal, normalized
const absolutePathSchema = z
  .string()
  .refine((p) => path.isAbsolute(p) && !p.includes("..") && p === path.normalize(p), {
    message: 'Path must be absolute, normalized, and contain no ".." segments',
  });

export const ProjectOpenPayloadSchema = z.object({
  path: absolutePathSchema,
});

export const ProjectClosePayloadSchema = z.object({
  path: absolutePathSchema,
});

export const WorkspaceCreatePayloadSchema = z.object({
  projectPath: absolutePathSchema,
  name: z.string().min(1).max(100),
  baseBranch: z.string().min(1),
});

export const WorkspaceRemovePayloadSchema = z.object({
  workspacePath: absolutePathSchema,
  deleteBranch: z.boolean(),
});

export const WorkspaceSwitchPayloadSchema = z.object({
  workspacePath: absolutePathSchema,
});

export const WorkspaceListBasesPayloadSchema = z.object({
  projectPath: absolutePathSchema,
});

export const WorkspaceUpdateBasesPayloadSchema = z.object({
  projectPath: absolutePathSchema,
});

export const WorkspaceIsDirtyPayloadSchema = z.object({
  workspacePath: absolutePathSchema,
});

// ============ Inferred Payload Types ============

export type ProjectOpenPayload = z.infer<typeof ProjectOpenPayloadSchema>;
export type ProjectClosePayload = z.infer<typeof ProjectClosePayloadSchema>;
export type WorkspaceCreatePayload = z.infer<typeof WorkspaceCreatePayloadSchema>;
export type WorkspaceRemovePayload = z.infer<typeof WorkspaceRemovePayloadSchema>;
export type WorkspaceSwitchPayload = z.infer<typeof WorkspaceSwitchPayloadSchema>;
export type WorkspaceListBasesPayload = z.infer<typeof WorkspaceListBasesPayloadSchema>;
export type WorkspaceUpdateBasesPayload = z.infer<typeof WorkspaceUpdateBasesPayloadSchema>;
export type WorkspaceIsDirtyPayload = z.infer<typeof WorkspaceIsDirtyPayloadSchema>;

// ============ Event Payload Types ============

export interface ProjectOpenedEvent {
  readonly project: Project;
}

export interface ProjectClosedEvent {
  readonly path: ProjectPath;
}

export interface WorkspaceCreatedEvent {
  readonly projectPath: ProjectPath;
  readonly workspace: Workspace;
}

export interface WorkspaceRemovedEvent {
  readonly projectPath: ProjectPath;
  readonly workspacePath: WorkspacePath;
}

export interface WorkspaceSwitchedEvent {
  readonly workspacePath: WorkspacePath;
}

// ============ Type-Safe IPC Contract ============

export interface IpcCommands {
  "project:open": { payload: ProjectOpenPayload; response: Project };
  "project:close": { payload: ProjectClosePayload; response: void };
  "project:list": { payload: void; response: Project[] };
  "project:select-folder": { payload: void; response: string | null };
  "workspace:create": { payload: WorkspaceCreatePayload; response: Workspace };
  "workspace:remove": { payload: WorkspaceRemovePayload; response: RemovalResult };
  "workspace:switch": { payload: WorkspaceSwitchPayload; response: void };
  "workspace:list-bases": { payload: WorkspaceListBasesPayload; response: BaseInfo[] };
  "workspace:update-bases": { payload: WorkspaceUpdateBasesPayload; response: UpdateBasesResult };
  "workspace:is-dirty": { payload: WorkspaceIsDirtyPayload; response: boolean };
}

export interface IpcEvents {
  "project:opened": ProjectOpenedEvent;
  "project:closed": ProjectClosedEvent;
  "workspace:created": WorkspaceCreatedEvent;
  "workspace:removed": WorkspaceRemovedEvent;
  "workspace:switched": WorkspaceSwitchedEvent;
}

// ============ IPC Channel Names ============

export const IpcChannels = {
  // Commands
  PROJECT_OPEN: "project:open",
  PROJECT_CLOSE: "project:close",
  PROJECT_LIST: "project:list",
  PROJECT_SELECT_FOLDER: "project:select-folder",
  WORKSPACE_CREATE: "workspace:create",
  WORKSPACE_REMOVE: "workspace:remove",
  WORKSPACE_SWITCH: "workspace:switch",
  WORKSPACE_LIST_BASES: "workspace:list-bases",
  WORKSPACE_UPDATE_BASES: "workspace:update-bases",
  WORKSPACE_IS_DIRTY: "workspace:is-dirty",
  // Events
  PROJECT_OPENED: "project:opened",
  PROJECT_CLOSED: "project:closed",
  WORKSPACE_CREATED: "workspace:created",
  WORKSPACE_REMOVED: "workspace:removed",
  WORKSPACE_SWITCHED: "workspace:switched",
} as const satisfies Record<string, string>;
```

### Commands (Renderer → Main)

| Channel                  | Payload                             | Response            | Description                                     |
| ------------------------ | ----------------------------------- | ------------------- | ----------------------------------------------- |
| `project:open`           | `{ path: string }`                  | `Project`           | Open project, discover workspaces, create views |
| `project:close`          | `{ path: string }`                  | `void`              | Close project, destroy views                    |
| `project:list`           | `void`                              | `Project[]`         | List all open projects                          |
| `project:select-folder`  | `void`                              | `string \| null`    | Show folder picker dialog                       |
| `workspace:create`       | `{ projectPath, name, baseBranch }` | `Workspace`         | Create workspace, create view                   |
| `workspace:remove`       | `{ workspacePath, deleteBranch }`   | `RemovalResult`     | Remove workspace, destroy view                  |
| `workspace:switch`       | `{ workspacePath }`                 | `void`              | Switch active workspace                         |
| `workspace:list-bases`   | `{ projectPath }`                   | `BaseInfo[]`        | List available branches                         |
| `workspace:update-bases` | `{ projectPath }`                   | `UpdateBasesResult` | Fetch from remotes                              |
| `workspace:is-dirty`     | `{ workspacePath }`                 | `boolean`           | Check for uncommitted changes                   |

### Events (Main → Renderer)

| Channel              | Payload                  | Description              |
| -------------------- | ------------------------ | ------------------------ |
| `project:opened`     | `ProjectOpenedEvent`     | Project was opened       |
| `project:closed`     | `ProjectClosedEvent`     | Project was closed       |
| `workspace:created`  | `WorkspaceCreatedEvent`  | Workspace was created    |
| `workspace:removed`  | `WorkspaceRemovedEvent`  | Workspace was removed    |
| `workspace:switched` | `WorkspaceSwitchedEvent` | Active workspace changed |

### Error Handling

All commands use `ipcMain.handle()` which returns a rejected Promise on error.

```typescript
// Error response format (serialized via ServiceError.toJSON())
interface IpcErrorResponse {
  readonly type: "git" | "workspace" | "code-server" | "project-store" | "validation" | "unknown";
  readonly message: string;
  readonly code?: string;
}

// Handler wrapper catches errors and serializes them:
// - ServiceError subclasses: serialized via toJSON()
// - ZodError (validation): wrapped as { type: 'validation', message: formatted errors }
// - Other errors: wrapped as { type: 'unknown', message: error.message }
// - In production, stack traces are NOT included
```

### ElectronAPI Type Definition

```typescript
// src/shared/electron-api.d.ts

import type {
  IpcCommands,
  IpcEvents,
  Project,
  Workspace,
  BaseInfo,
  RemovalResult,
  UpdateBasesResult,
  ProjectOpenedEvent,
  ProjectClosedEvent,
  WorkspaceCreatedEvent,
  WorkspaceRemovedEvent,
  WorkspaceSwitchedEvent,
} from "./ipc";

type Unsubscribe = () => void;

export interface ElectronAPI {
  // Type-safe invoke for commands
  invoke<K extends keyof IpcCommands>(
    channel: K,
    payload: IpcCommands[K]["payload"]
  ): Promise<IpcCommands[K]["response"]>;

  // Event subscriptions with cleanup
  onProjectOpened(callback: (event: ProjectOpenedEvent) => void): Unsubscribe;
  onProjectClosed(callback: (event: ProjectClosedEvent) => void): Unsubscribe;
  onWorkspaceCreated(callback: (event: WorkspaceCreatedEvent) => void): Unsubscribe;
  onWorkspaceRemoved(callback: (event: WorkspaceRemovedEvent) => void): Unsubscribe;
  onWorkspaceSwitched(callback: (event: WorkspaceSwitchedEvent) => void): Unsubscribe;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
```

## Implementation Steps

**TDD Workflow**: For each step, follow: (1) Write failing tests, (2) Implement feature, (3) Verify tests pass.

### Step 0: Shared Types and IPC Contract

- [x] **0.1: Install zod dependency**
  - Run: `pnpm add zod`
  - Files: `package.json` (auto-updated)
  - Test criteria: Dependency installed

- [x] **0.2: Define IPC contract with type-safe mapping**
  - Implement full contract as shown in "Type-Safe Contract Definition" section
  - Define branded path types, zod schemas, payload types, event types
  - Define `IpcCommands` and `IpcEvents` mapped types
  - Re-export `Workspace` from services (do NOT redefine)
  - Files: `src/shared/ipc.ts`
  - Test criteria: Types compile, strict mode passes, schemas validate correctly

- [x] **0.3: Define ElectronAPI type**
  - Implement as shown in "ElectronAPI Type Definition" section
  - Type-safe `invoke<K>` method
  - Event subscription methods with `Unsubscribe` return type
  - Files: `src/shared/electron-api.d.ts`
  - Test criteria: Types compile, matches IPC contract

### Step 1: Utility Modules

- [x] **1.1: External URL opener with scheme validation**
  - Write unit tests first
  - `openExternal(url: string): void` - cross-platform URL opening
  - **Security**: Validate URL scheme against allowlist before opening:
    ```typescript
    const ALLOWED_SCHEMES = ["http:", "https:", "mailto:"];
    ```
  - Throw error for blocked schemes (`file://`, `javascript:`, etc.)
  - Linux: gdbus portal → xdg-open fallback → log error if all fail
  - macOS: `open` command
  - Windows: `start` command
  - Fire-and-forget: don't throw if external open fails, only log
  - Files: `src/main/utils/external-url.ts`, `src/main/utils/external-url.test.ts`
  - Test criteria: Correct command per platform, blocked schemes rejected, fallback chain works
  - Error tests: `it("throws for file:// scheme")`, `it("throws for javascript: scheme")`, `it("logs error when all Linux openers fail")`

### Step 2: Window Manager

- [x] **2.1: WindowManager class**
  - Write unit tests first (mock Electron APIs at module level)
  - `WindowManager.create(): WindowManager` - factory method
  - `getWindow(): BaseWindow` - get the main window
  - `getBounds(): { width: number; height: number }` - content bounds
  - `onResize(callback): Unsubscribe` - resize event subscription with cleanup
  - `close(): void` - close window
  - Configuration: min size 800x600, title "CodeHydra", no application menu
  - Files: `src/main/managers/window-manager.ts`, `src/main/managers/window-manager.test.ts`
  - Test criteria: Window created with correct config, resize events propagate, cleanup works

### Step 3: View Manager

- [x] **3.1: IViewManager interface**
  - Define interface for testability (allows mocking in handler tests)
  - Files: `src/main/managers/view-manager.interface.ts`
  - Test criteria: Interface compiles

- [x] **3.2: ViewManager class - UI layer management**
  - Write unit tests first (mock Electron APIs at module level)
  - `ViewManager.create(windowManager, config): ViewManager`
  - Creates UI layer WebContentsView with:
    - **SECURITY CRITICAL** webPreferences:
      ```typescript
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: uiPreloadPath,
      }
      ```
    - Transparent background (`#00000000`)
    - Loads renderer index.html
    - CSP header for defense-in-depth (optional enhancement)
  - `getUIView(): WebContentsView`
  - Files: `src/main/managers/view-manager.ts`, `src/main/managers/view-manager.test.ts`
  - Test criteria: UI view created with correct security settings

- [x] **3.3: ViewManager - workspace view lifecycle**
  - Write unit tests first
  - `createWorkspaceView(workspacePath: string, url: string): WebContentsView`
    - **SECURITY CRITICAL** webPreferences (same as UI layer):
      ```typescript
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: webviewPreloadPath,
      }
      ```
    - Loads code-server URL
    - Configure `setWindowOpenHandler`: call `openExternal(url)`, return `{ action: 'deny' }`
    - Configure `will-navigate`: prevent navigation away from code-server URL
    - Configure permission handler: allow clipboard, deny geolocation/camera/etc.
    - Adds to window (workspace views in front of UI layer)
  - `destroyWorkspaceView(workspacePath: string): void`
    - Remove view from window via `contentView.removeChildView(view)`
    - Close webContents via `view.webContents.close()` (NOT destroy())
    - Remove from internal Map
  - `getWorkspaceView(workspacePath: string): WebContentsView | undefined`
  - Internal storage: `Map<string, WebContentsView>` keyed by workspace path
  - Files: `src/main/managers/view-manager.ts`
  - Test criteria: Views created with security settings, external URLs handled, cleanup correct
  - Error tests: `it("prevents navigation away from code-server URL")`

- [x] **3.4: ViewManager - bounds and visibility**
  - Write unit tests first
  - `SIDEBAR_WIDTH = 250` constant defined in view-manager.ts
  - `updateBounds(): void` - recalculate all view bounds on resize
  - UI layer: sidebar width only `{ x: 0, y: 0, width: SIDEBAR_WIDTH, height }`
  - Active workspace: content area `{ x: SIDEBAR_WIDTH, y: 0, width: w - SIDEBAR_WIDTH, height }`
  - Inactive workspaces: zero bounds `{ x: 0, y: 0, width: 0, height: 0 }`
  - `setActiveWorkspace(workspacePath: string | null): void`
  - Clamp bounds at minimum window size (800x600)
  - Files: `src/main/managers/view-manager.ts`
  - Test criteria: Bounds calculated correctly, visibility toggled, handles minimum size
  - Edge case tests: `it("clamps bounds at minimum window size")`, `it("handles null active workspace")`

- [x] **3.5: ViewManager - focus management**
  - Write unit tests first
  - `focusActiveWorkspace(): void` - focus the active workspace view
  - `focusUI(): void` - focus the UI layer
  - Files: `src/main/managers/view-manager.ts`
  - Test criteria: Correct view receives focus

### Step 4: Application State

- [x] **4.1: AppState class**
  - Write unit tests first (mock services)
  - Manages runtime state: open projects, workspace providers cache
  - Constructor: `AppState(projectStore, viewManager, codeServerPort)`
  - `openProject(path: string): Promise<Project>`
    - Validate path is git repository via GitWorktreeProvider.create()
    - Cache provider in `Map<string, IWorkspaceProvider>`
    - Discover workspaces (excluding main directory)
    - **Create WebContentsView for each discovered workspace**
    - Set first workspace as active (or null if none)
    - Persist via ProjectStore.saveProject()
    - Return Project object
  - `closeProject(path: string): void` - cleanup providers, destroy all workspace views
  - `getProject(path: string): Project | undefined`
  - `getAllProjects(): Project[]`
  - `getWorkspaceProvider(projectPath: string): IWorkspaceProvider | undefined`
  - `getWorkspaceUrl(workspacePath: string): string` - generate code-server URL
  - `loadPersistedProjects(): Promise<void>` - called at startup
  - Files: `src/main/app-state.ts`, `src/main/app-state.test.ts`
  - Test criteria: State management correct, providers cached, views created on open
  - Error tests: `it("throws WorkspaceError for non-git directory")`, `it("handles project with zero workspaces")`

### Step 5: IPC Handlers

- [x] **5.1: Validation utilities**
  - Create zod validation wrapper that throws standardized errors
  - Files: `src/main/ipc/validation.ts`
  - Test criteria: Validation errors formatted correctly

- [x] **5.2: Type-safe handler registration**
  - Write unit tests first
  - Define typed handler type:
    ```typescript
    type IpcHandler<K extends keyof IpcCommands> = (
      event: IpcMainInvokeEvent,
      payload: IpcCommands[K]["payload"]
    ) => Promise<IpcCommands[K]["response"]>;
    ```
  - `registerHandler<K>(channel: K, schema: ZodSchema, handler: IpcHandler<K>): void`
    - Wraps handler with: validation → execution → error serialization
  - `registerAllHandlers(appState, viewManager): void`
  - Files: `src/main/ipc/handlers.ts`, `src/main/ipc/handlers.test.ts`
  - Test criteria: All handlers registered, validation runs, errors serialized

- [x] **5.3: Project handlers**
  - Write unit tests first (mock AppState and ViewManager)
  - `project:open` - validate, open project, return Project
  - `project:close` - validate, close project, emit event
  - `project:list` - return all open projects
  - `project:select-folder` - show folder picker dialog, validate is git repo
  - Files: `src/main/ipc/project-handlers.ts`, `src/main/ipc/project-handlers.test.ts`
  - Test criteria: Handlers call correct services, workspace belongs to open project validated
  - Error tests: `it("returns serialized error for non-existent path")`, `it("returns serialized error for non-git repo")`, `it("wraps non-ServiceError in unknown type")`

- [x] **5.4: Workspace handlers**
  - Write unit tests first
  - **All handlers validate workspacePath belongs to an open project**
  - `workspace:create` - validate, create workspace, create view, set active, emit event
  - `workspace:remove` - validate, check not active (or switch first), remove workspace, destroy view, emit event
  - `workspace:switch` - validate, update active, update bounds, focus, emit event
  - `workspace:list-bases` - validate, return branches
  - `workspace:update-bases` - validate, fetch remotes
  - `workspace:is-dirty` - validate, check status
  - Files: `src/main/ipc/workspace-handlers.ts`, `src/main/ipc/workspace-handlers.test.ts`
  - Test criteria: Handlers validate ownership, call services, manage views, emit events
  - Error tests: `it("throws WORKSPACE_NOT_FOUND for unknown workspace")`, `it("throws for workspace from closed project")`

### Step 6: Preload Scripts

- [x] **6.1: UI layer preload**
  - Expand existing `src/preload/index.ts`
  - Expose type-safe API via contextBridge:

    ```typescript
    contextBridge.exposeInMainWorld("electronAPI", {
      invoke: <K extends keyof IpcCommands>(channel: K, payload: IpcCommands[K]["payload"]) =>
        ipcRenderer.invoke(channel, payload),

      onProjectOpened: (callback) => {
        const handler = (_event: IpcRendererEvent, data: ProjectOpenedEvent) => callback(data);
        ipcRenderer.on(IpcChannels.PROJECT_OPENED, handler);
        return () => ipcRenderer.removeListener(IpcChannels.PROJECT_OPENED, handler);
      },
      // ... other event subscriptions with same cleanup pattern
    });
    ```

  - Files: `src/preload/index.ts`
  - Test criteria: All methods exposed, cleanup functions work, types match ElectronAPI

- [x] **6.2: Webview preload**
  - Create `src/preload/webview-preload.ts`
  - **SECURITY**: This script MUST NOT use `contextBridge.exposeInMainWorld()`
  - Only functionality: Alt keyup suppression (capture phase) to prevent VS Code menu activation
    ```typescript
    window.addEventListener(
      "keyup",
      (e) => {
        if (e.key === "Alt") {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
      },
      true
    ); // Capture phase
    ```
  - NOTE: Full keyboard capture (Alt+X mode) is Phase 5 scope
  - NOTE: URL interception happens in main process via `setWindowOpenHandler`, not here
  - Files: `src/preload/webview-preload.ts`
  - Test criteria: Alt keyup suppressed, no API exposed

### Step 7: Main Process Entry Point

- [x] **7.1: App lifecycle and startup sequence**
  - Refactor `src/main/index.ts`
  - Startup sequence:
    1. Disable application menu
    2. Create CodeServerManager, call `ensureRunning()` (may take seconds)
    3. If code-server fails after retries: show `dialog.showErrorBox()`, app remains open but degraded
    4. Create WindowManager
    5. Create ViewManager with preload paths and code-server port
    6. Create ProjectStore and AppState
    7. Register IPC handlers
    8. Call `appState.loadPersistedProjects()` which opens each project and creates views
    9. If projects loaded: set first workspace of first project as active
    10. If no projects: show empty state (UI layer only)
  - Handle app events (ready, activate, window-all-closed)
  - Files: `src/main/index.ts`
  - Test criteria: App starts, code-server running, components initialized, projects loaded

- [x] **7.2: Graceful shutdown**
  - Stop code-server on quit via CodeServerManager.stop()
  - Destroy all workspace views
  - Clean up any temporary resources
  - Files: `src/main/index.ts`
  - Test criteria: Clean shutdown, no orphaned processes
  - Tests: `it("destroys all views when window closes")`, `it("stops code-server on quit")`

### Step 8: Integration Testing

- [x] **8.1: IPC integration tests**
  - Uses mocked Electron APIs but real services with temp git repos
  - Concrete test cases:
    - `it("open project → discovers workspaces → lists them via IPC")`
    - `it("create workspace → view created → can switch to it")`
    - `it("switch workspace → previous view hidden → new view shown")`
    - `it("remove workspace → view destroyed → switches to another")`
    - `it("close project → all workspace views destroyed")`
    - `it("handles project with zero workspaces gracefully")`
    - `it("handles rapid workspace switching without race conditions")`
    - `it("validates paths reject traversal attacks")`
  - Files: `src/main/ipc/handlers.integration.test.ts`
  - Test criteria: All workflow tests pass

## Testing Strategy

### Test Environment

All `src/main/**/*.test.ts` files MUST include at top:

```typescript
// @vitest-environment node
```

Mock Electron at module level (NOT inside functions - vi.mock is hoisted):

```typescript
// src/main/test-utils.ts

import { vi, type MockedFunction } from "vitest";
import type { BaseWindow, WebContentsView, Rectangle } from "electron";

// Type-safe mock factories
export function createMockBaseWindow(): {
  getBounds: MockedFunction<() => Rectangle>;
  on: MockedFunction<(event: string, callback: () => void) => void>;
  close: MockedFunction<() => void>;
  contentView: {
    addChildView: MockedFunction<(view: WebContentsView) => void>;
    removeChildView: MockedFunction<(view: WebContentsView) => void>;
  };
} {
  return {
    getBounds: vi.fn(() => ({ width: 1200, height: 800, x: 0, y: 0 })),
    on: vi.fn(),
    close: vi.fn(),
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
  };
}

export function createMockWebContentsView(): {
  setBounds: MockedFunction<(bounds: Rectangle) => void>;
  setBackgroundColor: MockedFunction<(color: string) => void>;
  webContents: {
    loadFile: MockedFunction<(path: string) => Promise<void>>;
    loadURL: MockedFunction<(url: string) => Promise<void>>;
    focus: MockedFunction<() => void>;
    send: MockedFunction<(channel: string, ...args: unknown[]) => void>;
    setWindowOpenHandler: MockedFunction<(handler: unknown) => void>;
    on: MockedFunction<(event: string, handler: unknown) => void>;
    close: MockedFunction<() => void>;
    session: {
      setPermissionRequestHandler: MockedFunction<(handler: unknown) => void>;
    };
  };
} {
  return {
    setBounds: vi.fn(),
    setBackgroundColor: vi.fn(),
    webContents: {
      loadFile: vi.fn(() => Promise.resolve()),
      loadURL: vi.fn(() => Promise.resolve()),
      focus: vi.fn(),
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      close: vi.fn(),
      session: {
        setPermissionRequestHandler: vi.fn(),
      },
    },
  };
}

// Reset all mocks between tests
export function resetMocks(...mocks: { [key: string]: MockedFunction<unknown> }[]): void {
  mocks.forEach((mock) => {
    Object.values(mock).forEach((fn) => {
      if (typeof fn === "function" && "mockClear" in fn) {
        fn.mockClear();
      }
    });
  });
}
```

Module-level mock (in each test file):

```typescript
// At top of test file, BEFORE imports
vi.mock("electron", () => ({
  app: {
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    isPackaged: false,
    quit: vi.fn(),
  },
  BaseWindow: vi.fn(() => createMockBaseWindow()),
  WebContentsView: vi.fn(() => createMockWebContentsView()),
  Menu: { setApplicationMenu: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showErrorBox: vi.fn() },
}));
```

### Unit Tests

| Test File                         | What to Mock          | What to Test                                            |
| --------------------------------- | --------------------- | ------------------------------------------------------- |
| `utils/external-url.test.ts`      | `child_process.exec`  | Command per platform, scheme validation, fallback chain |
| `managers/window-manager.test.ts` | `electron` module     | Window creation, resize, cleanup                        |
| `managers/view-manager.test.ts`   | `electron` module     | View lifecycle, bounds, z-order, security settings      |
| `app-state.test.ts`               | Services, ViewManager | State management, provider caching, URL generation      |
| `ipc/validation.test.ts`          | None                  | Zod schema validation, error formatting                 |
| `ipc/project-handlers.test.ts`    | AppState, ViewManager | Handler logic, path validation, error serialization     |
| `ipc/workspace-handlers.test.ts`  | AppState, ViewManager | Handler logic, ownership validation, events             |

### Integration Tests

| Test File                          | Uses Real                  | Tests                                     |
| ---------------------------------- | -------------------------- | ----------------------------------------- |
| `ipc/handlers.integration.test.ts` | Git (temp repos), Services | Full IPC workflows, concurrent operations |

### Manual Testing Checklist

**Phase 3 Testable (via DevTools console):**

- [ ] App starts without errors
- [ ] Code-server process starts on app launch (check process list)
- [ ] `window.electronAPI.invoke('project:open', { path: '/path/to/repo' })` works
- [ ] `window.electronAPI.invoke('project:list', undefined)` returns projects
- [ ] Workspace views load code-server (visible in DevTools Network tab)
- [ ] External URLs from code-server open in system browser
- [ ] Window resize updates view bounds correctly
- [ ] App closes cleanly (check no orphaned code-server process)

**Deferred to Phase 4 (requires UI):**

- [ ] Open Project button works (folder picker appears)
- [ ] Project appears in sidebar after opening
- [ ] Workspaces displayed in sidebar
- [ ] Workspace click switches views
- [ ] Close project removes it from sidebar

## Dependencies

| Package | Purpose                | Approved |
| ------- | ---------------------- | -------- |
| zod     | IPC payload validation | [x]      |

**Install command**: `pnpm add zod`

All other packages already installed:

- `electron` - already in devDependencies
- `simple-git`, `execa` - already in dependencies (Phase 2)

## Documentation Updates

### Files to Update

| File                   | Changes Required                                 |
| ---------------------- | ------------------------------------------------ |
| `docs/ARCHITECTURE.md` | Fill in IPC Contract section with final contract |
| `AGENTS.md`            | Add main process directory structure             |

### New Documentation Required

None - API documentation is in TypeScript types.

## Definition of Done

- [ ] All implementation steps complete (TDD: tests written before implementation)
- [ ] `pnpm validate:fix` passes (0 errors, 0 warnings, all tests green)
- [ ] IPC contract fully typed with compile-time enforcement
- [ ] All IPC payloads validated with zod schemas
- [ ] Security settings explicit on all WebContentsViews
- [ ] View management works (create, destroy, switch, bounds)
- [ ] Code-server starts on app startup
- [ ] Projects persist across restarts
- [ ] External URLs validated and open in system browser
- [ ] Clean shutdown (no orphaned processes)
- [ ] Documentation updated

---

## Appendix: Key Design Decisions

### Why Type-Safe IPC Contract?

The `IpcCommands` and `IpcEvents` mapped types provide:

1. Compile-time enforcement of correct payload/response types per channel
2. Single source of truth for the contract
3. Auto-completion and type checking in both main and renderer

### Why Zod for Validation?

1. Runtime validation catches malicious payloads from compromised renderer
2. Type inference from schemas reduces duplication
3. Clear error messages for debugging
4. Path traversal attacks prevented by schema rules

### Why Branded Path Types?

`ProjectPath` and `WorkspacePath` branded types:

1. Prevent accidentally passing wrong path type
2. Document intent at type level
3. Enable path-specific validation

### Why Single CodeServerManager?

All workspaces share one code-server instance because:

1. Code-server supports multiple folders via URL parameter
2. Reduces resource usage (one Node.js process instead of many)
3. Faster workspace switching (no startup delay)

**Known Limitation**: All workspaces share the same origin (`localhost:PORT`), so localStorage/cookies are shared. This is acceptable for our use case since all workspaces belong to the same user.

### Why Start Code-Server on App Startup?

Starting code-server immediately (not lazily) because:

1. Better UX - no delay when opening the first workspace
2. Simpler state management - always running or app is shutting down
3. Health check happens during app startup, not during user action

### Why Bounds-Based Visibility?

Setting inactive views to zero bounds (0,0,0,0) instead of hiding them:

1. Preserves VS Code state (editors, terminals, extensions)
2. Instant switching (no reload needed)
3. WebContentsView doesn't have a `visible` property - bounds is the mechanism

### Why UI Layer Behind Workspace Views?

In normal mode, the UI layer only covers the sidebar area and sits behind workspace views:

1. Workspace views can receive input without UI layer interference
2. UI layer transparency isn't needed in sidebar-only mode
3. Simplifies focus management

In overlay mode (Phase 5), UI layer will be brought to front and cover full window.

### Preload Script Separation

Two preload scripts for different purposes:

1. **preload/index.ts** (UI layer): Full IPC API for Svelte components
2. **preload/webview-preload.ts** (code-server): NO API exposed - only Alt keyup suppression

This separation is a **security boundary**. Code-server views load potentially untrusted content (extensions, extension webviews). They must have minimal privileges.

### Error Serialization Strategy

IPC errors are serialized for safe transport:

1. Handler catches any error
2. ServiceError subclasses: serialized via `toJSON()` → `{ type, message, code }`
3. ZodError: wrapped as `{ type: 'validation', message: formatted }`
4. Other errors: wrapped as `{ type: 'unknown', message }`
5. Production builds: stack traces NOT included (security)
