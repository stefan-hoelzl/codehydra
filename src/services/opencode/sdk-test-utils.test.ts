// @vitest-environment node
/**
 * Tests for SDK mock utilities.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createMockSdkClient,
  createMockSdkFactory,
  createMockEventStream,
  createEmptyEventStream,
  createControllableEventStream,
  createTestSession,
  createSessionStatusEvent,
  createSessionCreatedEvent,
  createSessionIdleEvent,
  createSessionDeletedEvent,
  createPermissionUpdatedEvent,
  createPermissionRepliedEvent,
} from "./sdk-test-utils";
import type { Event, Session } from "@opencode-ai/sdk";

describe("createMockSdkClient", () => {
  it("returns client with session.list() returning provided sessions", async () => {
    const sessions: Session[] = [
      createTestSession({ id: "ses-1", directory: "/test1" }),
      createTestSession({ id: "ses-2", directory: "/test2" }),
    ];

    const client = createMockSdkClient({ sessions });
    const result = await client.session.list();

    expect(result.data).toEqual(sessions);
  });

  it("returns client with session.list() returning empty array by default", async () => {
    const client = createMockSdkClient();
    const result = await client.session.list();

    expect(result.data).toEqual([]);
  });

  it("returns client with session.list() that throws when configured", async () => {
    const error = new Error("Network error");
    const client = createMockSdkClient({ throwOnSessionList: error });

    await expect(client.session.list()).rejects.toThrow("Network error");
  });

  it("returns client with session.status() returning provided statuses", async () => {
    const statuses = {
      "ses-1": { type: "busy" as const },
      "ses-2": { type: "idle" as const },
    };

    const client = createMockSdkClient({ sessionStatuses: statuses });
    const result = await client.session.status();

    expect(result.data).toEqual(statuses);
  });

  it("returns client with session.status() that throws when configured", async () => {
    const error = new Error("Status error");
    const client = createMockSdkClient({ throwOnSessionStatus: error });

    await expect(client.session.status()).rejects.toThrow("Status error");
  });

  it("returns client with event.subscribe() returning provided stream", async () => {
    const events: Event[] = [
      createSessionStatusEvent("ses-1", { type: "busy" }),
      createSessionStatusEvent("ses-1", { type: "idle" }),
    ];
    const eventStream = createMockEventStream(events);

    const client = createMockSdkClient({ eventStream });
    const result = await client.event.subscribe();

    const receivedEvents: Event[] = [];
    for await (const event of result.stream) {
      receivedEvents.push(event);
    }

    expect(receivedEvents).toEqual(events);
  });

  it("returns client with event.subscribe() that throws when configured", async () => {
    const error = new Error("Subscribe error");
    const client = createMockSdkClient({ throwOnSubscribe: error });

    await expect(client.event.subscribe()).rejects.toThrow("Subscribe error");
  });

  it("methods are spied functions", async () => {
    const client = createMockSdkClient();

    await client.session.list();
    await client.session.status();

    expect(vi.isMockFunction(client.session.list)).toBe(true);
    expect(vi.isMockFunction(client.session.status)).toBe(true);
    expect(vi.isMockFunction(client.event.subscribe)).toBe(true);
    expect(client.session.list).toHaveBeenCalledTimes(1);
    expect(client.session.status).toHaveBeenCalledTimes(1);
  });
});

describe("createMockSdkFactory", () => {
  it("returns factory that creates the mock client", () => {
    const mockClient = createMockSdkClient();
    const factory = createMockSdkFactory(mockClient);

    const result = factory("http://localhost:8080");

    expect(result).toBe(mockClient);
    expect(factory).toHaveBeenCalledWith("http://localhost:8080");
  });
});

describe("createMockEventStream", () => {
  it("yields events in order", async () => {
    const events: Event[] = [
      createSessionStatusEvent("ses-1", { type: "busy" }),
      createSessionIdleEvent("ses-1"),
    ];

    const stream = createMockEventStream(events);
    const received: Event[] = [];

    for await (const event of stream) {
      received.push(event);
    }

    expect(received).toEqual(events);
  });

  it("yields empty stream for empty array", async () => {
    const stream = createMockEventStream([]);
    const received: Event[] = [];

    for await (const event of stream) {
      received.push(event);
    }

    expect(received).toEqual([]);
  });
});

describe("createEmptyEventStream", () => {
  it("creates a stream that never yields", async () => {
    const stream = createEmptyEventStream();
    const iterator = stream[Symbol.asyncIterator]();

    // The next() call should never resolve
    let resolved = false;
    const promise = iterator.next().then(() => {
      resolved = true;
    });

    // Give it a moment to potentially resolve
    await new Promise((r) => setTimeout(r, 10));

    expect(resolved).toBe(false);

    // Clean up by not awaiting the promise
    void promise;
  });
});

describe("createControllableEventStream", () => {
  it("allows pushing events that are yielded", async () => {
    const { stream, pushEvent, complete } = createControllableEventStream();

    const events: Event[] = [];
    const consumer = (async () => {
      for await (const event of stream) {
        events.push(event);
      }
    })();

    pushEvent(createSessionStatusEvent("ses-1", { type: "busy" }));
    pushEvent(createSessionIdleEvent("ses-1"));

    // Give consumer time to process
    await new Promise((r) => setTimeout(r, 10));

    complete();
    await consumer;

    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("session.status");
    expect(events[1]?.type).toBe("session.idle");
  });

  it("completes the stream when complete() is called", async () => {
    const { stream, complete } = createControllableEventStream();

    let done = false;
    const consumer = (async () => {
      for await (const _event of stream) {
        // No events expected - this loop should never execute
        void _event;
      }
      done = true;
    })();

    complete();
    await consumer;

    expect(done).toBe(true);
  });

  it("rejects pending read when error() is called", async () => {
    const { stream, error } = createControllableEventStream();

    const iterator = stream[Symbol.asyncIterator]();
    const nextPromise = iterator.next();

    error(new Error("Stream error"));

    await expect(nextPromise).rejects.toThrow("Stream error");
  });

  it("queues events before consumer reads", async () => {
    const { stream, pushEvent, complete } = createControllableEventStream();

    // Push events before consuming
    pushEvent(createSessionStatusEvent("ses-1", { type: "busy" }));
    pushEvent(createSessionStatusEvent("ses-2", { type: "idle" }));
    complete();

    // Now consume
    const events: Event[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
  });
});

describe("createTestSession", () => {
  it("creates session with defaults", () => {
    const session = createTestSession();

    expect(session.id).toBe("ses-test");
    expect(session.directory).toBe("/test/workspace");
    expect(session.title).toBe("Test Session");
    expect(session.version).toBe("1");
    expect(session.time.created).toBeDefined();
    expect(session.time.updated).toBeDefined();
  });

  it("allows overriding properties", () => {
    const session = createTestSession({
      id: "ses-custom",
      directory: "/custom/path",
      parentID: "parent-1",
    });

    expect(session.id).toBe("ses-custom");
    expect(session.directory).toBe("/custom/path");
    expect(session.parentID).toBe("parent-1");
    expect(session.title).toBe("Test Session"); // Default preserved
  });
});

describe("createSessionStatusEvent", () => {
  it("creates busy status event", () => {
    const event = createSessionStatusEvent("ses-123", { type: "busy" });

    expect(event.type).toBe("session.status");
    expect(event.properties.sessionID).toBe("ses-123");
    expect(event.properties.status).toEqual({ type: "busy" });
  });

  it("creates idle status event", () => {
    const event = createSessionStatusEvent("ses-456", { type: "idle" });

    expect(event.type).toBe("session.status");
    expect(event.properties.status).toEqual({ type: "idle" });
  });

  it("creates retry status event", () => {
    const event = createSessionStatusEvent("ses-789", {
      type: "retry",
      attempt: 2,
      message: "Rate limited",
      next: Date.now() + 1000,
    });

    expect(event.type).toBe("session.status");
    expect(event.properties.status.type).toBe("retry");
  });
});

describe("createSessionCreatedEvent", () => {
  it("creates session.created event with session info", () => {
    const session = createTestSession({ id: "new-session" });
    const event = createSessionCreatedEvent(session);

    expect(event.type).toBe("session.created");
    expect(event.properties.info).toBe(session);
  });
});

describe("createSessionIdleEvent", () => {
  it("creates session.idle event", () => {
    const event = createSessionIdleEvent("ses-123");

    expect(event.type).toBe("session.idle");
    expect(event.properties.sessionID).toBe("ses-123");
  });
});

describe("createSessionDeletedEvent", () => {
  it("creates session.deleted event with session info", () => {
    const session = createTestSession({ id: "deleted-session" });
    const event = createSessionDeletedEvent(session);

    expect(event.type).toBe("session.deleted");
    expect(event.properties.info).toBe(session);
  });
});

describe("createPermissionUpdatedEvent", () => {
  it("creates permission.updated event", () => {
    const event = createPermissionUpdatedEvent({
      id: "perm-123",
      sessionID: "ses-456",
      type: "bash",
      title: "Run shell command",
    });

    expect(event.type).toBe("permission.updated");
    expect(event.properties.id).toBe("perm-123");
    expect(event.properties.sessionID).toBe("ses-456");
    expect(event.properties.type).toBe("bash");
    expect(event.properties.title).toBe("Run shell command");
    expect(event.properties.metadata).toBeDefined();
    expect(event.properties.time).toBeDefined();
  });
});

describe("createPermissionRepliedEvent", () => {
  it("creates permission.replied event with once response", () => {
    const event = createPermissionRepliedEvent("ses-123", "perm-456", "once");

    expect(event.type).toBe("permission.replied");
    expect(event.properties.sessionID).toBe("ses-123");
    expect(event.properties.permissionID).toBe("perm-456");
    expect(event.properties.response).toBe("once");
  });

  it("creates permission.replied event with always response", () => {
    const event = createPermissionRepliedEvent("ses-123", "perm-456", "always");

    expect(event.properties.response).toBe("always");
  });

  it("creates permission.replied event with reject response", () => {
    const event = createPermissionRepliedEvent("ses-123", "perm-456", "reject");

    expect(event.properties.response).toBe("reject");
  });
});
