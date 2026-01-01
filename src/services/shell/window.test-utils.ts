/**
 * Behavioral mock for WindowLayer.
 *
 * This mock maintains internal state that mirrors the behavior of the real
 * DefaultWindowLayer, allowing integration tests to verify behavior without
 * requiring Electron.
 */

import type { WindowLayer, WindowOptions, ContentView, Unsubscribe } from "./window";
import type { WindowHandle, Rectangle, ViewHandle } from "./types";
import type { ImageHandle } from "../platform/types";
import { ShellError } from "./errors";

/**
 * Internal state for a window.
 */
interface WindowState {
  bounds: Rectangle;
  contentBounds: Rectangle;
  title: string;
  isMaximized: boolean;
  isDestroyed: boolean;
  attachedViews: Set<string>;
  options: WindowOptions;
}

/**
 * State exposed for test assertions.
 */
export interface WindowLayerState {
  windows: Map<string, WindowState>;
}

/**
 * Behavioral mock of WindowLayer with state inspection.
 */
export interface BehavioralWindowLayer extends WindowLayer {
  /**
   * Get the internal state for test assertions.
   */
  _getState(): WindowLayerState;

  /**
   * Trigger a resize callback for a window.
   * Used in tests to simulate resize events.
   */
  _triggerResize(handle: WindowHandle): void;

  /**
   * Trigger a maximize callback for a window.
   * Used in tests to simulate maximize events.
   */
  _triggerMaximize(handle: WindowHandle): void;

  /**
   * Trigger an unmaximize callback for a window.
   * Used in tests to simulate unmaximize events.
   */
  _triggerUnmaximize(handle: WindowHandle): void;

  /**
   * Trigger a close callback for a window.
   * Used in tests to simulate close events.
   */
  _triggerClose(handle: WindowHandle): void;
}

/**
 * Creates a behavioral mock of WindowLayer.
 *
 * The mock maintains state and validates operations just like the real
 * implementation, making it suitable for integration tests.
 */
