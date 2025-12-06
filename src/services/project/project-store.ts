/**
 * ProjectStore - Persists project configurations across sessions.
 */

import { promises as fs } from "fs";
import path from "path";
import type { ProjectConfig } from "./types";
import { CURRENT_PROJECT_VERSION } from "./types";
import { ProjectStoreError } from "../errors";
import { projectDirName } from "../platform/paths";

/**
 * Store for persisting project configurations.
 * Each project is stored in its own directory with a config.json file.
 */
export class ProjectStore {
  private readonly projectsDir: string;

  /**
   * Create a new ProjectStore.
   * @param projectsDir Directory to store project configurations
   */
  constructor(projectsDir: string) {
    this.projectsDir = projectsDir;
  }

  /**
   * Save a project configuration.
   * Creates or overwrites the config.json for the project.
   *
   * @param projectPath Absolute path to the project
   * @throws ProjectStoreError if save fails
   */
  async saveProject(projectPath: string): Promise<void> {
    const dirName = projectDirName(projectPath);
    const projectDir = path.join(this.projectsDir, dirName);
    const configPath = path.join(projectDir, "config.json");

    const config: ProjectConfig = {
      version: CURRENT_PROJECT_VERSION,
      path: projectPath,
    };

    try {
      // Ensure the directory exists
      await fs.mkdir(projectDir, { recursive: true });

      // Write the config file
      await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error saving project";
      throw new ProjectStoreError(`Failed to save project: ${message}`);
    }
  }

  /**
   * Load all saved projects.
   * Skips invalid entries (missing config.json, malformed JSON, etc.).
   *
   * @returns Array of project paths
   */
  async loadAllProjects(): Promise<readonly string[]> {
    // Check if projects directory exists
    try {
      await fs.access(this.projectsDir);
    } catch {
      return [];
    }

    const projects: string[] = [];

    try {
      const entries = await fs.readdir(this.projectsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const configPath = path.join(this.projectsDir, entry.name, "config.json");

        try {
          const content = await fs.readFile(configPath, "utf-8");
          const parsed: unknown = JSON.parse(content);

          if (
            typeof parsed === "object" &&
            parsed !== null &&
            "path" in parsed &&
            typeof (parsed as Record<string, unknown>).path === "string"
          ) {
            projects.push((parsed as { path: string }).path);
          }
        } catch {
          // Skip invalid entries
          continue;
        }
      }
    } catch {
      return [];
    }

    return projects;
  }

  /**
   * Remove a project configuration.
   * Removes config.json and the directory if empty.
   * Does not throw if project was not saved.
   *
   * @param projectPath Absolute path to the project
   */
  async removeProject(projectPath: string): Promise<void> {
    const dirName = projectDirName(projectPath);
    const projectDir = path.join(this.projectsDir, dirName);
    const configPath = path.join(projectDir, "config.json");

    try {
      // Remove config.json
      await fs.unlink(configPath);
    } catch {
      // Ignore if file doesn't exist
      return;
    }

    // Try to remove the directory if empty
    try {
      await fs.rmdir(projectDir);
    } catch {
      // Directory not empty or doesn't exist - that's fine
    }
  }
}
