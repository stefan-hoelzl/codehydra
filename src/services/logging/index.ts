/**
 * Public API exports for the logging service.
 */

export type { Logger, LoggingService, LogContext, LoggerName, LogLevel } from "./types";
export { LogLevel as LogLevelValues, logAtLevel } from "./types";
export { ElectronLogService } from "./electron-log-service";
export {
  createMockLogger,
  createMockLoggingService,
  createSilentLogger,
  SILENT_LOGGER,
} from "./logging.test-utils";
export type { MockLogger, MockLoggingService } from "./logging.test-utils";
