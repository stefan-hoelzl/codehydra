/**
 * Shared test fixtures for creating mock domain objects.
 * Used by both main process and renderer test utilities.
 *
 * Uses v2 API types (Project with id, Workspace with projectId).
 */

import type {
  Project,
  Workspace,
  BaseInfo,
  ProjectId,
  WorkspaceName,
  SetupProgress,
} from "./api/types";

/**
 * Default project ID used in test fixtures.
 */
export const DEFAULT_PROJECT_ID = "test-project-12345678" as ProjectId;

// =============================================================================
// Simple Mock Factories (backward-compatible with main process tests)
// =============================================================================

/**
 * Creates a mock Project with simple defaults.
 * For main process tests - empty workspaces array by default.
 * @param overrides - Optional properties to override defaults
 */
export function createMockProject(overrides: Partial<Project> = {}): Project {
  return {
    id: DEFAULT_PROJECT_ID,
    name: "test-project",
    path: "/test/path",
    workspaces: [],
    ...overrides,
  };
}

/**
 * Creates a mock Workspace with simple defaults.
 * For main process tests - simple default values.
 * @param overrides - Optional properties to override defaults
 */
export function createMockWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    projectId: DEFAULT_PROJECT_ID,
    name: "test-workspace" as WorkspaceName,
    branch: "main",
    metadata: { base: "main" },
    path: "/test/path/test-workspace",
    ...overrides,
  };
}

// =============================================================================
// Rich Mock Factories (for renderer tests with convenience features)
// =============================================================================

/**
 * Partial workspace override that accepts plain strings for convenience in tests.
 * branch can be explicitly set to null (detached HEAD state).
 */
type WorkspaceOverrides = Partial<Omit<Workspace, "name" | "projectId" | "branch" | "metadata">> & {
  name?: string;
  projectId?: ProjectId;
  branch?: string | null;
  metadata?: Record<string, string>;
};

/**
 * Creates a mock Workspace with rich defaults for renderer tests.
 * Includes auto-generated metadata based on branch.
 * @param overrides - Optional properties to override defaults (accepts plain strings for name)
 */
export function createRichMockWorkspace(overrides: WorkspaceOverrides = {}): Workspace {
  const branch = "branch" in overrides ? overrides.branch : "feature-1";
  return {
    projectId: overrides.projectId ?? DEFAULT_PROJECT_ID,
    path: overrides.path ?? "/test/project/.worktrees/feature-1",
    name: (overrides.name ?? "feature-1") as WorkspaceName,
    branch,
    metadata: { base: branch ?? "main", ...overrides.metadata },
  };
}

/**
 * Partial project override that accepts looser types for convenience in tests.
 */
type ProjectOverrides = Partial<Omit<Project, "workspaces">> & {
  workspaces?: WorkspaceOverrides[] | readonly Workspace[];
};

/**
 * Creates a mock Project with rich defaults for renderer tests.
 * Includes one default workspace unless overridden.
 * @param overrides - Optional properties to override defaults
 */
export function createRichMockProject(overrides: ProjectOverrides = {}): Project {
  const projectId = overrides.id ?? DEFAULT_PROJECT_ID;

  // Convert workspace overrides to Workspace objects
  let workspaces: readonly Workspace[];
  if (overrides.workspaces) {
    workspaces = overrides.workspaces.map((w) => {
      // Check if it's already a Workspace (has projectId as branded type)
      if ("projectId" in w && typeof w.projectId === "string" && w.projectId.includes("-")) {
        return w as Workspace;
      }
      // Otherwise treat as WorkspaceOverrides
      return createRichMockWorkspace({ ...w, projectId });
    });
  } else {
    workspaces = [createRichMockWorkspace({ projectId })];
  }

  return {
    id: projectId,
    path: overrides.path ?? "/test/project",
    name: overrides.name ?? "test-project",
    workspaces,
    ...(overrides.defaultBaseBranch !== undefined
      ? { defaultBaseBranch: overrides.defaultBaseBranch }
      : {}),
  };
}

// =============================================================================
// Other Mock Factories
// =============================================================================

/**
 * Creates a mock BaseInfo with sensible defaults.
 * @param overrides - Optional properties to override defaults
 */
export function createMockBaseInfo(overrides: Partial<BaseInfo> = {}): BaseInfo {
  return {
    name: "main",
    isRemote: false,
    ...overrides,
  };
}

/**
 * Creates a mock SetupProgress event.
 * @param step - The setup step name
 * @param message - The progress message
 */
export function createMockSetupProgress(
  step: SetupProgress["step"],
  message: string
): SetupProgress {
  return { step, message };
}
