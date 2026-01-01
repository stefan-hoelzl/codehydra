/**
 * Integration tests for sendInitialPrompt utility.
 *
 * Uses behavioral mocks that track state rather than call counts.
 *
 * @group integration
 */

import { describe, it, expect, beforeEach } from "vitest";
import { sendInitialPrompt, type SdkClientFactory } from "./initial-prompt";
import type { Logger } from "../logging";

/**
 * Mock model type for tests.
 */
interface MockModel {
  providerID: string;
  modelID: string;
}

/**
 * Mock session stored in the behavioral mock.
 */
interface MockSession {
  id: string;
  prompts: Array<{ text: string; agent?: string; model?: MockModel }>;
}

/**
 * Behavioral mock of the OpenCode SDK.
 * Tracks state (sessions and prompts) rather than call counts.
 */
class MockSdkClient {
  sessions = new Map<string, MockSession>();
  private sessionCounter = 0;
  private shouldThrow = false;
  private errorMessage = "";

  /**
   * Configure the mock to throw errors.
   */
  setError(message: string): void {
    this.shouldThrow = true;
    this.errorMessage = message;
  }

  /**
   * SDK session namespace.
   */
  session = {
    create: async () => {
      if (this.shouldThrow) {
        throw new Error(this.errorMessage);
      }

      const id = `session-${++this.sessionCounter}`;
      const session: MockSession = { id, prompts: [] };
      this.sessions.set(id, session);
      return { data: { id } };
    },

    prompt: async (args: {
      path: { id: string };
      body: {
        agent?: string;
        model?: MockModel;
        parts: Array<{ type: string; text: string }>;
      };
    }) => {
      if (this.shouldThrow) {
        throw new Error(this.errorMessage);
      }

      const session = this.sessions.get(args.path.id);
      if (!session) {
        throw new Error(`Session not found: ${args.path.id}`);
      }

      // Extract text from parts
      const textPart = args.body.parts.find((p) => p.type === "text");
      if (!textPart) {
        throw new Error("No text part in prompt");
      }

      // Store the prompt with optional agent and model
      const promptEntry: { text: string; agent?: string; model?: MockModel } = {
        text: textPart.text,
      };
      if (args.body.agent !== undefined) {
        promptEntry.agent = args.body.agent;
      }
      if (args.body.model !== undefined) {
        promptEntry.model = args.body.model;
      }
      session.prompts.push(promptEntry);

      return { data: { id: `message-${session.prompts.length}` } };
    },
  };
}

/**
 * Log entry tracked by mock logger.
 */
interface LogEntry {
  level: string;
  message: string;
  context: object | null;
}

/**
 * Create a mock logger that tracks calls.
 */
function createMockLogger(): Logger & { calls: LogEntry[] } {
  const calls: LogEntry[] = [];

  const log =
    (level: string) =>
    (message: string, context?: object): void => {
      calls.push({ level, message, context: context ?? null });
    };

  return {
    silly: log("silly"),
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    calls,
  };
}

describe("sendInitialPrompt", () => {
  let mockSdk: MockSdkClient;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let sdkFactory: SdkClientFactory;

  beforeEach(() => {
    mockSdk = new MockSdkClient();
    mockLogger = createMockLogger();
    sdkFactory = () => mockSdk as unknown as ReturnType<SdkClientFactory>;
  });

  it("creates session and sends prompt", async () => {
    await sendInitialPrompt(12345, "Hello, world!", undefined, undefined, mockLogger, sdkFactory);

    // Verify session was created
    expect(mockSdk.sessions.size).toBe(1);

    // Verify prompt was sent to the session
    const session = mockSdk.sessions.get("session-1");
    if (!session) throw new Error("Session not created");

    expect(session.prompts).toHaveLength(1);
    expect(session.prompts[0]?.text).toBe("Hello, world!");
    expect(session.prompts[0]?.agent).toBeUndefined();
    expect(session.prompts[0]?.model).toBeUndefined();
  });

  it("includes agent in prompt when provided", async () => {
    await sendInitialPrompt(12345, "Build the feature", "build", undefined, mockLogger, sdkFactory);

    // Verify session was created and prompt includes agent
    const session = mockSdk.sessions.get("session-1");
    if (!session) throw new Error("Session not created");

    expect(session.prompts).toHaveLength(1);
    expect(session.prompts[0]?.text).toBe("Build the feature");
    expect(session.prompts[0]?.agent).toBe("build");
  });

  it("includes model in prompt when provided", async () => {
    const model = { providerID: "anthropic", modelID: "claude-sonnet" };
    await sendInitialPrompt(12345, "Use this model", undefined, model, mockLogger, sdkFactory);

    // Verify session was created and prompt includes model
    const session = mockSdk.sessions.get("session-1");
    if (!session) throw new Error("Session not created");

    expect(session.prompts).toHaveLength(1);
    expect(session.prompts[0]?.text).toBe("Use this model");
    expect(session.prompts[0]?.model).toEqual(model);
  });

  it("includes both agent and model when provided", async () => {
    const model = { providerID: "openai", modelID: "gpt-4" };
    await sendInitialPrompt(12345, "With both", "code", model, mockLogger, sdkFactory);

    // Verify session was created and prompt includes both
    const session = mockSdk.sessions.get("session-1");
    if (!session) throw new Error("Session not created");

    expect(session.prompts).toHaveLength(1);
    expect(session.prompts[0]?.agent).toBe("code");
    expect(session.prompts[0]?.model).toEqual(model);
  });

  it("omits agent in prompt when not provided", async () => {
    await sendInitialPrompt(12345, "Simple prompt", undefined, undefined, mockLogger, sdkFactory);

    const session = mockSdk.sessions.get("session-1");
    if (!session) throw new Error("Session not created");

    expect(session.prompts[0]?.agent).toBeUndefined();
  });

  it("logs error without throwing when SDK fails", async () => {
    mockSdk.setError("Connection refused");

    // Should not throw
    await expect(
      sendInitialPrompt(12345, "This will fail", undefined, undefined, mockLogger, sdkFactory)
    ).resolves.toBeUndefined();

    // Verify error was logged
    const errorLogs = mockLogger.calls.filter((c) => c.level === "error");
    expect(errorLogs).toHaveLength(1);
    const errorLog = errorLogs[0];
    if (!errorLog) throw new Error("No error log found");

    expect(errorLog.message).toContain("Failed to send initial prompt");
    expect(errorLog.context).toMatchObject({
      port: 12345,
      error: "Connection refused",
    });
  });

  it("logs success with session info", async () => {
    await sendInitialPrompt(12345, "Test prompt", "code", undefined, mockLogger, sdkFactory);

    // Verify success was logged
    const infoLogs = mockLogger.calls.filter((c) => c.level === "info");
    expect(infoLogs).toHaveLength(1);
    const infoLog = infoLogs[0];
    if (!infoLog) throw new Error("No info log found");

    expect(infoLog.message).toBe("Initial prompt sent");
    expect(infoLog.context).toMatchObject({
      port: 12345,
      sessionId: "session-1",
      promptLength: 11,
      agent: "code",
    });
  });

  it("logs model in success message when provided", async () => {
    const model = { providerID: "anthropic", modelID: "claude-sonnet" };
    await sendInitialPrompt(12345, "Test prompt", undefined, model, mockLogger, sdkFactory);

    const infoLogs = mockLogger.calls.filter((c) => c.level === "info");
    expect(infoLogs).toHaveLength(1);
    const infoLog = infoLogs[0];
    if (!infoLog) throw new Error("No info log found");

    expect(infoLog.context).toMatchObject({
      model: "anthropic/claude-sonnet",
    });
  });
});
