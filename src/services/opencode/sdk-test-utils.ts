/**
 * SDK mock utilities for testing OpenCodeClient.
 *
 * Provides mock factories for the @opencode-ai/sdk client
 * to enable unit testing without real network calls.
 */

import { vi } from "vitest";
import type { OpencodeClient } from "@opencode-ai/sdk";
import type { Session, Event, SessionStatus as SdkSessionStatus } from "@opencode-ai/sdk";

/**
 * SDK event types we use in tests.
 * Re-exported from SDK for convenience.
 */
export type { Session, Event, SdkSessionStatus };

/**
 * Options for creating a mock SDK client.
 */
export interface MockSdkClientOptions {
  /** Sessions to return from session.list() */
  readonly sessions?: Session[];
  /** Session statuses to return from session.status() */
  readonly sessionStatuses?: Record<string, SdkSessionStatus>;
  /** Async iterable of events for event.subscribe() */
  readonly eventStream?: AsyncIterable<Event>;
  /** Error to throw when calling event.subscribe() */
  readonly throwOnSubscribe?: Error;
  /** Error to throw when calling session.list() */
  readonly throwOnSessionList?: Error;
  /** Error to throw when calling session.status() */
  readonly throwOnSessionStatus?: Error;
}

/**
 * Type for the SDK client factory function.
 * Used for dependency injection in OpenCodeClient.
 */
export type SdkClientFactory = (baseUrl: string) => OpencodeClient;

/**
 * Create a mock SDK client for testing.
 *
 * @param options - Configuration for mock behavior
 * @returns Mock OpencodeClient with spied methods
 *
 * @example Basic usage
 * ```ts
 * const mockClient = createMockSdkClient({
 *   sessions: [{ id: 'ses-1', directory: '/test', ... }]
 * });
 * ```
 *
 * @example With event stream
 * ```ts
 * const events = createMockEventStream([
 *   { type: 'session.status', properties: { sessionID: 'ses-1', status: { type: 'busy' } } }
 * ]);
 * const mockClient = createMockSdkClient({ eventStream: events });
 * ```
 */
export function createMockSdkClient(options: MockSdkClientOptions = {}): OpencodeClient {
  const {
    sessions = [],
    sessionStatuses = {},
    eventStream = createEmptyEventStream(),
    throwOnSubscribe,
    throwOnSessionList,
    throwOnSessionStatus,
  } = options;

  // Create mock session namespace
  const mockSession = {
    list: throwOnSessionList
      ? vi.fn().mockRejectedValue(throwOnSessionList)
      : vi.fn().mockResolvedValue({ data: sessions }),
    status: throwOnSessionStatus
      ? vi.fn().mockRejectedValue(throwOnSessionStatus)
      : vi.fn().mockResolvedValue({ data: sessionStatuses }),
    get: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
    children: vi.fn(),
    todo: vi.fn(),
    init: vi.fn(),
    fork: vi.fn(),
    abort: vi.fn(),
    unshare: vi.fn(),
    share: vi.fn(),
    diff: vi.fn(),
    summarize: vi.fn(),
    messages: vi.fn(),
    prompt: vi.fn(),
    message: vi.fn(),
    promptAsync: vi.fn(),
    command: vi.fn(),
    shell: vi.fn(),
    revert: vi.fn(),
    unrevert: vi.fn(),
  };

  // Create mock event namespace
  const mockEvent = {
    subscribe: throwOnSubscribe
      ? vi.fn().mockRejectedValue(throwOnSubscribe)
      : vi.fn().mockResolvedValue({ stream: eventStream }),
  };

  // Return partial mock with only the namespaces we use
  return {
    session: mockSession,
    event: mockEvent,
    // Add other namespaces as empty objects since we don't use them
    global: {},
    project: {},
    pty: {},
    config: {},
    tool: {},
    instance: {},
    path: {},
    vcs: {},
    command: {},
    provider: {},
    find: {},
    file: {},
    app: {},
    mcp: {},
    lsp: {},
    formatter: {},
    tui: {},
    auth: {},
    postSessionIdPermissionsPermissionId: vi.fn(),
  } as unknown as OpencodeClient;
}

/**
 * Create a mock factory that returns the provided mock client.
 *
 * @param mockClient - The mock client to return
 * @returns Factory function suitable for DI
 *
 * @example
 * ```ts
 * const mockClient = createMockSdkClient({ sessions: [...] });
 * const factory = createMockSdkFactory(mockClient);
 * const client = new OpenCodeClient(8080, factory);
 * ```
 */
export function createMockSdkFactory(mockClient: OpencodeClient): SdkClientFactory {
  return vi.fn().mockReturnValue(mockClient);
}

/**
 * Create a mock async event stream from an array of events.
 *
 * Events are yielded immediately in sequence.
 * The stream completes after all events are yielded.
 *
 * @param events - Array of events to yield
 * @returns Async iterable that yields the events
 *
 * @example
 * ```ts
 * const stream = createMockEventStream([
 *   { type: 'session.status', properties: { sessionID: 'ses-1', status: { type: 'idle' } } },
 *   { type: 'session.status', properties: { sessionID: 'ses-1', status: { type: 'busy' } } },
 * ]);
 *
 * for await (const event of stream) {
 *   console.log(event.type);
 * }
 * ```
 */
