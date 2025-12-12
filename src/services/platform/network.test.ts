/**
 * Tests for network layer interfaces and implementation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DefaultNetworkLayer, type HttpClient } from "./network";

describe("DefaultNetworkLayer", () => {
  describe("HttpClient.fetch()", () => {
    let networkLayer: HttpClient;

    beforeEach(() => {
      networkLayer = new DefaultNetworkLayer();
    });

    it("fetch returns response on success", async () => {
      // This test requires a real server or mock fetch
      // For unit tests, we'll test the behavior with a mock
      const mockResponse = new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

      const response = await networkLayer.fetch("http://localhost:8080/test");

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);

      vi.restoreAllMocks();
    });

    it("fetch times out after specified timeout", async () => {
      // Use real timers with a very short timeout
      let abortTriggered = false;

      vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
        // Track if abort is triggered
        init?.signal?.addEventListener("abort", () => {
          abortTriggered = true;
        });

        // Wait longer than the timeout
        return new Promise<Response>((_, reject) => {
          setTimeout(() => {
            if (init?.signal?.aborted) {
              reject(new DOMException("Aborted", "AbortError"));
            }
          }, 200);
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      });

      await expect(
        networkLayer.fetch("http://localhost:8080/slow", { timeout: 50 })
      ).rejects.toThrow();

      expect(abortTriggered).toBe(true);

      vi.restoreAllMocks();
    });

    it("fetch uses default timeout when not specified", async () => {
      // Test that custom default timeout is applied
      const customLayer = new DefaultNetworkLayer({ defaultTimeout: 50 });
      let abortTriggered = false;

      vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
        init?.signal?.addEventListener("abort", () => {
          abortTriggered = true;
        });

        return new Promise<Response>((_, reject) => {
          setTimeout(() => {
            if (init?.signal?.aborted) {
              reject(new DOMException("Aborted", "AbortError"));
            }
          }, 200);
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      });

      // Should timeout using the custom default of 50ms
      await expect(customLayer.fetch("http://localhost:8080/slow")).rejects.toThrow();

      expect(abortTriggered).toBe(true);

      vi.restoreAllMocks();
    });

    it("fetch aborts when external signal is aborted", async () => {
      const controller = new AbortController();

      // Mock fetch to check the signal
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
        if (init?.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        // Wait for abort
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      });

      const resultPromise = networkLayer.fetch("http://localhost:8080/test", {
        signal: controller.signal,
      });

      // Abort the request
      controller.abort();

      await expect(resultPromise).rejects.toThrow();

      vi.restoreAllMocks();
    });

    it("fetch clears timeout on completion", async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
      const mockResponse = new Response("ok", { status: 200 });
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

      await networkLayer.fetch("http://localhost:8080/test");

      expect(clearTimeoutSpy).toHaveBeenCalled();

      vi.restoreAllMocks();
    });

    it("fetch clears timeout on error", async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));

      await expect(networkLayer.fetch("http://localhost:8080/test")).rejects.toThrow();

      expect(clearTimeoutSpy).toHaveBeenCalled();

      vi.restoreAllMocks();
    });

    it("fetch handles concurrent requests with independent signals", async () => {
      const responses: Response[] = [];
      let callCount = 0;

      vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        callCount++;
        return new Response(`response-${callCount}`, { status: 200 });
      });

      const [r1, r2, r3] = await Promise.all([
        networkLayer.fetch("http://localhost:8080/a"),
        networkLayer.fetch("http://localhost:8080/b"),
        networkLayer.fetch("http://localhost:8080/c"),
      ]);

      responses.push(r1, r2, r3);

      expect(responses).toHaveLength(3);
      expect(callCount).toBe(3);

      vi.restoreAllMocks();
    });

    it("fetch aborts immediately when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
        if (init?.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        return new Response("ok", { status: 200 });
      });

      await expect(
        networkLayer.fetch("http://localhost:8080/test", { signal: controller.signal })
      ).rejects.toThrow();

      vi.restoreAllMocks();
    });
  });
});
