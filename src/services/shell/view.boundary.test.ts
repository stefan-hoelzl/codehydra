/**
 * Boundary tests for ViewLayer using real Electron APIs.
 *
 * These tests verify the contract between DefaultViewLayer and Electron's WebContentsView.
 * They run with hidden windows to prevent visible windows.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DefaultViewLayer } from "./view";
import { DefaultWindowLayer } from "./window";
import { ShellError, isShellErrorWithCode } from "./errors";
import { SILENT_LOGGER } from "../logging";
import { createBehavioralImageLayer } from "../platform/image.test-utils";
import { createMockPlatformInfo } from "../platform/platform-info.test-utils";
import type { ViewHandle, WindowHandle } from "./types";

describe("ViewLayer (boundary)", () => {
  let viewLayer: DefaultViewLayer;
  let windowLayer: DefaultWindowLayer;
  let windowHandle: WindowHandle;
  let viewHandles: ViewHandle[];

  beforeEach(() => {
    const imageLayer = createBehavioralImageLayer();
    const platformInfo = createMockPlatformInfo();
    windowLayer = new DefaultWindowLayer(imageLayer, platformInfo, SILENT_LOGGER);
    viewLayer = new DefaultViewLayer(windowLayer, SILENT_LOGGER);
    viewHandles = [];

    // Create a hidden window for testing
    windowHandle = windowLayer.createWindow({ show: false });
  });

  afterEach(async () => {
    // Clean up views first
    for (const handle of viewHandles) {
      try {
        viewLayer.destroy(handle);
      } catch {
        // Ignore cleanup errors
      }
    }
    viewHandles = [];

    // Clean up window
    try {
      windowLayer.destroy(windowHandle);
    } catch {
      // Ignore cleanup errors
    }

    await viewLayer.dispose();
  });

  describe("createView", () => {
    it("creates a view with default options", () => {
      const handle = viewLayer.createView({});
      viewHandles.push(handle);

      expect(handle.id).toMatch(/^view-\d+$/);
      expect(handle.__brand).toBe("ViewHandle");
    });

    it("creates a view with background color", () => {
      const handle = viewLayer.createView({
        backgroundColor: "#ff0000",
      });
      viewHandles.push(handle);

      expect(handle.id).toMatch(/^view-\d+$/);
    });

    it("creates a view with web preferences", () => {
      const handle = viewLayer.createView({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          partition: "persist:test-partition",
        },
      });
      viewHandles.push(handle);

      expect(handle.id).toMatch(/^view-\d+$/);
    });
  });

  describe("destroy", () => {
    it("destroys an existing view", () => {
      const handle = viewLayer.createView({});

      expect(() => viewLayer.destroy(handle)).not.toThrow();
    });

    it("throws VIEW_NOT_FOUND for non-existent view", () => {
      const fakeHandle = { id: "view-999", __brand: "ViewHandle" as const };

      expect(() => viewLayer.destroy(fakeHandle)).toThrow(ShellError);
      try {
        viewLayer.destroy(fakeHandle);
      } catch (error) {
        expect(isShellErrorWithCode(error, "VIEW_NOT_FOUND")).toBe(true);
      }
    });
  });

  describe("loadURL", () => {
    it("loads a data URL", async () => {
      const handle = viewLayer.createView({});
      viewHandles.push(handle);

      await viewLayer.loadURL(handle, "data:text/html,<h1>Test</h1>");

      const url = viewLayer.getURL(handle);
      expect(url).toContain("data:text/html");
    });

    it("loads about:blank", async () => {
      const handle = viewLayer.createView({});
      viewHandles.push(handle);

      await viewLayer.loadURL(handle, "about:blank");

      const url = viewLayer.getURL(handle);
      expect(url).toBe("about:blank");
    });

    it("throws VIEW_NOT_FOUND for non-existent view", async () => {
      const fakeHandle = { id: "view-999", __brand: "ViewHandle" as const };

      await expect(viewLayer.loadURL(fakeHandle, "about:blank")).rejects.toThrow(ShellError);
    });
  });

  describe("bounds", () => {
    it("sets and gets bounds", () => {
      const handle = viewLayer.createView({});
      viewHandles.push(handle);
      const bounds = { x: 10, y: 20, width: 800, height: 600 };

      viewLayer.setBounds(handle, bounds);
      const result = viewLayer.getBounds(handle);

      expect(result).toEqual(bounds);
    });

    it("throws VIEW_NOT_FOUND for non-existent view", () => {
      const fakeHandle = { id: "view-999", __brand: "ViewHandle" as const };

      expect(() => viewLayer.getBounds(fakeHandle)).toThrow(ShellError);
    });
  });

  describe("setBackgroundColor", () => {
    it("sets background color without error", () => {
      const handle = viewLayer.createView({});
      viewHandles.push(handle);

      expect(() => {
        viewLayer.setBackgroundColor(handle, "#00ff00");
      }).not.toThrow();
    });
  });

  describe("focus", () => {
    it("focuses view without error", () => {
      const handle = viewLayer.createView({});
      viewHandles.push(handle);

      expect(() => viewLayer.focus(handle)).not.toThrow();
    });
  });

  describe("attachToWindow / detachFromWindow", () => {
    it("attaches view to window", () => {
      const handle = viewLayer.createView({});
      viewHandles.push(handle);

      expect(() => {
        viewLayer.attachToWindow(handle, windowHandle);
      }).not.toThrow();
    });

    it("detaches view from window", () => {
      const handle = viewLayer.createView({});
      viewHandles.push(handle);

      viewLayer.attachToWindow(handle, windowHandle);

      expect(() => {
        viewLayer.detachFromWindow(handle);
      }).not.toThrow();
    });

    it("attach is idempotent", () => {
      const handle = viewLayer.createView({});
      viewHandles.push(handle);

      viewLayer.attachToWindow(handle, windowHandle);
      viewLayer.attachToWindow(handle, windowHandle);

      // Should not throw
      expect(() => {
        viewLayer.detachFromWindow(handle);
      }).not.toThrow();
    });

    it("detach is idempotent", () => {
      const handle = viewLayer.createView({});
      viewHandles.push(handle);

      // Not attached - detach should be no-op
      expect(() => {
        viewLayer.detachFromWindow(handle);
      }).not.toThrow();
    });
  });

  describe("onDidFinishLoad", () => {
    it("registers callback without error", () => {
      const handle = viewLayer.createView({});
      viewHandles.push(handle);
      const callback = vi.fn();

      const unsubscribe = viewLayer.onDidFinishLoad(handle, callback);

      expect(typeof unsubscribe).toBe("function");
      unsubscribe();
    });
  });

  describe("onWillNavigate", () => {
    it("registers callback without error", () => {
      const handle = viewLayer.createView({});
      viewHandles.push(handle);
      const callback = vi.fn();

      const unsubscribe = viewLayer.onWillNavigate(handle, callback);

      expect(typeof unsubscribe).toBe("function");
      unsubscribe();
    });
  });

  describe("setWindowOpenHandler", () => {
    it("sets handler without error", () => {
      const handle = viewLayer.createView({});
      viewHandles.push(handle);

      expect(() => {
        viewLayer.setWindowOpenHandler(handle, () => ({ action: "deny" }));
      }).not.toThrow();
    });

    it("clears handler when passed null", () => {
      const handle = viewLayer.createView({});
      viewHandles.push(handle);

      viewLayer.setWindowOpenHandler(handle, () => ({ action: "deny" }));

      expect(() => {
        viewLayer.setWindowOpenHandler(handle, null);
      }).not.toThrow();
    });
  });

  describe("send", () => {
    it("sends IPC message without error", () => {
      const handle = viewLayer.createView({});
      viewHandles.push(handle);

      expect(() => {
        viewLayer.send(handle, "test-channel", { data: "test" });
      }).not.toThrow();
    });
  });

  describe("dispose", () => {
    it("disposes without error", async () => {
      viewLayer.createView({});
      viewLayer.createView({});

      await expect(viewLayer.dispose()).resolves.not.toThrow();
    });
  });
});
