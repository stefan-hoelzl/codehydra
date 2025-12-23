// @vitest-environment node
/**
 * Boundary tests for OpenCodeServerManager.
 *
 * Tests with real opencode process spawning.
 * These tests are skipped if the opencode binary is not available.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { OpenCodeServerManager } from "./opencode-server-manager";
import { ExecaProcessRunner } from "../platform/process";
import { DefaultNetworkLayer } from "../platform/network";
import { DefaultFileSystemLayer } from "../platform/filesystem";
import { DefaultPathProvider } from "../platform/path-provider";
import { NodePlatformInfo } from "../../main/platform-info";
import { createMockBuildInfo } from "../platform/build-info.test-utils";
import { createSilentLogger } from "../logging";
import { generateOpencodeScript } from "../vscode-setup/bin-scripts";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile, readFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CI_TIMEOUT_MS } from "../platform/network.test-utils";

/**
 * Check if opencode binary exists and is executable.
 */
function isOpencodeAvailable(pathProvider: { opencodeBinaryPath: string }): boolean {
  try {
    return existsSync(pathProvider.opencodeBinaryPath);
  } catch {
    return false;
  }
}

describe("OpenCodeServerManager Boundary Tests", () => {
  let testDir: string;
  let manager: OpenCodeServerManager;
  // Custom path provider that overrides dataRootDir for testing
  let pathProvider: {
    dataRootDir: string;
    opencodeBinaryPath: string;
    projectsDir: string;
    vscodeDir: string;
    vscodeExtensionsDir: string;
    vscodeUserDataDir: string;
    vscodeSetupMarkerPath: string;
    electronDataDir: string;
    vscodeAssetsDir: string;
    appIconPath: string;
    binDir: string;
    codeServerDir: string;
    opencodeDir: string;
    codeServerBinaryPath: string;
    getProjectWorkspacesDir: (projectPath: string) => string;
  };
  let networkLayer: DefaultNetworkLayer;
  let fsLayer: DefaultFileSystemLayer;
  let processRunner: ExecaProcessRunner;
  let skipTests = false;

  beforeAll(async () => {
    // Create test directory
    testDir = join(tmpdir(), `opencode-server-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    await mkdir(join(testDir, "opencode"), { recursive: true });
    await mkdir(join(testDir, "workspace"), { recursive: true });

    // Create mock build info with development mode and correct appPath
    // This avoids Electron dependency (ElectronBuildInfo uses app.getVersion())
    const buildInfo = createMockBuildInfo({
      isDevelopment: true,
      appPath: process.cwd(),
    });
    const platformInfo = new NodePlatformInfo();

    // Use real path provider to get the actual opencode binary path
    const realPathProvider = new DefaultPathProvider(buildInfo, platformInfo);

    // Create a custom path provider that uses test directory for ports.json
    // but real opencode binary path
    pathProvider = {
      dataRootDir: testDir,
      projectsDir: realPathProvider.projectsDir,
      vscodeDir: realPathProvider.vscodeDir,
      vscodeExtensionsDir: realPathProvider.vscodeExtensionsDir,
      vscodeUserDataDir: realPathProvider.vscodeUserDataDir,
      vscodeSetupMarkerPath: realPathProvider.vscodeSetupMarkerPath,
      electronDataDir: realPathProvider.electronDataDir,
      vscodeAssetsDir: realPathProvider.vscodeAssetsDir,
      appIconPath: realPathProvider.appIconPath,
      binDir: realPathProvider.binDir,
      codeServerDir: realPathProvider.codeServerDir,
      opencodeDir: realPathProvider.opencodeDir,
      codeServerBinaryPath: realPathProvider.codeServerBinaryPath,
      opencodeBinaryPath: realPathProvider.opencodeBinaryPath,
      getProjectWorkspacesDir: (projectPath: string) =>
        realPathProvider.getProjectWorkspacesDir(projectPath),
    };

    // Create dependencies using silent loggers (no Electron dependency)
    networkLayer = new DefaultNetworkLayer(createSilentLogger());
    fsLayer = new DefaultFileSystemLayer(createSilentLogger());
    processRunner = new ExecaProcessRunner(createSilentLogger());

    // Check if opencode is available
    skipTests = !isOpencodeAvailable(realPathProvider);
    if (skipTests) {
      console.log(
        "Skipping boundary tests: opencode binary not found at",
        realPathProvider.opencodeBinaryPath
      );
    }
  });

  afterEach(async () => {
    // Dispose manager to stop any running servers
    if (manager) {
      await manager.dispose();
    }
  });

  afterAll(async () => {
    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it.skipIf(skipTests)("opencode serve starts and listens on allocated port", async () => {
    manager = new OpenCodeServerManager(
      processRunner,
      networkLayer,
      fsLayer,
      networkLayer,
      pathProvider,
      createSilentLogger(),
      { healthCheckTimeoutMs: CI_TIMEOUT_MS }
    );

    const workspacePath = join(testDir, "workspace");

    const port = await manager.startServer(workspacePath);

    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
    expect(manager.getPort(workspacePath)).toBe(port);
  });

  it.skipIf(skipTests)("health check to /app succeeds after startup", async () => {
    manager = new OpenCodeServerManager(
      processRunner,
      networkLayer,
      fsLayer,
      networkLayer,
      pathProvider,
      createSilentLogger(),
      { healthCheckTimeoutMs: CI_TIMEOUT_MS }
    );

    const workspacePath = join(testDir, "workspace");
    const port = await manager.startServer(workspacePath);

    // Verify health check endpoint works
    const response = await networkLayer.fetch(`http://127.0.0.1:${port}/app`, { timeout: 5000 });
    expect(response.ok).toBe(true);
  });

  it.skipIf(skipTests)("graceful shutdown terminates process", async () => {
    manager = new OpenCodeServerManager(
      processRunner,
      networkLayer,
      fsLayer,
      networkLayer,
      pathProvider,
      createSilentLogger(),
      { healthCheckTimeoutMs: CI_TIMEOUT_MS }
    );

    const workspacePath = join(testDir, "workspace");
    const port = await manager.startServer(workspacePath);

    // Verify server is running
    const runningResponse = await networkLayer.fetch(`http://127.0.0.1:${port}/app`, {
      timeout: 5000,
    });
    expect(runningResponse.ok).toBe(true);

    // Stop the server
    await manager.stopServer(workspacePath);

    // Wait a bit for port to be released
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify server is stopped (connection should fail)
    try {
      await networkLayer.fetch(`http://127.0.0.1:${port}/app`, { timeout: 1000 });
      // If we get here, the server is still running (unexpected)
      expect.fail("Server should have stopped but is still responding");
    } catch {
      // Expected - server should be stopped
    }
  });

  it.skipIf(skipTests)("ports.json persists across test runs", async () => {
    manager = new OpenCodeServerManager(
      processRunner,
      networkLayer,
      fsLayer,
      networkLayer,
      pathProvider,
      createSilentLogger(),
      { healthCheckTimeoutMs: CI_TIMEOUT_MS }
    );

    const workspacePath = join(testDir, "workspace");
    const port = await manager.startServer(workspacePath);

    // Read ports.json
    const portsFilePath = join(testDir, "opencode", "ports.json");
    const content = await readFile(portsFilePath, "utf-8");
    const parsed = JSON.parse(content);

    expect(parsed.workspaces).toBeDefined();
    expect(parsed.workspaces[workspacePath]).toBeDefined();
    expect(parsed.workspaces[workspacePath].port).toBe(port);
  });

  it.skipIf(skipTests)("cleanup removes entries for dead processes", async () => {
    // Create a stale ports.json entry
    const portsFilePath = join(testDir, "opencode", "ports.json");
    await writeFile(
      portsFilePath,
      JSON.stringify({
        workspaces: {
          "/fake/stale/workspace": { port: 59999 }, // Port likely not in use
        },
      })
    );

    manager = new OpenCodeServerManager(
      processRunner,
      networkLayer,
      fsLayer,
      networkLayer,
      pathProvider,
      createSilentLogger()
    );

    // Run cleanup
    await manager.cleanupStaleEntries();

    // Read ports.json
    const content = await readFile(portsFilePath, "utf-8");
    const parsed = JSON.parse(content);

    // Stale entry should be removed
    expect(parsed.workspaces["/fake/stale/workspace"]).toBeUndefined();
  });
});

describe("Wrapper Script Boundary Tests", () => {
  let testDir: string;
  let processRunner: ExecaProcessRunner;

  beforeAll(async () => {
    // Create test directory
    testDir = join(tmpdir(), `wrapper-script-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    await mkdir(join(testDir, "bin"), { recursive: true });
    await mkdir(join(testDir, "opencode"), { recursive: true });

    processRunner = new ExecaProcessRunner(createSilentLogger());
  });

  afterAll(async () => {
    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // Skip on Windows - different script format
  it.skipIf(process.platform === "win32")(
    "wrapper script is executable and runs in standalone mode",
    async () => {
      // Use a specific version for the test
      const TEST_VERSION = "1.0.163";

      // Generate the wrapper script content with version
      const script = generateOpencodeScript(false, TEST_VERSION);
      const scriptPath = join(testDir, "bin", script.filename);

      // Write the script
      await writeFile(scriptPath, script.content, "utf-8");

      // Make it executable
      if (script.needsExecutable) {
        await chmod(scriptPath, 0o755);
      }

      // Create a fake opencode binary that just echoes success
      // This tests that the wrapper script can execute and fall back to standalone mode
      const fakeOpencodeScript = `#!/bin/sh
echo "standalone_mode_activated"
exit 0
`;
      // Create versioned directory and fake binary
      const versionedDir = join(testDir, "opencode", TEST_VERSION);
      await mkdir(versionedDir, { recursive: true });
      const fakeOpencodePath = join(versionedDir, "opencode");
      await writeFile(fakeOpencodePath, fakeOpencodeScript, "utf-8");
      await chmod(fakeOpencodePath, 0o755);

      // Execute the wrapper script from a non-git directory (will trigger standalone mode)
      // The script should execute without error and run the fake opencode binary
      const proc = processRunner.run(scriptPath, ["--help"], {
        cwd: testDir, // Not a git repo, so no managed mode
      });

      const result = await proc.wait(5000);

      // Script should have executed successfully
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("standalone_mode_activated");
    }
  );
});
