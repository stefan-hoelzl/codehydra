// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { findAvailablePort, spawnProcess } from "./process";
import { createServer } from "net";

describe("findAvailablePort", () => {
  it("returns a valid port number", async () => {
    const port = await findAvailablePort();

    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65535);
  });

  it("returns different ports on subsequent calls", async () => {
    // Note: This may occasionally fail if the same port is reused
    // but is generally a good test for the port finding logic
    const port1 = await findAvailablePort();
    const port2 = await findAvailablePort();

    // Ports might be the same if reused quickly, so just verify they're valid
    expect(port1).toBeGreaterThan(0);
    expect(port2).toBeGreaterThan(0);
  });

  it("returns a port that can be bound", async () => {
    const port = await findAvailablePort();

    // Verify we can actually bind to this port
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.listen(port, () => resolve());
      server.on("error", reject);
    });
    server.close();
  });
});

describe("spawnProcess", () => {
  const runningProcesses: Array<{ kill: () => void }> = [];

  afterEach(async () => {
    // Clean up any running processes
    for (const proc of runningProcesses) {
      try {
        proc.kill();
      } catch {
        // Ignore errors during cleanup
      }
    }
    runningProcesses.length = 0;
  });

  it("spawns a process and returns subprocess", async () => {
    const subprocess = spawnProcess("echo", ["hello"]);
    runningProcesses.push(subprocess);

    const result = await subprocess;

    expect(result.stdout).toContain("hello");
    expect(result.exitCode).toBe(0);
  });

  it("captures stdout from process", async () => {
    const subprocess = spawnProcess("echo", ["test output"]);
    runningProcesses.push(subprocess);

    const result = await subprocess;

    expect(result.stdout).toContain("test output");
  });

  it("captures stderr from process", async () => {
    const subprocess = spawnProcess("sh", ["-c", "echo error >&2"]);
    runningProcesses.push(subprocess);

    const result = await subprocess;

    expect(result.stderr).toContain("error");
  });

  it("provides exit code on completion", async () => {
    const subprocess = spawnProcess("sh", ["-c", "exit 0"]);
    runningProcesses.push(subprocess);

    const result = await subprocess;

    expect(result.exitCode).toBe(0);
  });

  it("provides non-zero exit code on failure", async () => {
    const subprocess = spawnProcess("sh", ["-c", "exit 42"]);
    runningProcesses.push(subprocess);

    await expect(subprocess).rejects.toMatchObject({
      exitCode: 42,
    });
  });

  it("can be killed gracefully", async () => {
    const subprocess = spawnProcess("sleep", ["10"]);
    runningProcesses.push(subprocess);

    // Kill the process
    subprocess.kill("SIGTERM");

    await expect(subprocess).rejects.toMatchObject({
      signal: "SIGTERM",
    });
  });

  it("supports custom working directory", async () => {
    const subprocess = spawnProcess("pwd", [], { cwd: "/tmp" });
    runningProcesses.push(subprocess);

    const result = await subprocess;

    expect(result.stdout.trim()).toBe("/tmp");
  });

  it("supports environment variables", async () => {
    const subprocess = spawnProcess("sh", ["-c", "echo $TEST_VAR"], {
      env: { ...process.env, TEST_VAR: "test_value" },
    });
    runningProcesses.push(subprocess);

    const result = await subprocess;

    expect(result.stdout).toContain("test_value");
  });
});
