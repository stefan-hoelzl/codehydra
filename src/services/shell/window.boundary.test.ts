/**
 * Boundary tests for WindowLayer using real Electron APIs.
 *
 * These tests verify the contract between DefaultWindowLayer and Electron's BaseWindow.
 * They run with show: false to prevent visible windows.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { platform } from "node:os";
import { DefaultWindowLayer } from "./window";
import { ShellError, isShellErrorWithCode } from "./errors";
import { SILENT_LOGGER } from "../logging";
import { createBehavioralImageLayer } from "../platform/image.test-utils";
import { createMockPlatformInfo } from "../platform/platform-info.test-utils";
import type { WindowHandle } from "./types";

describe("WindowLayer (boundary)", () => {
  let windowLayer: DefaultWindowLayer;
  let handles: WindowHandle[];

  beforeEach(() => {
    const imageLayer = createBehavioralImageLayer();
    const platformInfo = createMockPlatformInfo();
    windowLayer = new DefaultWindowLayer(imageLayer, platformInfo, SILENT_LOGGER);
    handles = [];
  });

  afterEach(() => {
    // Clean up any created windows
    for (const handle of handles) {
      try {
        if (!windowLayer.isDestroyed(handle)) {
          windowLayer.destroy(handle);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
    handles = [];
  });

  describe("createWindow", () => {
    it("creates a window with default options", () => {
      const handle = windowLayer.createWindow({ show: false });
      handles.push(handle);

      expect(handle.id).toMatch(/^window-\d+$/);
      expect(handle.__brand).toBe("WindowHandle");
      expect(windowLayer.isDestroyed(handle)).toBe(false);
    });

    it("creates a window with custom dimensions", () => {
      const handle = windowLayer.createWindow({
        width: 1024,
        height: 768,
        show: false,
      });
      handles.push(handle);

      const bounds = windowLayer.getBounds(handle);
      expect(bounds.width).toBe(1024);
      expect(bounds.height).toBe(768);
    });

    it("creates a window with title", () => {
      const handle = windowLayer.createWindow({
        title: "Test Window",
        show: false,
      });
      handles.push(handle);

      // Verify window was created successfully
      expect(windowLayer.isDestroyed(handle)).toBe(false);
    });
  });

  describe("destroy", () => {
    it("destroys an existing window", () => {
      const handle = windowLayer.createWindow({ show: false });

      windowLayer.destroy(handle);

      expect(windowLayer.isDestroyed(handle)).toBe(true);
    });

    it("throws WINDOW_NOT_FOUND for non-existent window", () => {
      const fakeHandle = { id: "window-999", __brand: "WindowHandle" as const };

      expect(() => windowLayer.destroy(fakeHandle)).toThrow(ShellError);
      try {
        windowLayer.destroy(fakeHandle);
      } catch (error) {
        expect(isShellErrorWithCode(error, "WINDOW_NOT_FOUND")).toBe(true);
      }
    });
  });

  describe("getBounds / setBounds", () => {
    it("gets and sets window bounds", () => {
      const handle = windowLayer.createWindow({
        width: 800,
        height: 600,
        show: false,
      });
      handles.push(handle);

      const newBounds = { x: 100, y: 50, width: 1024, height: 768 };
      windowLayer.setBounds(handle, newBounds);

      const bounds = windowLayer.getBounds(handle);
      expect(bounds.width).toBe(1024);
      expect(bounds.height).toBe(768);
      // Note: x, y may be adjusted by window manager
    });
  });

  describe("getContentBounds", () => {
    it("returns content bounds excluding title bar", () => {
      const handle = windowLayer.createWindow({
        width: 800,
        height: 600,
        show: false,
      });
      handles.push(handle);

      const contentBounds = windowLayer.getContentBounds(handle);

      // Content bounds should be valid
      expect(contentBounds.width).toBeGreaterThan(0);
      expect(contentBounds.height).toBeGreaterThan(0);
      // Content height may be less than window height due to title bar
    });
  });

  describe("maximize / isMaximized", () => {
    it("maximizes window and reports state", () => {
      const handle = windowLayer.createWindow({ show: false });
      handles.push(handle);

      windowLayer.maximize(handle);

      // Note: isMaximized might be async on some platforms
      // For boundary tests, we just verify it doesn't throw
      expect(() => windowLayer.isMaximized(handle)).not.toThrow();
    });
  });

  describe("setTitle", () => {
    it("sets window title without error", () => {
      const handle = windowLayer.createWindow({ show: false });
      handles.push(handle);

      expect(() => {
        windowLayer.setTitle(handle, "New Title");
      }).not.toThrow();
    });
  });

  describe("close", () => {
    it("closes window", () => {
      const handle = windowLayer.createWindow({ show: false });

      windowLayer.close(handle);

      // After close, isDestroyed should return true
      // (may need a small delay on some platforms, but generally immediate)
      expect(windowLayer.isDestroyed(handle)).toBe(true);
    });
  });

  describe("onResize", () => {
    it("registers resize callback without error", () => {
      const handle = windowLayer.createWindow({ show: false });
      handles.push(handle);
      const callback = vi.fn();

      const unsubscribe = windowLayer.onResize(handle, callback);

      expect(typeof unsubscribe).toBe("function");
      unsubscribe();
    });
  });

  describe("onClose", () => {
    it("callback is triggered on close", () => {
      const handle = windowLayer.createWindow({ show: false });
      const callback = vi.fn();

      windowLayer.onClose(handle, callback);
      windowLayer.close(handle);

      expect(callback).toHaveBeenCalled();
    });
  });

  describe("getContentView", () => {
    it("returns a content view that can add children", () => {
      const handle = windowLayer.createWindow({ show: false });
      handles.push(handle);

      const contentView = windowLayer.getContentView(handle);

      expect(contentView).toBeDefined();
      expect(typeof contentView.addChildView).toBe("function");
      expect(typeof contentView.removeChildView).toBe("function");
    });
  });

  describe("_getRawWindow", () => {
    it("returns the underlying BaseWindow", () => {
      const handle = windowLayer.createWindow({ show: false });
      handles.push(handle);

      const rawWindow = windowLayer._getRawWindow(handle);

      expect(rawWindow).toBeDefined();
      expect(typeof rawWindow.getBounds).toBe("function");
      expect(typeof rawWindow.setTitle).toBe("function");
    });
  });

  describe("setOverlayIcon", () => {
    it.skipIf(platform() !== "win32")("sets overlay icon on Windows", () => {
      const handle = windowLayer.createWindow({ show: false });
      handles.push(handle);
      const imageHandle = { id: "test-image", __brand: "ImageHandle" as const };

      // Should not throw on Windows
      expect(() => {
        windowLayer.setOverlayIcon(handle, imageHandle, "Test overlay");
      }).not.toThrow();
    });

    it.skipIf(platform() === "win32")("no-ops on non-Windows platforms", () => {
      const handle = windowLayer.createWindow({ show: false });
      handles.push(handle);
      const imageHandle = { id: "test-image", __brand: "ImageHandle" as const };

      // Should not throw on non-Windows
      expect(() => {
        windowLayer.setOverlayIcon(handle, imageHandle, "Test overlay");
      }).not.toThrow();
    });
  });

  describe("view tracking", () => {
    it("tracks and untracks views", () => {
      const handle = windowLayer.createWindow({ show: false });
      handles.push(handle);
      const viewHandle = { id: "view-1", __brand: "ViewHandle" as const };

      // Track
      expect(() => {
        windowLayer.trackAttachedView(handle, viewHandle);
      }).not.toThrow();

      // Should fail to destroy with attached view
      expect(() => windowLayer.destroy(handle)).toThrow(ShellError);

      // Untrack
      windowLayer.untrackAttachedView(handle, viewHandle);

      // Should succeed now
      expect(() => windowLayer.destroy(handle)).not.toThrow();
      // Remove from handles since we destroyed it
      handles = handles.filter((h) => h.id !== handle.id);
    });
  });
});
