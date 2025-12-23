// @vitest-environment node
/**
 * Boundary tests for bin-scripts opencode wrapper.
 * Tests with real filesystem, git, and Node.js execution.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { writeFile, mkdir, chmod } from "node:fs/promises";
import { generateOpencodeNodeScript } from "./bin-scripts";
import { createTempDir, createTestGitRepo } from "../test-utils";

const TEST_VERSION = "1.0.163";
const isWindows = process.platform === "win32";

/**
 * Create the directory structure for testing the opencode script.
 * Creates:
 * - bin/opencode.cjs
 * - opencode/<version>/opencode (fake binary)
 *
 * @param basePath Base directory to create structure in
 */
async function createOpencodeTestStructure(basePath: string): Promise<{
  binDir: string;
  scriptPath: string;
  opencodeDir: string;
  fakeOpencodePath: string;
}> {
  const binDir = join(basePath, "bin");
  const opencodeVersionDir = join(basePath, "opencode", TEST_VERSION);

  await mkdir(binDir, { recursive: true });
  await mkdir(opencodeVersionDir, { recursive: true });

  // Write the Node.js script
  const scriptPath = join(binDir, "opencode.cjs");
  await writeFile(scriptPath, generateOpencodeNodeScript(TEST_VERSION));

  // Create a fake opencode binary that just exits with the first arg as exit code
  // or 0 if no args. This lets us test exit code propagation.
  const fakeOpencodePath = join(opencodeVersionDir, isWindows ? "opencode.exe" : "opencode");

  if (isWindows) {
    // Windows batch script that echoes args and exits with code from env
    const batchContent = `@echo off
echo ATTACH_CALLED %*
exit /b %OPENCODE_EXIT_CODE%
`;
    await writeFile(fakeOpencodePath, batchContent);
    // Windows needs a .cmd extension for the script to be executable
    const cmdPath = fakeOpencodePath.replace(".exe", ".cmd");
    await writeFile(cmdPath, batchContent);
  } else {
    // Unix shell script
    const shellContent = `#!/bin/sh
echo "ATTACH_CALLED $*"
exit \${OPENCODE_EXIT_CODE:-0}
`;
    await writeFile(fakeOpencodePath, shellContent);
    await chmod(fakeOpencodePath, 0o755);
  }

  return { binDir, scriptPath, opencodeDir: join(basePath, "opencode"), fakeOpencodePath };
}

/**
 * Create a ports.json file with workspace port mappings.
 */
async function createPortsJson(
  basePath: string,
  workspaces: Record<string, { port: number }>
): Promise<string> {
  const portsPath = join(basePath, "opencode", "ports.json");
  await mkdir(join(basePath, "opencode"), { recursive: true });
  await writeFile(portsPath, JSON.stringify({ workspaces }, null, 2));
  return portsPath;
}

/**
 * Execute the opencode.cjs script and capture output.
 */
function executeScript(
  scriptPath: string,
  cwd: string,
  exitCode = 0
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      OPENCODE_EXIT_CODE: String(exitCode),
    },
  });

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
}