export function createBehavioralWindowLayer(): BehavioralWindowLayer {
  const windows = new Map<string, WindowState>();
  const resizeCallbacks = new Map<string, Set<() => void>>();
  const maximizeCallbacks = new Map<string, Set<() => void>>();
  const unmaximizeCallbacks = new Map<string, Set<() => void>>();
  const closeCallbacks = new Map<string, Set<() => void>>();
  let nextId = 1;

  function getWindow(handle: WindowHandle): WindowState {
    const window = windows.get(handle.id);
    if (!window) {
      throw new ShellError("WINDOW_NOT_FOUND", `Window ${handle.id} not found`, handle.id);
    }
    if (window.isDestroyed) {
      throw new ShellError("WINDOW_DESTROYED", `Window ${handle.id} was destroyed`, handle.id);
    }
    return window;
  }

  function createContentView(): ContentView {
    const children: unknown[] = [];
    return {
      addChildView(view: unknown): void {
        if (!children.includes(view)) {
          children.push(view);
        }
      },
      removeChildView(view: unknown): void {
        const index = children.indexOf(view);
        if (index !== -1) {
          children.splice(index, 1);
        }
      },
      get children(): readonly unknown[] {
        return [...children];
      },
    };
  }

  const contentViews = new Map<string, ContentView>();

  return {
    createWindow(options: WindowOptions): WindowHandle {
      const id = `window-${nextId++}`;
      const bounds: Rectangle = {
        x: 0,
        y: 0,
        width: options.width ?? 800,
        height: options.height ?? 600,
      };
      windows.set(id, {
        bounds,
        contentBounds: { ...bounds },
        title: options.title ?? "",
        isMaximized: false,
        isDestroyed: false,
        attachedViews: new Set(),
        options,
      });
      contentViews.set(id, createContentView());
      resizeCallbacks.set(id, new Set());
      maximizeCallbacks.set(id, new Set());
      unmaximizeCallbacks.set(id, new Set());
      closeCallbacks.set(id, new Set());
      return { id, __brand: "WindowHandle" };
    },

    destroy(handle: WindowHandle): void {
      const window = getWindow(handle);
      if (window.attachedViews.size > 0) {
        throw new ShellError(
          "WINDOW_HAS_ATTACHED_VIEWS",
          `Window ${handle.id} has ${window.attachedViews.size} attached views`,
          handle.id
        );
      }
      window.isDestroyed = true;
      windows.delete(handle.id);
      contentViews.delete(handle.id);
      resizeCallbacks.delete(handle.id);
      maximizeCallbacks.delete(handle.id);
      unmaximizeCallbacks.delete(handle.id);
      closeCallbacks.delete(handle.id);
    },

    destroyAll(): void {
      // Check for attached views first
      for (const [id, window] of windows) {
        if (window.attachedViews.size > 0) {
          throw new ShellError(
            "WINDOW_HAS_ATTACHED_VIEWS",
            `Window ${id} has ${window.attachedViews.size} attached views`,
            id
          );
        }
      }

      // Now destroy all
      for (const window of windows.values()) {
        window.isDestroyed = true;
      }
      windows.clear();
      contentViews.clear();
      resizeCallbacks.clear();
      maximizeCallbacks.clear();
      unmaximizeCallbacks.clear();
      closeCallbacks.clear();
    },

    getBounds(handle: WindowHandle): Rectangle {
      const window = getWindow(handle);
      return { ...window.bounds };
    },

    getContentBounds(handle: WindowHandle): Rectangle {
      const window = getWindow(handle);
      return { ...window.contentBounds };
    },

    setBounds(handle: WindowHandle, bounds: Rectangle): void {
      const window = getWindow(handle);
      window.bounds = { ...bounds };
      window.contentBounds = { ...bounds };
    },

    setOverlayIcon(handle: WindowHandle, _image: ImageHandle | null, _description: string): void {
      getWindow(handle); // Validate handle exists
      // No-op in mock - overlay icon is Windows-only
    },

    setIcon(handle: WindowHandle, _image: ImageHandle): void {
      getWindow(handle); // Validate handle exists
      // No-op in mock
    },

    maximize(handle: WindowHandle): void {
      const window = getWindow(handle);
      window.isMaximized = true;
    },

    isMaximized(handle: WindowHandle): boolean {
      const window = getWindow(handle);
      return window.isMaximized;
    },

    isDestroyed(handle: WindowHandle): boolean {
      const window = windows.get(handle.id);
      if (!window) {
        return true;
      }
      return window.isDestroyed;
    },

    setTitle(handle: WindowHandle, title: string): void {
      const window = getWindow(handle);
      window.title = title;
    },

    close(handle: WindowHandle): void {
      const window = getWindow(handle);
      // Trigger close callbacks before marking destroyed
      const callbacks = closeCallbacks.get(handle.id);
      if (callbacks) {
        for (const callback of callbacks) {
          callback();
        }
      }
      window.isDestroyed = true;
    },

    onResize(handle: WindowHandle, callback: () => void): Unsubscribe {
      getWindow(handle); // Validate handle exists
      const callbacks = resizeCallbacks.get(handle.id);
      callbacks?.add(callback);
      return () => {
        callbacks?.delete(callback);
      };
    },

    onMaximize(handle: WindowHandle, callback: () => void): Unsubscribe {
      getWindow(handle); // Validate handle exists
      const callbacks = maximizeCallbacks.get(handle.id);
      callbacks?.add(callback);
      return () => {
        callbacks?.delete(callback);
      };
    },

    onUnmaximize(handle: WindowHandle, callback: () => void): Unsubscribe {
      getWindow(handle); // Validate handle exists
      const callbacks = unmaximizeCallbacks.get(handle.id);
      callbacks?.add(callback);
      return () => {
        callbacks?.delete(callback);
      };
    },

    onClose(handle: WindowHandle, callback: () => void): Unsubscribe {
      getWindow(handle); // Validate handle exists
      const callbacks = closeCallbacks.get(handle.id);
      callbacks?.add(callback);
      return () => {
        callbacks?.delete(callback);
      };
    },

    getContentView(handle: WindowHandle): ContentView {
      getWindow(handle); // Validate handle exists
      const contentView = contentViews.get(handle.id);
      if (!contentView) {
        throw new ShellError(
          "WINDOW_NOT_FOUND",
          `Content view for ${handle.id} not found`,
          handle.id
        );
      }
      return contentView;
    },

    trackAttachedView(handle: WindowHandle, viewHandle: ViewHandle): void {
      const window = getWindow(handle);
      window.attachedViews.add(viewHandle.id);
    },

    untrackAttachedView(handle: WindowHandle, viewHandle: ViewHandle): void {
      const window = getWindow(handle);
      window.attachedViews.delete(viewHandle.id);
    },

    // Test helper methods
    _getState(): WindowLayerState {
      const state = new Map<string, WindowState>();
      for (const [id, window] of windows) {
        state.set(id, {
          ...window,
          attachedViews: new Set(window.attachedViews),
        });
      }
      return { windows: state };
    },

    _triggerResize(handle: WindowHandle): void {
      const callbacks = resizeCallbacks.get(handle.id);
      if (callbacks) {
        for (const callback of callbacks) {
          callback();
        }
      }
    },

    _triggerMaximize(handle: WindowHandle): void {
      const window = windows.get(handle.id);
      if (window) {
        window.isMaximized = true;
      }
      const callbacks = maximizeCallbacks.get(handle.id);
      if (callbacks) {
        for (const callback of callbacks) {
          callback();
        }
      }
    },

    _triggerUnmaximize(handle: WindowHandle): void {
      const window = windows.get(handle.id);
      if (window) {
        window.isMaximized = false;
      }
      const callbacks = unmaximizeCallbacks.get(handle.id);
      if (callbacks) {
        for (const callback of callbacks) {
          callback();
        }
      }
    },

    _triggerClose(handle: WindowHandle): void {
      const callbacks = closeCallbacks.get(handle.id);
      if (callbacks) {
        for (const callback of callbacks) {
          callback();
        }
      }
    },
  };
}
