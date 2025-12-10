// @vitest-environment node
/**
 * Tests for OpenCodeClient.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenCodeClient } from "./opencode-client";
import type { SessionStatus } from "./types";

// Mock the eventsource package
vi.mock("eventsource", () => {
  const mockEventSource = vi.fn().mockImplementation(() => ({
    close: vi.fn(),
    addEventListener: vi.fn(),
    onopen: null,
    onerror: null,
    onmessage: null,
  }));
  return { EventSource: mockEventSource };
});

describe("OpenCodeClient", () => {
  let client: OpenCodeClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    client?.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("getSessionStatuses", () => {
    it("returns session statuses on successful fetch", async () => {
      // First call returns session list (for root session identification)
      // Second call returns session statuses
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              { id: "session-1", directory: "/test", title: "Test 1" },
              { id: "session-2", directory: "/test", title: "Test 2" },
            ]),
            { status: 200 }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              { id: "session-1", status: "idle" },
              { id: "session-2", status: "busy" },
            ]),
            { status: 200 }
          )
        );

      client = new OpenCodeClient(8080);
      // First fetch root sessions to register them
      await client.fetchRootSessions();
      const result = await client.getSessionStatuses();

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]).toEqual({ type: "idle", sessionId: "session-1" });
        expect(result.value[1]).toEqual({ type: "busy", sessionId: "session-2" });
      }
    });

    it("filters out child sessions from statuses", async () => {
      // Session list has a parent and child session
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              { id: "parent-1", directory: "/test", title: "Parent" },
              { id: "child-1", directory: "/test", title: "Child", parentID: "parent-1" },
            ]),
            { status: 200 }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              { id: "parent-1", status: "idle" },
              { id: "child-1", status: "busy" },
            ]),
            { status: 200 }
          )
        );

      client = new OpenCodeClient(8080);
      await client.fetchRootSessions();
      const result = await client.getSessionStatuses();

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Only parent session should be returned
        expect(result.value).toHaveLength(1);
        expect(result.value[0]).toEqual({ type: "idle", sessionId: "parent-1" });
      }
    });

    it("uses correct URL", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

      client = new OpenCodeClient(3000);
      await client.getSessionStatuses();

      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:3000/session/status",
        expect.any(Object)
      );
    });

    it("returns error on timeout", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("Aborted", "AbortError"));

      client = new OpenCodeClient(8080);
      const result = await client.getSessionStatuses();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("timeout");
      }
    });

    it("returns error on malformed JSON", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not json", { status: 200 }));

      client = new OpenCodeClient(8080);
      const result = await client.getSessionStatuses();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("Invalid");
      }
    });

    it("returns error on invalid structure", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ wrong: "structure" }), { status: 200 })
      );

      client = new OpenCodeClient(8080);
      const result = await client.getSessionStatuses();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("Invalid");
      }
    });
  });

  describe("event handling", () => {
    it("emits session.status events for root sessions", async () => {
      // Register root session first
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: "test-session", directory: "/test", title: "Test" }]), {
          status: 200,
        })
      );

      const listener = vi.fn();
      client = new OpenCodeClient(8080);
      await client.fetchRootSessions();
      client.onSessionEvent(listener);

      // Simulate receiving an SSE event via the internal handler
      const event: SessionStatus = { type: "busy", sessionId: "test-session" };
      client["emitSessionEvent"](event);

      expect(listener).toHaveBeenCalledWith(event);
    });

    it("does not emit events for child sessions", async () => {
      // Register parent as root, child has parentID
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: "parent-session", directory: "/test", title: "Parent" },
            { id: "child-session", directory: "/test", title: "Child", parentID: "parent-session" },
          ]),
          { status: 200 }
        )
      );

      const listener = vi.fn();
      client = new OpenCodeClient(8080);
      await client.fetchRootSessions();
      client.onSessionEvent(listener);

      // Try to emit event for child session
      const childEvent: SessionStatus = { type: "busy", sessionId: "child-session" };
      client["emitSessionEvent"](childEvent);

      // Should not be called for child session
      expect(listener).not.toHaveBeenCalled();

      // But should be called for parent session
      const parentEvent: SessionStatus = { type: "idle", sessionId: "parent-session" };
      client["emitSessionEvent"](parentEvent);
      expect(listener).toHaveBeenCalledWith(parentEvent);
    });

    it("emits session.deleted events and removes from root set", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: "test-session", directory: "/test", title: "Test" }]), {
          status: 200,
        })
      );

      const listener = vi.fn();
      client = new OpenCodeClient(8080);
      await client.fetchRootSessions();
      client.onSessionEvent(listener);

      const event: SessionStatus = { type: "deleted", sessionId: "test-session" };
      client["emitSessionEvent"](event);

      expect(listener).toHaveBeenCalledWith(event);
      // After deletion, the session should be removed from root set
      expect(client.isRootSession("test-session")).toBe(false);
    });

    it("emits session.idle events for root sessions", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: "test-session", directory: "/test", title: "Test" }]), {
          status: 200,
        })
      );

      const listener = vi.fn();
      client = new OpenCodeClient(8080);
      await client.fetchRootSessions();
      client.onSessionEvent(listener);

      const event: SessionStatus = { type: "idle", sessionId: "test-session" };
      client["emitSessionEvent"](event);

      expect(listener).toHaveBeenCalledWith(event);
    });

    it("returns unsubscribe function", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: "test-session", directory: "/test", title: "Test" }]), {
          status: 200,
        })
      );

      const listener = vi.fn();
      client = new OpenCodeClient(8080);
      await client.fetchRootSessions();
      const unsubscribe = client.onSessionEvent(listener);

      unsubscribe();

      const event: SessionStatus = { type: "idle", sessionId: "test-session" };
      client["emitSessionEvent"](event);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("lifecycle", () => {
    it("can be disposed", () => {
      client = new OpenCodeClient(8080);
      expect(() => client.dispose()).not.toThrow();
    });

    it("clears listeners on dispose", () => {
      const listener = vi.fn();
      client = new OpenCodeClient(8080);
      client.onSessionEvent(listener);

      client.dispose();

      const event: SessionStatus = { type: "idle", sessionId: "test-session" };
      client["emitSessionEvent"](event);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("fetchRootSessions", () => {
    it("returns only root sessions", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: "root-1", directory: "/test", title: "Root 1" },
            { id: "child-1", directory: "/test", title: "Child", parentID: "root-1" },
            { id: "root-2", directory: "/test", title: "Root 2" },
          ]),
          { status: 200 }
        )
      );

      client = new OpenCodeClient(8080);
      const result = await client.fetchRootSessions();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value.map((s) => s.id)).toEqual(["root-1", "root-2"]);
      }
    });

    it("registers root sessions for filtering", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: "root-1", directory: "/test", title: "Root" },
            { id: "child-1", directory: "/test", title: "Child", parentID: "root-1" },
          ]),
          { status: 200 }
        )
      );

      client = new OpenCodeClient(8080);
      await client.fetchRootSessions();

      expect(client.isRootSession("root-1")).toBe(true);
      expect(client.isRootSession("child-1")).toBe(false);
    });

    it("returns error on invalid response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ wrong: "structure" }), { status: 200 })
      );

      client = new OpenCodeClient(8080);
      const result = await client.fetchRootSessions();

      expect(result.ok).toBe(false);
    });
  });

  describe("handleSessionCreated", () => {
    it("adds new root session to tracking set", async () => {
      // Initialize with empty session list
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 })
      );

      const listener = vi.fn();
      client = new OpenCodeClient(8080);
      await client.fetchRootSessions();
      client.onSessionEvent(listener);

      // Simulate session.created event for root session
      client["handleSessionCreated"](JSON.stringify({ info: { id: "new-root", title: "New" } }));

      expect(client.isRootSession("new-root")).toBe(true);
      // Should emit idle status for new root session
      expect(listener).toHaveBeenCalledWith({ type: "idle", sessionId: "new-root" });
    });

    it("does not add child session to tracking set", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 })
      );

      const listener = vi.fn();
      client = new OpenCodeClient(8080);
      await client.fetchRootSessions();
      client.onSessionEvent(listener);

      // Simulate session.created event for child session
      client["handleSessionCreated"](
        JSON.stringify({ info: { id: "new-child", title: "Child", parentID: "some-parent" } })
      );

      expect(client.isRootSession("new-child")).toBe(false);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("parseSSEEvent", () => {
    it("parses session.status event", () => {
      client = new OpenCodeClient(8080);
      const result = client["parseSSEEvent"]("session.status", '{"id":"s1","status":"busy"}');

      expect(result).toEqual({ type: "busy", sessionId: "s1" });
    });

    it("parses session.idle event", () => {
      client = new OpenCodeClient(8080);
      const result = client["parseSSEEvent"]("session.idle", '{"id":"s1"}');

      expect(result).toEqual({ type: "idle", sessionId: "s1" });
    });

    it("parses session.deleted event", () => {
      client = new OpenCodeClient(8080);
      const result = client["parseSSEEvent"]("session.deleted", '{"id":"s1"}');

      expect(result).toEqual({ type: "deleted", sessionId: "s1" });
    });

    it("returns null for unknown event types", () => {
      client = new OpenCodeClient(8080);
      const result = client["parseSSEEvent"]("unknown.event", '{"id":"s1"}');

      expect(result).toBeNull();
    });

    it("returns null for malformed JSON", () => {
      client = new OpenCodeClient(8080);
      const result = client["parseSSEEvent"]("session.status", "not json");

      expect(result).toBeNull();
    });
  });
});