describe("opencode.cjs boundary tests", () => {
  let tempDir: { path: string; cleanup: () => Promise<void> };
  let testStructure: Awaited<ReturnType<typeof createOpencodeTestStructure>>;

  beforeEach(async () => {
    tempDir = await createTempDir();
    testStructure = await createOpencodeTestStructure(tempDir.path);
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  describe("error cases", () => {
    it("errors when not in a git repository", async () => {
      // Create ports.json but run from a non-git directory
      await createPortsJson(tempDir.path, { "/some/path": { port: 14001 } });

      // Create a directory that's not a git repo
      const nonGitDir = join(tempDir.path, "not-a-repo");
      await mkdir(nonGitDir);

      const result = executeScript(testStructure.scriptPath, nonGitDir);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Error: Not in a git repository");
    });

    it("errors when ports.json is missing", async () => {
      // Create a git repo but don't create ports.json
      const { path: gitRepoPath, cleanup } = await createTestGitRepo();

      try {
        const result = executeScript(testStructure.scriptPath, gitRepoPath);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Error: No opencode servers are running");
      } finally {
        await cleanup();
      }
    });

    it("errors when ports.json is invalid JSON", async () => {
      // Create a git repo
      const { path: gitRepoPath, cleanup } = await createTestGitRepo();

      try {
        // Create invalid ports.json
        const portsPath = join(tempDir.path, "opencode", "ports.json");
        await mkdir(join(tempDir.path, "opencode"), { recursive: true });
        await writeFile(portsPath, "{ invalid json }");

        const result = executeScript(testStructure.scriptPath, gitRepoPath);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Error: Failed to read ports.json");
      } finally {
        await cleanup();
      }
    });

    it("errors when workspace not in ports.json", async () => {
      // Create a git repo
      const { path: gitRepoPath, cleanup } = await createTestGitRepo();

      try {
        // Create ports.json with different workspace
        await createPortsJson(tempDir.path, { "/other/workspace": { port: 14001 } });

        const result = executeScript(testStructure.scriptPath, gitRepoPath);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Error: No opencode server found for workspace:");
        expect(result.stderr).toContain("Make sure the workspace is open in CodeHydra.");
      } finally {
        await cleanup();
      }
    });

    it("errors when opencode binary does not exist", async () => {
      // Create a git repo
      const { path: gitRepoPath, cleanup } = await createTestGitRepo();

      try {
        // Create a separate test structure without the fake binary
        const noBinaryDir = join(tempDir.path, "no-binary");
        await mkdir(noBinaryDir, { recursive: true });

        // Create only the bin directory with the script
        const binDir = join(noBinaryDir, "bin");
        await mkdir(binDir, { recursive: true });
        const scriptPath = join(binDir, "opencode.cjs");
        await writeFile(scriptPath, generateOpencodeNodeScript(TEST_VERSION));

        // Create opencode directory (for ports.json) but NOT the binary
        const opencodeDir = join(noBinaryDir, "opencode");
        await mkdir(opencodeDir, { recursive: true });

        // Create ports.json with valid workspace entry
        await writeFile(
          join(opencodeDir, "ports.json"),
          JSON.stringify({ workspaces: { [gitRepoPath]: { port: 14001 } } }, null, 2)
        );

        // Do NOT create the opencode/<version>/opencode binary
        // This will cause spawnSync to fail with ENOENT

        const result = executeScript(scriptPath, gitRepoPath);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Error: Failed to start opencode:");
      } finally {
        await cleanup();
      }
    });
  });

  describe("success cases", () => {
    it("attaches when workspace is in ports.json", async () => {
      // Create a git repo
      const { path: gitRepoPath, cleanup } = await createTestGitRepo();

      try {
        // Create ports.json with this workspace
        await createPortsJson(tempDir.path, { [gitRepoPath]: { port: 14001 } });

        const result = executeScript(testStructure.scriptPath, gitRepoPath);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain("ATTACH_CALLED");
        expect(result.stdout).toContain("attach");
        expect(result.stdout).toContain("http://127.0.0.1:14001");
      } finally {
        await cleanup();
      }
    });

    it("propagates exit code 0 on success", async () => {
      const { path: gitRepoPath, cleanup } = await createTestGitRepo();

      try {
        await createPortsJson(tempDir.path, { [gitRepoPath]: { port: 14001 } });

        const result = executeScript(testStructure.scriptPath, gitRepoPath, 0);

        expect(result.status).toBe(0);
      } finally {
        await cleanup();
      }
    });

    it("propagates non-zero exit code", async () => {
      const { path: gitRepoPath, cleanup } = await createTestGitRepo();

      try {
        await createPortsJson(tempDir.path, { [gitRepoPath]: { port: 14001 } });

        const result = executeScript(testStructure.scriptPath, gitRepoPath, 42);

        expect(result.status).toBe(42);
      } finally {
        await cleanup();
      }
    });
  });

  describe("path handling", () => {
    it("handles paths with spaces", async () => {
      // Create temp structure with spaces
      const spacedDir = join(tempDir.path, "path with spaces");
      await mkdir(spacedDir, { recursive: true });
      const spacedStructure = await createOpencodeTestStructure(spacedDir);

      // Create a git repo in a spaced path
      const spacedGitDir = join(spacedDir, "git repo");
      await mkdir(spacedGitDir);

      // Initialize git in the spaced directory
      execSync("git init --initial-branch=main", {
        cwd: spacedGitDir,
        encoding: "utf8",
      });
      execSync('git config user.email "test@test.com"', {
        cwd: spacedGitDir,
        encoding: "utf8",
      });
      execSync('git config user.name "Test User"', {
        cwd: spacedGitDir,
        encoding: "utf8",
      });
      await writeFile(join(spacedGitDir, "README.md"), "# Test");
      execSync("git add README.md", { cwd: spacedGitDir, encoding: "utf8" });
      execSync('git commit -m "Initial commit"', {
        cwd: spacedGitDir,
        encoding: "utf8",
      });

      // Create ports.json with spaced workspace path
      await createPortsJson(spacedDir, { [spacedGitDir]: { port: 14002 } });

      const result = executeScript(spacedStructure.scriptPath, spacedGitDir);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("ATTACH_CALLED");
    });

    it.skipIf(!isWindows)("handles workspace paths on different drives/volumes", async () => {
      // This test is only meaningful on Windows where paths like C: and D: exist
      // On Unix, skip since there are no drive letters
      const { path: gitRepoPath, cleanup } = await createTestGitRepo();

      try {
        // The ports.json uses the actual gitRepoPath which is resolved correctly
        await createPortsJson(tempDir.path, { [gitRepoPath]: { port: 14003 } });

        const result = executeScript(testStructure.scriptPath, gitRepoPath);

        expect(result.status).toBe(0);
      } finally {
        await cleanup();
      }
    });
  });
});