export async function* createMockEventStream(events: Event[]): AsyncIterable<Event> {
  for (const event of events) {
    yield event;
  }
}

/**
 * Create an empty event stream that never yields any events.
 *
 * The stream never completes - useful for testing connection
 * lifecycle without processing events.
 *
 * @returns Async iterable that never yields
 */
export function createEmptyEventStream(): AsyncIterable<Event> {
  return {
    [Symbol.asyncIterator]: () => ({
      // Never resolves - simulates an open connection
      next: () => new Promise<IteratorResult<Event>>(() => {}),
    }),
  };
}

/**
 * Create a controllable event stream for testing.
 *
 * Returns an object with methods to push events and complete the stream.
 * Useful for testing event handling in a controlled manner.
 *
 * @returns Object with stream and control methods
 *
 * @example
 * ```ts
 * const { stream, pushEvent, complete, error } = createControllableEventStream();
 *
 * // Start consuming the stream
 * const events: Event[] = [];
 * const consumer = (async () => {
 *   for await (const event of stream) {
 *     events.push(event);
 *   }
 * })();
 *
 * // Push events from test
 * pushEvent({ type: 'session.status', properties: { ... } });
 *
 * // Complete the stream
 * complete();
 * await consumer;
 * ```
 */
export function createControllableEventStream(): {
  stream: AsyncIterable<Event>;
  pushEvent: (event: Event) => void;
  complete: () => void;
  error: (err: Error) => void;
} {
  // Queue of events and a resolver for pending reads
  const queue: Event[] = [];
  let pendingResolve: ((result: IteratorResult<Event>) => void) | null = null;
  let pendingReject: ((error: Error) => void) | null = null;
  let done = false;
  let streamError: Error | null = null;

  const stream: AsyncIterable<Event> = {
    [Symbol.asyncIterator]: () => ({
      next: () => {
        // If there's an error, reject immediately
        if (streamError) {
          return Promise.reject(streamError);
        }

        // If there are queued events, return the next one
        if (queue.length > 0) {
          return Promise.resolve({ value: queue.shift()!, done: false });
        }

        // If done, return done
        if (done) {
          return Promise.resolve({ value: undefined, done: true });
        }

        // Otherwise, wait for the next event
        return new Promise((resolve, reject) => {
          pendingResolve = resolve;
          pendingReject = reject;
        });
      },
    }),
  };

  return {
    stream,
    pushEvent: (event: Event) => {
      if (pendingResolve) {
        const resolve = pendingResolve;
        pendingResolve = null;
        pendingReject = null;
        resolve({ value: event, done: false });
      } else {
        queue.push(event);
      }
    },
    complete: () => {
      done = true;
      if (pendingResolve) {
        const resolve = pendingResolve;
        pendingResolve = null;
        pendingReject = null;
        resolve({ value: undefined, done: true });
      }
    },
    error: (err: Error) => {
      streamError = err;
      if (pendingReject) {
        const reject = pendingReject;
        pendingResolve = null;
        pendingReject = null;
        reject(err);
      }
    },
  };
}

/**
 * Helper to create a session object for tests.
 */
export function createTestSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "ses-test",
    projectID: "proj-1",
    directory: "/test/workspace",
    title: "Test Session",
    version: "1",
    time: {
      created: Date.now(),
      updated: Date.now(),
    },
    ...overrides,
  };
}

/**
 * Helper to create session status event.
 */
export function createSessionStatusEvent(
  sessionID: string,
  status: SdkSessionStatus
): Event & { type: "session.status" } {
  return {
    type: "session.status",
    properties: {
      sessionID,
      status,
    },
  };
}

/**
 * Helper to create session.created event.
 */
export function createSessionCreatedEvent(session: Session): Event & { type: "session.created" } {
  return {
    type: "session.created",
    properties: {
      info: session,
    },
  };
}

/**
 * Helper to create session.idle event.
 */
export function createSessionIdleEvent(sessionID: string): Event & { type: "session.idle" } {
  return {
    type: "session.idle",
    properties: {
      sessionID,
    },
  };
}

/**
 * Helper to create session.deleted event.
 */
export function createSessionDeletedEvent(session: Session): Event & { type: "session.deleted" } {
  return {
    type: "session.deleted",
    properties: {
      info: session,
    },
  };
}

/**
 * Helper to create permission.updated event.
 */
export function createPermissionUpdatedEvent(permission: {
  id: string;
  sessionID: string;
  type: string;
  title: string;
  messageID?: string;
}): Event & { type: "permission.updated" } {
  return {
    type: "permission.updated",
    properties: {
      id: permission.id,
      sessionID: permission.sessionID,
      type: permission.type,
      title: permission.title,
      messageID: permission.messageID ?? "msg-1",
      metadata: {},
      time: { created: Date.now() },
    },
  };
}

/**
 * Helper to create permission.replied event.
 */
export function createPermissionRepliedEvent(
  sessionID: string,
  permissionID: string,
  response: "once" | "always" | "reject"
): Event & { type: "permission.replied" } {
  return {
    type: "permission.replied",
    properties: {
      sessionID,
      permissionID,
      response,
    },
  };
}
