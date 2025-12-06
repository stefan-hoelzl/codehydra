/**
 * Project-related type definitions.
 * All properties are readonly for immutability.
 */

/**
 * Configuration stored for a project.
 * Version field allows for future migrations.
 */
export interface ProjectConfig {
  /** Schema version for migrations */
  readonly version: number;
  /** Absolute path to the project directory */
  readonly path: string;
}

/**
 * Current schema version for ProjectConfig.
 */
export const CURRENT_PROJECT_VERSION = 1;
