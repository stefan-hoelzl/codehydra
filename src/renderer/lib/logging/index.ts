/**
 * Renderer logging module.
 *
 * Provides a createLogger function for renderer components to log
 * messages to the main process via IPC.
 *
 * @example
 * ```typescript
 * import { createLogger } from '$lib/logging';
 *
 * const logger = createLogger('ui');
 * logger.info('Dialog opened', { type: 'create-workspace' });
 * ```
 */

import type { LogContext } from "@shared/ipc";

/**
 * Valid logger names for renderer components.
 * Most components use "ui", but specialized handlers may use "api".
 */
export type RendererLoggerName = "ui" | "api";

/**
 * Logger interface for renderer components.
 * Mirrors the main process Logger interface.
 */
export interface RendererLogger {
  /**
   * Log a debug message (most verbose).
   */
  debug(message: string, context?: LogContext): void;

  /**
   * Log an info message.
   */
  info(message: string, context?: LogContext): void;

  /**
   * Log a warning message.
   */
  warn(message: string, context?: LogContext): void;

  /**
   * Log an error message.
   */
  error(message: string, context?: LogContext): void;
}

/**
 * Create a logger for renderer components.
 *
 * The logger sends messages to the main process via IPC.
 * Logging never throws - errors are silently swallowed.
 *
 * @param name - Logger name/scope (e.g., 'ui', 'api')
 * @returns Logger instance
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { createLogger } from '$lib/logging';
 *   import { onMount } from 'svelte';
 *
 *   const logger = createLogger('ui');
 *
 *   onMount(() => {
 *     logger.debug('Component mounted');
 *   });
 *
 *   function handleClick() {
 *     logger.info('Button clicked', { buttonId: 'submit' });
 *   }
 * </script>
 * ```
 */
export function createLogger(name: RendererLoggerName): RendererLogger {
  return {
    debug(message: string, context?: LogContext): void {
      try {
        window.api.log.debug(name, message, context);
      } catch {
        // Never throw from logging
      }
    },
    info(message: string, context?: LogContext): void {
      try {
        window.api.log.info(name, message, context);
      } catch {
        // Never throw from logging
      }
    },
    warn(message: string, context?: LogContext): void {
      try {
        window.api.log.warn(name, message, context);
      } catch {
        // Never throw from logging
      }
    },
    error(message: string, context?: LogContext): void {
      try {
        window.api.log.error(name, message, context);
      } catch {
        // Never throw from logging
      }
    },
  };
}
