/**
 * Unit tests for renderer logging module.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

interface MockLogApi {
  debug: Mock;
  info: Mock;
  warn: Mock;
  error: Mock;
}

describe("createLogger", () => {
  const originalWindow = global.window;
  let mockLog: MockLogApi;

  beforeEach(() => {
    // Set up mock window.api
    mockLog = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    global.window = {
      api: { log: mockLog },
    } as unknown as Window & typeof globalThis;
  });

  afterEach(() => {
    global.window = originalWindow;
    vi.resetModules();
  });

  async function getCreateLogger() {
    // Dynamic import to get fresh module after window mock is set up
    const { createLogger } = await import("./index");
    return createLogger;
  }

  it("creates logger with IPC transport", async () => {
    const createLogger = await getCreateLogger();
    const logger = createLogger("ui");

    expect(logger).toBeDefined();
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("includes logger name in IPC calls", async () => {
    const createLogger = await getCreateLogger();
    const logger = createLogger("ui");

    logger.info("Test message");

    expect(mockLog.info).toHaveBeenCalledWith("ui", "Test message", undefined);
  });

  it("passes context to IPC calls", async () => {
    const createLogger = await getCreateLogger();
    const logger = createLogger("ui");

    logger.debug("Test", { key: "value", count: 42 });

    expect(mockLog.debug).toHaveBeenCalledWith("ui", "Test", { key: "value", count: 42 });
  });

  describe("log level methods", () => {
    it("debug calls api.log.debug", async () => {
      const createLogger = await getCreateLogger();
      const logger = createLogger("ui");

      logger.debug("Debug message");
      expect(mockLog.debug).toHaveBeenCalledWith("ui", "Debug message", undefined);
    });

    it("info calls api.log.info", async () => {
      const createLogger = await getCreateLogger();
      const logger = createLogger("ui");

      logger.info("Info message");
      expect(mockLog.info).toHaveBeenCalledWith("ui", "Info message", undefined);
    });

    it("warn calls api.log.warn", async () => {
      const createLogger = await getCreateLogger();
      const logger = createLogger("ui");

      logger.warn("Warn message");
      expect(mockLog.warn).toHaveBeenCalledWith("ui", "Warn message", undefined);
    });

    it("error calls api.log.error", async () => {
      const createLogger = await getCreateLogger();
      const logger = createLogger("ui");

      logger.error("Error message");
      expect(mockLog.error).toHaveBeenCalledWith("ui", "Error message", undefined);
    });
  });

  describe("error handling", () => {
    it("handles IPC errors gracefully - never throws", async () => {
      const createLogger = await getCreateLogger();
      const logger = createLogger("ui");

      // Make IPC throw
      mockLog.info.mockImplementation(() => {
        throw new Error("IPC error");
      });

      // Should not throw
      expect(() => logger.info("Test")).not.toThrow();
    });

    it("handles missing api.log gracefully", async () => {
      // Set up window without log
      global.window = {
        api: {},
      } as unknown as Window & typeof globalThis;

      const createLogger = await getCreateLogger();
      const logger = createLogger("ui");

      // Should not throw
      expect(() => logger.info("Test")).not.toThrow();
    });
  });

  describe("logger names", () => {
    it("accepts ui logger name", async () => {
      const createLogger = await getCreateLogger();
      const logger = createLogger("ui");

      logger.info("From UI");
      expect(mockLog.info).toHaveBeenCalledWith("ui", "From UI", undefined);
    });

    it("accepts api logger name", async () => {
      const createLogger = await getCreateLogger();
      const logger = createLogger("api");

      logger.info("From API");
      expect(mockLog.info).toHaveBeenCalledWith("api", "From API", undefined);
    });
  });
});
