// @vitest-environment node
/**
 * Tests for ExecaSpawnedProcess class.
 * These tests verify the SpawnedProcess interface implementation.
 */
import { describe, it, expect } from "vitest";
import { execa } from "execa";

import { ExecaSpawnedProcess } from "./process";

describe("ExecaSpawnedProcess", () => {
  describe("pid", () => {
    it("returns process ID", () => {
      // Use real execa subprocess to test pid
      const subprocess = execa("sleep", ["10"], {
        cleanup: true,
        encoding: "utf8",
        reject: false,
      });
      const spawned = new ExecaSpawnedProcess(subprocess);

      expect(spawned.pid).toBeGreaterThan(0);

      // Cleanup
      subprocess.kill("SIGKILL");
    });

    it("returns undefined on immediate spawn failure (ENOENT)", async () => {
      const subprocess = execa("nonexistent-binary-12345", [], {
        cleanup: true,
        encoding: "utf8",
        reject: false,
      });
      const spawned = new ExecaSpawnedProcess(subprocess);

      // For ENOENT, the process never spawns so pid is undefined
      expect(spawned.pid).toBeUndefined();

      // Wait for the error to propagate
      await spawned.wait();
    });
  });

  describe("kill", () => {
    it("returns true when signal sent", () => {
      const subprocess = execa("sleep", ["10"], {
        cleanup: true,
        encoding: "utf8",
        reject: false,
      });
      const spawned = new ExecaSpawnedProcess(subprocess);

      const result = spawned.kill("SIGTERM");

      expect(result).toBe(true);
    });

    it("returns false when process already dead", async () => {
      const subprocess = execa("echo", ["hello"], {
        cleanup: true,
        encoding: "utf8",
        reject: false,
      });
      const spawned = new ExecaSpawnedProcess(subprocess);

      // Wait for process to complete
      await spawned.wait();

      // Now try to kill it
      const result = spawned.kill("SIGTERM");

      expect(result).toBe(false);
    });

    it("sends SIGTERM by default", async () => {
      const subprocess = execa("sleep", ["10"], {
        cleanup: true,
        encoding: "utf8",
        reject: false,
      });
      const spawned = new ExecaSpawnedProcess(subprocess);

      spawned.kill();
      const result = await spawned.wait();

      expect(result.signal).toBe("SIGTERM");
    });

    it("sends SIGKILL when specified", async () => {
      const subprocess = execa("sleep", ["10"], {
        cleanup: true,
        encoding: "utf8",
        reject: false,
      });
      const spawned = new ExecaSpawnedProcess(subprocess);

      spawned.kill("SIGKILL");
      const result = await spawned.wait();

      expect(result.signal).toBe("SIGKILL");
    });

    it("sends SIGINT when specified", async () => {
      const subprocess = execa("sleep", ["10"], {
        cleanup: true,
        encoding: "utf8",
        reject: false,
      });
      const spawned = new ExecaSpawnedProcess(subprocess);

      spawned.kill("SIGINT");
      const result = await spawned.wait();

      expect(result.signal).toBe("SIGINT");
    });
  });

  describe("wait", () => {
    it("returns result on normal exit (exit 0)", async () => {
      const subprocess = execa("echo", ["hello"], {
        cleanup: true,
        encoding: "utf8",
        reject: false,
      });
      const spawned = new ExecaSpawnedProcess(subprocess);

      const result = await spawned.wait();

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello");
      expect(result.stderr).toBe("");
      expect(result.running).toBeUndefined();
    });

    it("returns result on non-zero exit (no throw)", async () => {
      const subprocess = execa("sh", ["-c", "exit 42"], {
        cleanup: true,
        encoding: "utf8",
        reject: false,
      });
      const spawned = new ExecaSpawnedProcess(subprocess);

      const result = await spawned.wait();

      expect(result.exitCode).toBe(42);
      expect(result.running).toBeUndefined();
    });

    it("returns signal when killed", async () => {
      const subprocess = execa("sleep", ["10"], {
        cleanup: true,
        encoding: "utf8",
        reject: false,
      });
      const spawned = new ExecaSpawnedProcess(subprocess);

      spawned.kill("SIGTERM");
      const result = await spawned.wait();

      expect(result.exitCode).toBeNull();
      expect(result.signal).toBe("SIGTERM");
      expect(result.running).toBeUndefined();
    });

    it("returns running:true on timeout", async () => {
      const subprocess = execa("sleep", ["10"], {
        cleanup: true,
        encoding: "utf8",
        reject: false,
      });
      const spawned = new ExecaSpawnedProcess(subprocess);

      const result = await spawned.wait(50); // 50ms timeout

      expect(result.running).toBe(true);
      expect(result.exitCode).toBeNull();
      expect(result.signal).toBeUndefined();

      // Cleanup
      spawned.kill("SIGKILL");
      await spawned.wait();
    });

    it("returns result if process exits before timeout", async () => {
      const subprocess = execa("echo", ["fast"], {
        cleanup: true,
        encoding: "utf8",
        reject: false,
      });
      const spawned = new ExecaSpawnedProcess(subprocess);

      const result = await spawned.wait(5000); // 5s timeout

      expect(result.running).toBeUndefined();
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("fast");
    });

    it("can be called multiple times with same result", async () => {
      const subprocess = execa("echo", ["test"], {
        cleanup: true,
        encoding: "utf8",
        reject: false,
      });
      const spawned = new ExecaSpawnedProcess(subprocess);

      const result1 = await spawned.wait();
      const result2 = await spawned.wait();

      expect(result1.exitCode).toBe(0);
      expect(result2.exitCode).toBe(0);
      expect(result1.stdout).toEqual(result2.stdout);
    });

    it("handles different timeouts on subsequent calls", async () => {
      const subprocess = execa("sleep", ["10"], {
        cleanup: true,
        encoding: "utf8",
        reject: false,
      });
      const spawned = new ExecaSpawnedProcess(subprocess);

      // First call with short timeout
      const result1 = await spawned.wait(50);
      expect(result1.running).toBe(true);

      // Second call with no timeout after killing
      spawned.kill("SIGTERM");
      const result2 = await spawned.wait();
      expect(result2.running).toBeUndefined();
      expect(result2.signal).toBe("SIGTERM");
    });

    it("resolves with signal when killed during wait", async () => {
      const subprocess = execa("sleep", ["10"], {
        cleanup: true,
        encoding: "utf8",
        reject: false,
      });
      const spawned = new ExecaSpawnedProcess(subprocess);

      // Start waiting
      const waitPromise = spawned.wait();

      // Kill after a small delay
      setTimeout(() => spawned.kill("SIGTERM"), 10);

      const result = await waitPromise;

      expect(result.signal).toBe("SIGTERM");
    });

    it("captures stdout", async () => {
      const subprocess = execa("echo", ["output text"], {
        cleanup: true,
        encoding: "utf8",
        reject: false,
      });
      const spawned = new ExecaSpawnedProcess(subprocess);

      const result = await spawned.wait();

      expect(result.stdout).toContain("output text");
    });

    it("captures stderr", async () => {
      const subprocess = execa("sh", ["-c", "echo error >&2"], {
        cleanup: true,
        encoding: "utf8",
        reject: false,
      });
      const spawned = new ExecaSpawnedProcess(subprocess);

      const result = await spawned.wait();

      expect(result.stderr).toContain("error");
    });
  });

  describe("error handling", () => {
    it("handles ENOENT (binary not found)", async () => {
      const subprocess = execa("nonexistent-binary-xyz-123", [], {
        cleanup: true,
        encoding: "utf8",
        reject: false,
      });
      const spawned = new ExecaSpawnedProcess(subprocess);

      const result = await spawned.wait();

      expect(result.exitCode).toBeNull();
      expect(result.stderr).toContain("ENOENT");
    });

    it("handles EACCES (permission denied)", async () => {
      // Create a non-executable file and try to run it
      const subprocess = execa("/etc/passwd", [], {
        cleanup: true,
        encoding: "utf8",
        reject: false,
      });
      const spawned = new ExecaSpawnedProcess(subprocess);

      const result = await spawned.wait();

      expect(result.exitCode).toBeNull();
      // Error message should indicate permission issue
      expect(result.stderr.toLowerCase()).toMatch(/eacces|permission/);
    });

    it("handles ENOTDIR (not a directory)", async () => {
      // Try to run a command with a file as cwd - but we can't test cwd here
      // since ExecaSpawnedProcess takes an already-spawned subprocess.
      // This test would need to be at ProcessRunner level.
      // For now, skip this as it's tested at ExecaProcessRunner level.
    });
  });
});
