/**
 * Log IPC handlers.
 *
 * These handlers receive log messages from the renderer process
 * and delegate to the LoggingService for writing to log files.
 *
 * IMPORTANT: These handlers are registered early in bootstrap() to ensure
 * logging is available immediately when the renderer loads.
 */

import { ipcMain } from "electron";
import { ApiIpcChannels } from "../../shared/ipc";
import type { ApiLogPayload } from "../../shared/ipc";
import type { LoggingService, LoggerName, LogContext } from "../../services/logging";

/**
 * Validate and convert logger name from renderer to LoggerName type.
 * Returns "ui" if the provided name is not a valid LoggerName.
 */
function toLoggerName(name: string): LoggerName {
  // Valid renderer logger names
  const validNames = new Set<string>(["ui", "api"]);
  return validNames.has(name) ? (name as LoggerName) : "ui";
}

/**
 * Register log IPC handlers.
 *
 * These handlers delegate to the provided LoggingService.
 * They are fire-and-forget (use ipcMain.on instead of handle)
 * since logging should never block the renderer.
 *
 * @param loggingService - The LoggingService instance to delegate to
 */
export function registerLogHandlers(loggingService: LoggingService): void {
  // Debug level
  ipcMain.on(ApiIpcChannels.LOG_DEBUG, (_event, payload: ApiLogPayload) => {
    try {
      const loggerName = toLoggerName(payload.logger);
      const logger = loggingService.createLogger(loggerName);
      logger.debug(payload.message, payload.context as LogContext | undefined);
    } catch {
      // Swallow errors - logging should never crash the app
    }
  });

  // Info level
  ipcMain.on(ApiIpcChannels.LOG_INFO, (_event, payload: ApiLogPayload) => {
    try {
      const loggerName = toLoggerName(payload.logger);
      const logger = loggingService.createLogger(loggerName);
      logger.info(payload.message, payload.context as LogContext | undefined);
    } catch {
      // Swallow errors - logging should never crash the app
    }
  });

  // Warn level
  ipcMain.on(ApiIpcChannels.LOG_WARN, (_event, payload: ApiLogPayload) => {
    try {
      const loggerName = toLoggerName(payload.logger);
      const logger = loggingService.createLogger(loggerName);
      logger.warn(payload.message, payload.context as LogContext | undefined);
    } catch {
      // Swallow errors - logging should never crash the app
    }
  });

  // Error level
  ipcMain.on(ApiIpcChannels.LOG_ERROR, (_event, payload: ApiLogPayload) => {
    try {
      const loggerName = toLoggerName(payload.logger);
      const logger = loggingService.createLogger(loggerName);
      logger.error(payload.message, payload.context as LogContext | undefined);
    } catch {
      // Swallow errors - logging should never crash the app
    }
  });
}
