// @vitest-environment node
/**
 * Boundary tests for ProjectStore.
 * Tests filesystem operations against real filesystem with temp directories.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ProjectStore } from "./project-store";
import { projectDirName } from "../platform/paths";
import { createTempDir } from "../test-utils";
import { promises as fs } from "fs";
import path from "path";

describe("projectDirName", () => {
  it("generates name from folder name and hash", () => {
    const projectPath = "/home/user/projects/my-repo";

    const result = projectDirName(projectPath);

    expect(result).toMatch(/^my-repo-[a-f0-9]{8}$/);
  });

  it("generates deterministic name for same path", () => {
    const projectPath = "/home/user/projects/my-repo";

    const result1 = projectDirName(projectPath);
    const result2 = projectDirName(projectPath);

    expect(result1).toBe(result2);
  });

  it("generates different names for different paths", () => {
    const result1 = projectDirName("/home/user/projects/repo-a");
    const result2 = projectDirName("/home/user/projects/repo-b");

    expect(result1).not.toBe(result2);
  });

  it("handles unicode characters in path", () => {
    const projectPath = "/home/user/projects/my-repo";

    const result = projectDirName(projectPath);

    expect(result).toMatch(/^my-repo-[a-f0-9]{8}$/);
  });
});

describe("ProjectStore", () => {
  let store: ProjectStore;
  let tempDir: { path: string; cleanup: () => Promise<void> };
  let projectsDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectsDir = path.join(tempDir.path, "projects");
    store = new ProjectStore(projectsDir);
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  describe("saveProject", () => {
    it("creates config.json for new project", async () => {
      const projectPath = "/home/user/projects/my-repo";

      await store.saveProject(projectPath);

      const dirName = projectDirName(projectPath);
      const configPath = path.join(projectsDir, dirName, "config.json");
      const content = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(content);

      expect(config.version).toBe(1);
      expect(config.path).toBe(projectPath);
    });

    it("overwrites existing config", async () => {
      const projectPath = "/home/user/projects/my-repo";

      // Save once
      await store.saveProject(projectPath);

      // Save again (should not throw)
      await store.saveProject(projectPath);

      const dirName = projectDirName(projectPath);
      const configPath = path.join(projectsDir, dirName, "config.json");
      const content = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(content);

      expect(config.path).toBe(projectPath);
    });

    it("creates multiple projects", async () => {
      const projectPath1 = "/home/user/projects/repo-a";
      const projectPath2 = "/home/user/projects/repo-b";

      await store.saveProject(projectPath1);
      await store.saveProject(projectPath2);

      const projects = await store.loadAllProjects();
      expect(projects).toHaveLength(2);
    });
  });

  describe("loadAllProjects", () => {
    it("returns empty array when projects dir does not exist", async () => {
      const nonExistentDir = path.join(tempDir.path, "non-existent");
      const emptyStore = new ProjectStore(nonExistentDir);

      const projects = await emptyStore.loadAllProjects();

      expect(projects).toEqual([]);
    });

    it("returns empty array when projects dir is empty", async () => {
      await fs.mkdir(projectsDir, { recursive: true });

      const projects = await store.loadAllProjects();

      expect(projects).toEqual([]);
    });

    it("loads saved projects", async () => {
      const projectPath = "/home/user/projects/my-repo";
      await store.saveProject(projectPath);

      const projects = await store.loadAllProjects();

      expect(projects).toContain(projectPath);
    });

    it("skips directories without config.json", async () => {
      // Create a directory without config.json
      const emptyDir = path.join(projectsDir, "empty-dir");
      await fs.mkdir(emptyDir, { recursive: true });

      const projectPath = "/home/user/projects/my-repo";
      await store.saveProject(projectPath);

      const projects = await store.loadAllProjects();

      expect(projects).toHaveLength(1);
      expect(projects).toContain(projectPath);
    });

    it("skips malformed JSON", async () => {
      // Create a malformed config.json
      const badDir = path.join(projectsDir, "bad-config");
      await fs.mkdir(badDir, { recursive: true });
      await fs.writeFile(path.join(badDir, "config.json"), "not json");

      const projectPath = "/home/user/projects/my-repo";
      await store.saveProject(projectPath);

      const projects = await store.loadAllProjects();

      expect(projects).toHaveLength(1);
      expect(projects).toContain(projectPath);
    });

    it("skips config.json missing path field", async () => {
      // Create a config.json without path
      const badDir = path.join(projectsDir, "missing-path");
      await fs.mkdir(badDir, { recursive: true });
      await fs.writeFile(path.join(badDir, "config.json"), JSON.stringify({ version: 1 }));

      const projectPath = "/home/user/projects/my-repo";
      await store.saveProject(projectPath);

      const projects = await store.loadAllProjects();

      expect(projects).toHaveLength(1);
      expect(projects).toContain(projectPath);
    });
  });

  describe("removeProject", () => {
    it("removes config.json", async () => {
      const projectPath = "/home/user/projects/my-repo";
      await store.saveProject(projectPath);

      await store.removeProject(projectPath);

      const projects = await store.loadAllProjects();
      expect(projects).not.toContain(projectPath);
    });

    it("does not throw if project was not saved", async () => {
      const projectPath = "/home/user/projects/non-existent";

      // Should not throw
      await expect(store.removeProject(projectPath)).resolves.not.toThrow();
    });

    it("removes empty directory after config removal", async () => {
      const projectPath = "/home/user/projects/my-repo";
      await store.saveProject(projectPath);

      await store.removeProject(projectPath);

      const dirName = projectDirName(projectPath);
      const dirPath = path.join(projectsDir, dirName);

      await expect(fs.access(dirPath)).rejects.toThrow();
    });

    it("preserves directory if it contains other files", async () => {
      const projectPath = "/home/user/projects/my-repo";
      await store.saveProject(projectPath);

      // Add another file to the directory
      const dirName = projectDirName(projectPath);
      const otherFile = path.join(projectsDir, dirName, "other.txt");
      await fs.writeFile(otherFile, "other content");

      await store.removeProject(projectPath);

      // Directory should still exist
      const dirPath = path.join(projectsDir, dirName);
      await expect(fs.access(dirPath)).resolves.not.toThrow();

      // config.json should be gone
      const configPath = path.join(dirPath, "config.json");
      await expect(fs.access(configPath)).rejects.toThrow();
    });
  });
});
