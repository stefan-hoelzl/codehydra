/**
 * Unit tests for LoggingProcessRunner.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { LoggingProcessRunner } from "./logging-process-runner";
import { createMockProcessRunner, createMockSpawnedProcess } from "./process.test-utils";
import { createMockLogger } from "../logging/logging.test-utils";
import type { MockLogger } from "../logging/logging.test-utils";
import type { MockProcessRunner, MockSpawnedProcess } from "./process.test-utils";

describe("LoggingProcessRunner", () => {
  let mockLogger: MockLogger;
  let mockInner: MockProcessRunner;
  let runner: LoggingProcessRunner;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockInner = createMockProcessRunner();
    runner = new LoggingProcessRunner(mockInner, mockLogger);
  });

  describe("run", () => {
    it("logs process spawn with command and PID", () => {
      const mockProc = createMockSpawnedProcess({ pid: 12345 });
      mockInner.run.mockReturnValue(mockProc);

      runner.run("code-server", ["--port", "8080"]);

      expect(mockLogger.debug).toHaveBeenCalledWith("Spawned", {
        command: "code-server",
        pid: 12345,
      });
    });

    it("does not log spawn on spawn failure (waits for wait)", () => {
      // pid: null means undefined (spawn failure)
      const mockProc = createMockSpawnedProcess({ pid: null });
      mockInner.run.mockReturnValue(mockProc);

      runner.run("nonexistent", []);

      // Should not log debug for spawn
      expect(mockLogger.debug).not.toHaveBeenCalled();
    });

    it("delegates to inner runner", () => {
      runner.run("ls", ["-la"], { cwd: "/tmp" });

      expect(mockInner.run).toHaveBeenCalledWith("ls", ["-la"], { cwd: "/tmp" });
    });
  });

  describe("SpawnedProcess.wait", () => {
    let mockProc: MockSpawnedProcess;

    beforeEach(() => {
      mockProc = createMockSpawnedProcess({
        pid: 12345,
        waitResult: { exitCode: 0, stdout: "output", stderr: "" },
      });
      mockInner.run.mockReturnValue(mockProc);
    });

    it("logs process exit with exitCode", async () => {
      const proc = runner.run("echo", ["hello"]);
      await proc.wait();

      expect(mockLogger.debug).toHaveBeenCalledWith("Exited", {
        command: "echo",
        pid: 12345,
        exitCode: 0,
      });
    });

    it("logs stdout lines at DEBUG level", async () => {
      mockProc = createMockSpawnedProcess({
        pid: 12345,
        waitResult: { exitCode: 0, stdout: "line1\nline2\n", stderr: "" },
      });
      mockInner.run.mockReturnValue(mockProc);

      const proc = runner.run("echo", []);
      await proc.wait();

      expect(mockLogger.debug).toHaveBeenCalledWith("[echo 12345] stdout: line1");
      expect(mockLogger.debug).toHaveBeenCalledWith("[echo 12345] stdout: line2");
    });

    it("logs stderr lines at DEBUG level", async () => {
      mockProc = createMockSpawnedProcess({
        pid: 12345,
        waitResult: { exitCode: 1, stdout: "", stderr: "error1\nerror2" },
      });
      mockInner.run.mockReturnValue(mockProc);

      const proc = runner.run("failing", []);
      await proc.wait();

      expect(mockLogger.debug).toHaveBeenCalledWith("[failing 12345] stderr: error1");
      expect(mockLogger.debug).toHaveBeenCalledWith("[failing 12345] stderr: error2");
    });

    it("logs process kill with signal at WARN level", async () => {
      mockProc = createMockSpawnedProcess({
        pid: 12345,
        waitResult: { exitCode: null, stdout: "", stderr: "", signal: "SIGTERM" },
      });
      mockInner.run.mockReturnValue(mockProc);

      const proc = runner.run("long-running", []);
      await proc.wait();

      expect(mockLogger.warn).toHaveBeenCalledWith("Killed", {
        command: "long-running",
        pid: 12345,
        signal: "SIGTERM",
      });
    });

    it("logs spawn failures at ERROR level", async () => {
      mockProc = createMockSpawnedProcess({
        pid: null, // Spawn failed
        waitResult: { exitCode: null, stdout: "", stderr: "spawn ENOENT" },
      });
      mockInner.run.mockReturnValue(mockProc);

      const proc = runner.run("nonexistent", []);
      await proc.wait();

      expect(mockLogger.error).toHaveBeenCalledWith("Spawn failed", {
        command: "nonexistent",
        error: "spawn ENOENT",
      });
    });

    it("logs timeout at WARN level", async () => {
      mockProc = createMockSpawnedProcess({
        pid: 12345,
        waitResult: { exitCode: null, stdout: "", stderr: "", running: true },
      });
      mockInner.run.mockReturnValue(mockProc);

      const proc = runner.run("hanging", []);
      await proc.wait(5000);

      expect(mockLogger.warn).toHaveBeenCalledWith("Wait timeout", {
        command: "hanging",
        pid: 12345,
        timeout: 5000,
      });
    });

    it("only logs result once (caching)", async () => {
      const proc = runner.run("echo", []);

      await proc.wait();
      await proc.wait();

      // "Exited" should only be logged once
      const exitedCalls = mockLogger.debug.mock.calls.filter((call) => call[0] === "Exited");
      expect(exitedCalls.length).toBe(1);
    });
  });

  describe("SpawnedProcess.kill", () => {
    it("logs kill attempt with signal at WARN level", () => {
      const mockProc = createMockSpawnedProcess({ pid: 12345, killResult: true });
      mockInner.run.mockReturnValue(mockProc);

      const proc = runner.run("process", []);
      proc.kill("SIGKILL");

      expect(mockLogger.warn).toHaveBeenCalledWith("Killed", {
        command: "process",
        pid: 12345,
        signal: "SIGKILL",
      });
    });

    it("logs kill with default SIGTERM", () => {
      const mockProc = createMockSpawnedProcess({ pid: 12345, killResult: true });
      mockInner.run.mockReturnValue(mockProc);

      const proc = runner.run("process", []);
      proc.kill();

      expect(mockLogger.warn).toHaveBeenCalledWith("Killed", {
        command: "process",
        pid: 12345,
        signal: "SIGTERM",
      });
    });

    it("does not log if kill returns false", () => {
      const mockProc = createMockSpawnedProcess({ pid: 12345, killResult: false });
      mockInner.run.mockReturnValue(mockProc);

      const proc = runner.run("process", []);
      // Clear spawn log
      mockLogger.warn.mockClear();

      proc.kill();

      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe("output formatting", () => {
    it("skips empty lines in stdout", async () => {
      const mockProc = createMockSpawnedProcess({
        pid: 12345,
        waitResult: { exitCode: 0, stdout: "line1\n\n\nline2\n", stderr: "" },
      });
      mockInner.run.mockReturnValue(mockProc);

      const proc = runner.run("echo", []);
      await proc.wait();

      const stdoutCalls = mockLogger.debug.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].includes("stdout:")
      );
      expect(stdoutCalls.length).toBe(2);
    });

    it("handles empty output gracefully", async () => {
      const mockProc = createMockSpawnedProcess({
        pid: 12345,
        waitResult: { exitCode: 0, stdout: "", stderr: "" },
      });
      mockInner.run.mockReturnValue(mockProc);

      const proc = runner.run("silent", []);
      await proc.wait();

      // Should only have spawn and exit logs
      expect(mockLogger.debug).toHaveBeenCalledTimes(2); // Spawned + Exited
    });
  });
});
