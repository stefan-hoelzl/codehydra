/**
 * Test utilities for process module.
 */
import { vi, type Mock } from "vitest";
import type { SpawnedProcess, ProcessResult, ProcessRunner, ProcessOptions } from "./process";

/**
 * Mock SpawnedProcess with vitest mock methods for assertions.
 */
export interface MockSpawnedProcess extends SpawnedProcess {
  kill: Mock<(signal?: NodeJS.Signals) => boolean>;
  wait: Mock<(timeout?: number) => Promise<ProcessResult>>;
}

/**
 * Mock ProcessRunner with vitest mock method for assertions.
 */
export interface MockProcessRunner extends ProcessRunner {
  run: Mock<(command: string, args: readonly string[], options?: ProcessOptions) => SpawnedProcess>;
}

/**
 * Create a mock SpawnedProcess with controllable behavior.
 */
export function createMockSpawnedProcess(overrides?: {
  pid?: number;
  killResult?: boolean;
  waitResult?: ProcessResult | (() => Promise<ProcessResult>);
}): MockSpawnedProcess {
  const defaultResult: ProcessResult = {
    exitCode: 0,
    stdout: "",
    stderr: "",
  };

  return {
    pid: overrides?.pid ?? 12345,
    kill: vi.fn().mockReturnValue(overrides?.killResult ?? true),
    wait: vi.fn().mockImplementation(async () => {
      if (typeof overrides?.waitResult === "function") {
        return overrides.waitResult();
      }
      return overrides?.waitResult ?? defaultResult;
    }),
  };
}

/**
 * Create a mock ProcessRunner returning the given SpawnedProcess.
 */
export function createMockProcessRunner(spawnedProcess?: SpawnedProcess): MockProcessRunner {
  return {
    run: vi.fn().mockReturnValue(spawnedProcess ?? createMockSpawnedProcess()),
  };
}
