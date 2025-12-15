// @vitest-environment node
/**
 * Integration tests for GitWorktreeProvider.
 * These tests use real git repositories to verify the implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GitWorktreeProvider } from "./git-worktree-provider";
import { SimpleGitClient } from "./simple-git-client";
import { createTestGitRepo, createTempDir } from "../test-utils";
import { DefaultFileSystemLayer } from "../platform/filesystem";
import { simpleGit } from "simple-git";
import path from "path";

describe("GitWorktreeProvider integration", () => {
  let repoPath: string;
  let workspacesDir: string;
  let cleanup: () => Promise<void>;
  let cleanupWorkspacesDir: () => Promise<void>;
  let gitClient: SimpleGitClient;
  let fs: DefaultFileSystemLayer;

  beforeEach(async () => {
    const repo = await createTestGitRepo();
    repoPath = repo.path;
    cleanup = repo.cleanup;

    const wsDir = await createTempDir();
    workspacesDir = wsDir.path;
    cleanupWorkspacesDir = wsDir.cleanup;

    gitClient = new SimpleGitClient();
    fs = new DefaultFileSystemLayer();
  });

  afterEach(async () => {
    await cleanup();
    await cleanupWorkspacesDir();
  });

  describe("metadata.base persistence", () => {
    it("creates workspace with metadata.base and retrieves via discover()", async () => {
      const provider = await GitWorktreeProvider.create(repoPath, gitClient, workspacesDir, fs);

      // Create workspace with base branch "main"
      const created = await provider.createWorkspace("feature-x", "main");
      expect(created.metadata.base).toBe("main");

      // Discover should return same metadata.base
      const discovered = await provider.discover();
      expect(discovered).toHaveLength(1);
      expect(discovered[0]?.metadata.base).toBe("main");
    });

    it("metadata.base survives provider instance recreation", async () => {
      // Create with first provider instance
      const provider1 = await GitWorktreeProvider.create(repoPath, gitClient, workspacesDir, fs);
      await provider1.createWorkspace("feature-x", "main");

      // Create new provider instance and verify metadata.base persists
      const provider2 = await GitWorktreeProvider.create(repoPath, gitClient, workspacesDir, fs);
      const discovered = await provider2.discover();

      expect(discovered).toHaveLength(1);
      expect(discovered[0]?.metadata.base).toBe("main");
    });

    it("legacy workspace (no config) returns branch name as metadata.base", async () => {
      // Create a branch and worktree manually (no config set)
      const git = simpleGit(repoPath);
      await git.branch(["legacy-branch"]);
      const worktreePath = path.join(workspacesDir, "legacy-branch");
      await git.raw(["worktree", "add", worktreePath, "legacy-branch"]);

      // Discover should fall back to branch name
      const provider = await GitWorktreeProvider.create(repoPath, gitClient, workspacesDir, fs);
      const discovered = await provider.discover();

      expect(discovered).toHaveLength(1);
      expect(discovered[0]?.metadata.base).toBe("legacy-branch");
    });

    it("handles mixed state workspaces", async () => {
      const provider = await GitWorktreeProvider.create(repoPath, gitClient, workspacesDir, fs);

      // Create workspace with config
      await provider.createWorkspace("feature-with-config", "main");

      // Create legacy workspace manually (no config)
      const git = simpleGit(repoPath);
      await git.branch(["legacy-branch"]);
      const legacyPath = path.join(workspacesDir, "legacy-branch");
      await git.raw(["worktree", "add", legacyPath, "legacy-branch"]);

      // Discover should handle both correctly
      const discovered = await provider.discover();
      expect(discovered).toHaveLength(2);

      const featureWorkspace = discovered.find((w) => w.name === "feature-with-config");
      const legacyWorkspace = discovered.find((w) => w.name === "legacy-branch");

      expect(featureWorkspace?.metadata.base).toBe("main");
      expect(legacyWorkspace?.metadata.base).toBe("legacy-branch");
    });

    it("stores metadata.base in git config", async () => {
      const provider = await GitWorktreeProvider.create(repoPath, gitClient, workspacesDir, fs);
      await provider.createWorkspace("feature-x", "main");

      // Verify config was set using git command (codehydra.base is the namespaced key)
      const git = simpleGit(repoPath);
      const configValue = await git.raw(["config", "--get", "branch.feature-x.codehydra.base"]);
      expect(configValue.trim()).toBe("main");
    });
  });

  describe("metadata setMetadata/getMetadata", () => {
    it("setMetadata persists and getMetadata retrieves", async () => {
      const provider = await GitWorktreeProvider.create(repoPath, gitClient, workspacesDir, fs);
      const workspace = await provider.createWorkspace("feature-x", "main");

      await provider.setMetadata(workspace.path, "note", "WIP feature");

      const metadata = await provider.getMetadata(workspace.path);
      expect(metadata.note).toBe("WIP feature");
      expect(metadata.base).toBe("main");
    });

    it("metadata survives provider recreation", async () => {
      const provider1 = await GitWorktreeProvider.create(repoPath, gitClient, workspacesDir, fs);
      const workspace = await provider1.createWorkspace("feature-x", "main");
      await provider1.setMetadata(workspace.path, "note", "test note");

      const provider2 = await GitWorktreeProvider.create(repoPath, gitClient, workspacesDir, fs);
      const metadata = await provider2.getMetadata(workspace.path);

      expect(metadata.note).toBe("test note");
      expect(metadata.base).toBe("main");
    });

    it("base fallback applies in getMetadata for legacy workspace", async () => {
      // Create legacy workspace manually (no config set)
      const git = simpleGit(repoPath);
      await git.branch(["legacy-branch"]);
      const worktreePath = path.join(workspacesDir, "legacy-branch");
      await git.raw(["worktree", "add", worktreePath, "legacy-branch"]);

      const provider = await GitWorktreeProvider.create(repoPath, gitClient, workspacesDir, fs);
      const metadata = await provider.getMetadata(worktreePath);

      // Should fall back to branch name
      expect(metadata.base).toBe("legacy-branch");
    });

    it("invalid key format throws WorkspaceError with INVALID_METADATA_KEY code", async () => {
      const provider = await GitWorktreeProvider.create(repoPath, gitClient, workspacesDir, fs);
      const workspace = await provider.createWorkspace("feature-x", "main");

      const { WorkspaceError } = await import("../errors");
      try {
        await provider.setMetadata(workspace.path, "my_key", "value");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(WorkspaceError);
        expect((error as InstanceType<typeof WorkspaceError>).code).toBe("INVALID_METADATA_KEY");
      }
    });

    it("setMetadata with null deletes the key", async () => {
      const provider = await GitWorktreeProvider.create(repoPath, gitClient, workspacesDir, fs);
      const workspace = await provider.createWorkspace("feature-x", "main");

      await provider.setMetadata(workspace.path, "note", "test note");
      let metadata = await provider.getMetadata(workspace.path);
      expect(metadata.note).toBe("test note");

      await provider.setMetadata(workspace.path, "note", null);
      metadata = await provider.getMetadata(workspace.path);
      expect(metadata.note).toBeUndefined();
    });

    it("concurrent setMetadata calls for different keys both succeed", async () => {
      const provider = await GitWorktreeProvider.create(repoPath, gitClient, workspacesDir, fs);
      const workspace = await provider.createWorkspace("feature-x", "main");

      // Set multiple keys concurrently
      await Promise.all([
        provider.setMetadata(workspace.path, "note", "note value"),
        provider.setMetadata(workspace.path, "model", "claude-4"),
      ]);

      const metadata = await provider.getMetadata(workspace.path);
      expect(metadata.note).toBe("note value");
      expect(metadata.model).toBe("claude-4");
      expect(metadata.base).toBe("main");
    });
  });
});
