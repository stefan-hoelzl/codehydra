/**
 * LoggingProcessRunner - Decorator that adds logging to ProcessRunner.
 *
 * Wraps a ProcessRunner to log:
 * - Process spawn (command, PID)
 * - stdout/stderr output (from final result, logged as lines)
 * - Process exit (exitCode)
 * - Process kill (signal)
 * - Spawn failures (ENOENT, etc.)
 * - Wait timeouts
 *
 * The base ProcessRunner (ExecaProcessRunner) remains pure with no logging dependencies.
 */

import type { ProcessRunner, ProcessResult, ProcessOptions, SpawnedProcess } from "./process";
import type { Logger } from "../logging";

/**
 * Decorator that adds logging to ProcessRunner.
 */
export class LoggingProcessRunner implements ProcessRunner {
  constructor(
    private readonly inner: ProcessRunner,
    private readonly logger: Logger
  ) {}

  run(command: string, args: readonly string[], options?: ProcessOptions): SpawnedProcess {
    const proc = this.inner.run(command, args, options);

    // Check if spawn failed (no PID)
    if (proc.pid === undefined) {
      // Log spawn failure when wait() is called (to get stderr with error message)
      return new LoggingSpawnedProcess(proc, command, this.logger, true);
    }

    // Log successful spawn
    this.logger.debug("Spawned", { command, pid: proc.pid });

    return new LoggingSpawnedProcess(proc, command, this.logger, false);
  }
}

/**
 * Wrapper around SpawnedProcess that adds logging to wait() and kill().
 */
class LoggingSpawnedProcess implements SpawnedProcess {
  private hasLoggedResult = false;

  constructor(
    private readonly inner: SpawnedProcess,
    private readonly command: string,
    private readonly logger: Logger,
    private readonly spawnFailed: boolean
  ) {}

  get pid(): number | undefined {
    return this.inner.pid;
  }

  kill(signal?: NodeJS.Signals): boolean {
    const result = this.inner.kill(signal);

    if (result) {
      // Log kill attempt
      this.logger.warn("Killed", {
        command: this.command,
        pid: this.pid ?? 0,
        signal: signal ?? "SIGTERM",
      });
    }

    return result;
  }

  async wait(timeout?: number): Promise<ProcessResult> {
    const result = await this.inner.wait(timeout);

    // Only log once (result is cached by inner SpawnedProcess)
    if (this.hasLoggedResult) {
      return result;
    }
    this.hasLoggedResult = true;

    // Handle spawn failure (logged at ERROR level)
    if (this.spawnFailed) {
      this.logger.error("Spawn failed", {
        command: this.command,
        error: result.stderr || "Unknown error",
      });
      return result;
    }

    // Handle timeout
    if (result.running) {
      this.logger.warn("Wait timeout", {
        command: this.command,
        pid: this.pid ?? 0,
        timeout: timeout ?? 0,
      });
      return result;
    }

    // Log stdout/stderr lines
    this.logOutputLines(result.stdout, "stdout");
    this.logOutputLines(result.stderr, "stderr");

    // Log exit status
    if (result.signal) {
      // Process was killed by signal
      this.logger.warn("Killed", {
        command: this.command,
        pid: this.pid ?? 0,
        signal: result.signal,
      });
    } else {
      // Normal exit
      this.logger.debug("Exited", {
        command: this.command,
        pid: this.pid ?? 0,
        exitCode: result.exitCode ?? -1,
      });
    }

    return result;
  }

  /**
   * Log output lines (stdout or stderr) at DEBUG level.
   */
  private logOutputLines(output: string, stream: "stdout" | "stderr"): void {
    if (!output) return;

    const lines = output.split("\n");
    const prefix = `[${this.command} ${this.pid ?? 0}]`;

    for (const line of lines) {
      // Skip empty lines
      if (line.trim() === "") continue;

      this.logger.debug(`${prefix} ${stream}: ${line}`);
    }
  }
}
