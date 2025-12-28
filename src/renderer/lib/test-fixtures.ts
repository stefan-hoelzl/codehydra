/**
 * Test fixtures for renderer tests.
 * Re-exports shared fixtures - uses the rich versions with workspace defaults.
 *
 * Uses v2 API types (Project with id, Workspace with projectId).
 */

// Re-export shared fixtures
export {
  createMockBaseInfo,
  createMockSetupProgress,
  DEFAULT_PROJECT_ID,
} from "@shared/test-fixtures";

// Use rich versions for renderer tests (with default workspace, etc.)
export {
  createRichMockProject as createMockProject,
  createRichMockWorkspace as createMockWorkspace,
} from "@shared/test-fixtures";

/**
 * Creates a mock ProjectWithId (alias for createMockProject).
 * @deprecated Use createMockProject instead - v2 Projects always have IDs.
 * @param overrides - Optional properties to override defaults
 */
export { createRichMockProject as createMockProjectWithId } from "@shared/test-fixtures";
