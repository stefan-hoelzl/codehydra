/**
 * Mock utilities for renderer logging tests.
 */

import { vi, type Mock } from "vitest";
import type { LogContext } from "@shared/ipc";
import type { RendererLogger, RendererLoggerName } from "./index";

/**
 * Mock renderer logger with vitest spy methods.
 */
export interface MockRendererLogger extends RendererLogger {
  debug: Mock<(message: string, context?: LogContext) => void>;
  info: Mock<(message: string, context?: LogContext) => void>;
  warn: Mock<(message: string, context?: LogContext) => void>;
  error: Mock<(message: string, context?: LogContext) => void>;
}

/**
 * Create a mock renderer logger with vitest spy methods.
 *
 * @returns Mock logger that records all calls
 *
 * @example
 * ```typescript
 * import { createMockRendererLogger } from '$lib/logging/logging.test-utils';
 *
 * vi.mock('$lib/logging', () => ({
 *   createLogger: () => mockLogger,
 * }));
 *
 * const mockLogger = createMockRendererLogger();
 *
 * // After running code that uses the logger:
 * expect(mockLogger.info).toHaveBeenCalledWith('Dialog opened', { type: 'create-workspace' });
 * ```
 */
export function createMockRendererLogger(): MockRendererLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/**
 * Create a mock createLogger function for use in vi.mock().
 *
 * @param mockLogger - Optional mock logger to return (defaults to new mock)
 * @returns Function matching createLogger signature
 *
 * @example
 * ```typescript
 * const mockLogger = createMockRendererLogger();
 *
 * vi.mock('$lib/logging', () => ({
 *   createLogger: createMockCreateLogger(mockLogger),
 * }));
 * ```
 */
export function createMockCreateLogger(
  mockLogger?: MockRendererLogger
): (name: RendererLoggerName) => RendererLogger {
  const logger = mockLogger ?? createMockRendererLogger();
  return () => logger;
}
