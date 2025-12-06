/**
 * Test utilities for service tests.
 * These helpers create temporary directories and git repositories
 * with automatic cleanup.
 */

import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { simpleGit } from "simple-git";

/**
 * Create a temporary directory with automatic cleanup.
 * @returns Object with path and cleanup function
 */
export async function createTempDir(): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  const path = await mkdtemp(join(tmpdir(), "codehydra-test-"));
  return {
    path,
    cleanup: async () => {
      await rm(path, { recursive: true, force: true });
    },
  };
}

export interface CreateTestGitRepoOptions {
  /** Create these worktrees (branch names) */
  worktrees?: string[];
  /** Add uncommitted changes to working directory */
  dirty?: boolean;
  /** Detach HEAD */
  detached?: boolean;
}

/**
 * Create a git repository for testing with optional configuration.
 * @param options Repository configuration
 * @returns Object with path and cleanup function
 */
export async function createTestGitRepo(options: CreateTestGitRepoOptions = {}): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  const { path, cleanup } = await createTempDir();

  const git = simpleGit(path);

  // Initialize repository
  await git.init();
  await git.addConfig("user.email", "test@test.com");
  await git.addConfig("user.name", "Test User");

  // Create initial commit (required for worktrees)
  const { writeFile } = await import("fs/promises");
  await writeFile(join(path, "README.md"), "# Test Repository\n");
  await git.add("README.md");
  await git.commit("Initial commit");

  // Create worktrees if requested
  if (options.worktrees && options.worktrees.length > 0) {
    for (const branchName of options.worktrees) {
      // Create branch first
      await git.branch([branchName]);

      // Create worktree directory
      const worktreePath = join(path, ".worktrees", branchName);
      await git.raw(["worktree", "add", worktreePath, branchName]);
    }
  }

  // Add dirty changes if requested
  if (options.dirty) {
    await writeFile(join(path, "dirty-file.txt"), "uncommitted changes\n");
  }

  // Detach HEAD if requested
  if (options.detached) {
    const log = await git.log(["-1"]);
    await git.checkout(log.latest!.hash);
  }

  return { path, cleanup };
}

/**
 * Run a test function with a temporary git repository.
 * The repository is automatically cleaned up after the test,
 * even if the test fails.
 *
 * @param fn Test function that receives the repo path
 * @param options Repository configuration
 */
export async function withTempRepo(
  fn: (repoPath: string) => Promise<void>,
  options: CreateTestGitRepoOptions = {}
): Promise<void> {
  const { path, cleanup } = await createTestGitRepo(options);
  try {
    await fn(path);
  } finally {
    await cleanup();
  }
}

/**
 * Run a test function with a temporary directory.
 * The directory is automatically cleaned up after the test,
 * even if the test fails.
 *
 * @param fn Test function that receives the directory path
 */
export async function withTempDir(fn: (dirPath: string) => Promise<void>): Promise<void> {
  const { path, cleanup } = await createTempDir();
  try {
    await fn(path);
  } finally {
    await cleanup();
  }
}
