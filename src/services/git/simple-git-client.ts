/**
 * SimpleGitClient implementation using the simple-git library.
 */

import simpleGit, { type SimpleGit, type SimpleGitOptions } from "simple-git";
import path from "path";
import { GitError } from "../errors";
import type { IGitClient } from "./git-client";
import type { BranchInfo, StatusResult, WorktreeInfo } from "./types";
import type { Logger } from "../logging";

/**
 * Implementation of IGitClient using the simple-git library.
 * Wraps simple-git calls and maps errors to GitError.
 */
export class SimpleGitClient implements IGitClient {
  constructor(private readonly logger: Logger) {}

  /**
   * Create a simple-git instance for a given path.
   */
  private getGit(basePath: string): SimpleGit {
    const options: Partial<SimpleGitOptions> = {
      baseDir: basePath,
      binary: "git",
      maxConcurrentProcesses: 6,
      trimmed: true,
    };
    return simpleGit(options);
  }

  /**
   * Wrap a simple-git operation and convert errors to GitError.
   * Logs errors at WARN level.
   */
  private async wrapGitOperation<T>(
    operation: () => Promise<T>,
    opName: string,
    repoPath: string,
    errorMessage: string
  ): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn("Git error", { op: opName, path: repoPath, error: errMsg });
      const message = error instanceof Error ? `${errorMessage}: ${error.message}` : errorMessage;
      throw new GitError(message);
    }
  }

  async isGitRepository(repoPath: string): Promise<boolean> {
    try {
      const git = this.getGit(repoPath);
      const result = await git.checkIsRepo();
      this.logger.debug("IsGitRepository", { path: repoPath, result });
      return result;
    } catch (error: unknown) {
      // If the path doesn't exist or is inaccessible, throw GitError
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn("Git error", { op: "isGitRepository", path: repoPath, error: errMsg });
      const message =
        error instanceof Error
          ? `Failed to check repository: ${error.message}`
          : "Failed to check repository";
      throw new GitError(message);
    }
  }

  async listWorktrees(repoPath: string): Promise<readonly WorktreeInfo[]> {
    const worktrees = await this.wrapGitOperation(
      async () => {
        const git = this.getGit(repoPath);

        // Get raw worktree list output
        const result = await git.raw(["worktree", "list", "--porcelain"]);

        const worktreesResult: WorktreeInfo[] = [];
        const entries = result.split("\n\n").filter((entry) => entry.trim());

        for (const entry of entries) {
          const lines = entry.split("\n");
          let worktreePath = "";
          let branch: string | null = null;
          let isMain = false;

          for (const line of lines) {
            if (line.startsWith("worktree ")) {
              // Normalize path for cross-platform consistency.
              // Git on Windows outputs forward slashes (C:/Users/...),
              // but Node.js path.normalize() converts to backslashes.
              worktreePath = path.normalize(line.substring("worktree ".length));
            } else if (line.startsWith("branch ")) {
              // Branch format is "refs/heads/branch-name"
              const ref = line.substring("branch ".length);
              branch = ref.replace("refs/heads/", "");
            } else if (line === "detached") {
              branch = null;
            } else if (line === "bare") {
              // Skip bare repository entries
              continue;
            }
          }

          // First worktree is the main one
          isMain = worktreesResult.length === 0;

          if (worktreePath) {
            const name = path.basename(worktreePath);
            worktreesResult.push({
              name,
              path: worktreePath,
              branch,
              isMain,
            });
          }
        }

        return worktreesResult;
      },
      "listWorktrees",
      repoPath,
      "Failed to list worktrees"
    );

    this.logger.debug("ListWorktrees", { path: repoPath, count: worktrees.length });
    return worktrees;
  }

  async addWorktree(repoPath: string, worktreePath: string, branch: string): Promise<void> {
    await this.wrapGitOperation(
      async () => {
        const git = this.getGit(repoPath);
        await git.raw(["worktree", "add", worktreePath, branch]);
      },
      "addWorktree",
      repoPath,
      `Failed to add worktree at ${worktreePath}`
    );
    this.logger.debug("AddWorktree", { path: worktreePath, branch });
  }

  async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    await this.wrapGitOperation(
      async () => {
        const git = this.getGit(repoPath);
        await git.raw(["worktree", "remove", worktreePath, "--force"]);
      },
      "removeWorktree",
      repoPath,
      `Failed to remove worktree at ${worktreePath}`
    );
    this.logger.debug("RemoveWorktree", { path: worktreePath });
  }

  async pruneWorktrees(repoPath: string): Promise<void> {
    return this.wrapGitOperation(
      async () => {
        const git = this.getGit(repoPath);
        await git.raw(["worktree", "prune"]);
      },
      "pruneWorktrees",
      repoPath,
      "Failed to prune worktrees"
    );
  }

  async listBranches(repoPath: string): Promise<readonly BranchInfo[]> {
    const branches = await this.wrapGitOperation(
      async () => {
        const git = this.getGit(repoPath);
        const summary = await git.branch(["-a"]);

        const branchesResult: BranchInfo[] = [];

        for (const branchName of Object.keys(summary.branches)) {
          const isRemote = branchName.startsWith("remotes/");

          // Clean up the name for remote branches
          let name = branchName;
          if (isRemote) {
            // Remove "remotes/" prefix and skip HEAD references
            name = branchName.replace("remotes/", "");
            if (name.endsWith("/HEAD")) {
              continue;
            }
          }

          branchesResult.push({
            name,
            isRemote,
          });
        }

        return branchesResult;
      },
      "listBranches",
      repoPath,
      "Failed to list branches"
    );

    const localCount = branches.filter((b) => !b.isRemote).length;
    const remoteCount = branches.filter((b) => b.isRemote).length;
    this.logger.debug("ListBranches", { path: repoPath, local: localCount, remote: remoteCount });
    return branches;
  }

  async createBranch(repoPath: string, name: string, startPoint: string): Promise<void> {
    return this.wrapGitOperation(
      async () => {
        const git = this.getGit(repoPath);
        await git.branch([name, startPoint]);
      },
      "createBranch",
      repoPath,
      `Failed to create branch ${name}`
    );
  }

  async deleteBranch(repoPath: string, name: string): Promise<void> {
    return this.wrapGitOperation(
      async () => {
        const git = this.getGit(repoPath);
        // Use -D to force delete (handles unmerged branches)
        await git.branch(["-d", name]);
      },
      "deleteBranch",
      repoPath,
      `Failed to delete branch ${name}`
    );
  }

  async getCurrentBranch(repoPath: string): Promise<string | null> {
    return this.wrapGitOperation(
      async () => {
        const git = this.getGit(repoPath);
        const result = await git.revparse(["--abbrev-ref", "HEAD"]);

        // "HEAD" is returned when in detached HEAD state
        if (result === "HEAD") {
          return null;
        }

        return result;
      },
      "getCurrentBranch",
      repoPath,
      "Failed to get current branch"
    );
  }

  async getStatus(repoPath: string): Promise<StatusResult> {
    const status = await this.wrapGitOperation(
      async () => {
        const git = this.getGit(repoPath);
        const gitStatus = await git.status();

        // Modified files that are not staged
        const modifiedCount = gitStatus.modified.length + gitStatus.deleted.length;
        // Staged files (created/added files that are staged)
        const stagedCount = gitStatus.staged.length;
        // Untracked files (not_added means not tracked by git)
        const untrackedCount = gitStatus.not_added.length;

        const isDirty = modifiedCount > 0 || stagedCount > 0 || untrackedCount > 0;

        return {
          isDirty,
          modifiedCount,
          stagedCount,
          untrackedCount,
        };
      },
      "getStatus",
      repoPath,
      "Failed to get status"
    );

    this.logger.debug("GetStatus", { path: repoPath, dirty: status.isDirty });
    return status;
  }

  async fetch(repoPath: string, remote?: string): Promise<void> {
    await this.wrapGitOperation(
      async () => {
        const git = this.getGit(repoPath);
        if (remote) {
          // Use array format to ensure remote is treated as remote name, not refspec
          await git.fetch([remote]);
        } else {
          await git.fetch();
        }
      },
      "fetch",
      repoPath,
      `Failed to fetch${remote ? ` from ${remote}` : ""}`
    );
    this.logger.debug("Fetch", { path: repoPath, remote: remote ?? "all" });
  }

  async listRemotes(repoPath: string): Promise<readonly string[]> {
    return this.wrapGitOperation(
      async () => {
        const git = this.getGit(repoPath);
        const remotes = await git.getRemotes();
        return remotes.map((r) => r.name);
      },
      "listRemotes",
      repoPath,
      "Failed to list remotes"
    );
  }

  async getBranchConfig(repoPath: string, branch: string, key: string): Promise<string | null> {
    // First, verify it's a git repository
    const isRepo = await this.isGitRepository(repoPath);
    if (!isRepo) {
      throw new GitError(`Not a git repository: ${repoPath}`);
    }

    try {
      const git = this.getGit(repoPath);
      const configKey = `branch.${branch}.${key}`;
      const value = await git.raw(["config", "--get", configKey]);
      return value.trim() || null;
    } catch (error: unknown) {
      // Exit code 1 means key not found - return null
      // Exit code 128 or other errors mean git error
      if (error instanceof Error && error.message.includes("exit code 1")) {
        return null;
      }
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn("Git error", { op: "getBranchConfig", path: repoPath, error: errMsg });
      const message =
        error instanceof Error
          ? `Failed to get branch config: ${error.message}`
          : "Failed to get branch config";
      throw new GitError(message);
    }
  }

  async setBranchConfig(
    repoPath: string,
    branch: string,
    key: string,
    value: string
  ): Promise<void> {
    return this.wrapGitOperation(
      async () => {
        const git = this.getGit(repoPath);
        const configKey = `branch.${branch}.${key}`;
        await git.raw(["config", configKey, value]);
      },
      "setBranchConfig",
      repoPath,
      `Failed to set branch config branch.${branch}.${key}`
    );
  }

  async getBranchConfigsByPrefix(
    repoPath: string,
    branch: string,
    prefix: string
  ): Promise<Readonly<Record<string, string>>> {
    // First, verify it's a git repository
    const isRepo = await this.isGitRepository(repoPath);
    if (!isRepo) {
      throw new GitError(`Not a git repository: ${repoPath}`);
    }

    try {
      const git = this.getGit(repoPath);
      // Pattern: branch.<branch>.<prefix>.*
      const pattern = `^branch\\.${branch}\\.${prefix}\\.`;
      const output = await git.raw(["config", "--get-regexp", pattern]);

      const result: Record<string, string> = {};

      // Parse output: each line is "key value" where value is everything after first space
      // Example: "branch.main.codehydra.base develop"
      for (const line of output.split("\n")) {
        if (!line.trim()) continue;

        // Find first space - everything before is key, everything after is value
        const spaceIndex = line.indexOf(" ");
        if (spaceIndex === -1) continue;

        const fullKey = line.substring(0, spaceIndex);
        const value = line.substring(spaceIndex + 1);

        // Extract the key after the prefix (branch.<branch>.<prefix>.<key>)
        const prefixPattern = `branch.${branch}.${prefix}.`;
        if (fullKey.startsWith(prefixPattern)) {
          const key = fullKey.substring(prefixPattern.length);
          result[key] = value;
        }
      }

      return result;
    } catch (error: unknown) {
      // Exit code 1 means no matching keys - return empty object
      if (error instanceof Error && error.message.includes("exit code 1")) {
        return {};
      }
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn("Git error", {
        op: "getBranchConfigsByPrefix",
        path: repoPath,
        error: errMsg,
      });
      const message =
        error instanceof Error
          ? `Failed to get branch configs: ${error.message}`
          : "Failed to get branch configs";
      throw new GitError(message);
    }
  }

  async unsetBranchConfig(repoPath: string, branch: string, key: string): Promise<void> {
    // First, verify it's a git repository
    const isRepo = await this.isGitRepository(repoPath);
    if (!isRepo) {
      throw new GitError(`Not a git repository: ${repoPath}`);
    }

    try {
      const git = this.getGit(repoPath);
      const configKey = `branch.${branch}.${key}`;
      await git.raw(["config", "--unset", configKey]);
    } catch (error: unknown) {
      // Exit code 5 means key doesn't exist - that's OK for unset
      if (error instanceof Error && error.message.includes("exit code 5")) {
        return;
      }
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn("Git error", { op: "unsetBranchConfig", path: repoPath, error: errMsg });
      const message =
        error instanceof Error
          ? `Failed to unset branch config: ${error.message}`
          : "Failed to unset branch config";
      throw new GitError(message);
    }
  }
}
