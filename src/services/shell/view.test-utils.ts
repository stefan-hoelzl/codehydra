/**
 * Behavioral mock for ViewLayer.
 *
 * This mock maintains internal state that mirrors the behavior of the real
 * DefaultViewLayer, allowing integration tests to verify behavior without
 * requiring Electron.
 */

import type { ViewLayer, ViewOptions, WindowOpenHandler, Unsubscribe } from "./view";
import type { ViewHandle, Rectangle, WindowHandle } from "./types";
import { ShellError } from "./errors";

/**
 * Internal state for a view.
 */
interface ViewState {
  url: string | null;
  bounds: Rectangle | null;
  backgroundColor: string | null;
  attachedTo: string | null; // WindowHandle.id
  options: ViewOptions;
  hasWindowOpenHandler: boolean;
}

/**
 * State exposed for test assertions.
 */
export interface ViewLayerState {
  views: Map<string, ViewState>;
  /** Ordered list of view IDs per window (z-order: index 0 = bottom) */
  windowChildren: Map<string, string[]>;
}

/**
 * Behavioral mock of ViewLayer with state inspection.
 */
export interface BehavioralViewLayer extends ViewLayer {
  /**
   * Get the internal state for test assertions.
   */
  _getState(): ViewLayerState;

  /**
   * Trigger a did-finish-load callback for a view.
   * Used in tests to simulate page load completion.
   */
  _triggerDidFinishLoad(handle: ViewHandle): void;

  /**
   * Trigger a will-navigate callback for a view.
   * Used in tests to simulate navigation.
   * @returns true if navigation was allowed, false if prevented
   */
  _triggerWillNavigate(handle: ViewHandle, url: string): boolean;
}

/**
 * Creates a behavioral mock of ViewLayer.
 *
 * The mock maintains state and validates operations just like the real
 * implementation, making it suitable for integration tests.
 */
export function createBehavioralViewLayer(): BehavioralViewLayer {
  const views = new Map<string, ViewState>();
  const didFinishLoadCallbacks = new Map<string, Set<() => void>>();
  const willNavigateCallbacks = new Map<string, Set<(url: string) => boolean>>();
  // Track z-order per window: windowId -> ordered list of viewIds (index 0 = bottom)
  const windowChildren = new Map<string, string[]>();
  let nextId = 1;

  function getView(handle: ViewHandle): ViewState {
    const view = views.get(handle.id);
    if (!view) {
      throw new ShellError("VIEW_NOT_FOUND", `View ${handle.id} not found`, handle.id);
    }
    return view;
  }

  function getWindowChildren(windowId: string): string[] {
    let children = windowChildren.get(windowId);
    if (!children) {
      children = [];
      windowChildren.set(windowId, children);
    }
    return children;
  }

  return {
    createView(options: ViewOptions): ViewHandle {
      const id = `view-${nextId++}`;
      views.set(id, {
        url: null,
        bounds: null,
        backgroundColor: options.backgroundColor ?? null,
        attachedTo: null,
        options,
        hasWindowOpenHandler: false,
      });
      didFinishLoadCallbacks.set(id, new Set());
      willNavigateCallbacks.set(id, new Set());
      return { id, __brand: "ViewHandle" };
    },

    destroy(handle: ViewHandle): void {
      const view = views.get(handle.id);
      if (!view) {
        throw new ShellError("VIEW_NOT_FOUND", `View ${handle.id} not found`, handle.id);
      }
      // Remove from window children if attached
      if (view.attachedTo) {
        const children = windowChildren.get(view.attachedTo);
        if (children) {
          const idx = children.indexOf(handle.id);
          if (idx !== -1) {
            children.splice(idx, 1);
          }
        }
      }
      views.delete(handle.id);
      didFinishLoadCallbacks.delete(handle.id);
      willNavigateCallbacks.delete(handle.id);
    },

    destroyAll(): void {
      views.clear();
      didFinishLoadCallbacks.clear();
      willNavigateCallbacks.clear();
      windowChildren.clear();
    },

    async loadURL(handle: ViewHandle, url: string): Promise<void> {
      const view = getView(handle);
      view.url = url;
    },

    getURL(handle: ViewHandle): string {
      const view = getView(handle);
      return view.url ?? "";
    },

    setBounds(handle: ViewHandle, bounds: Rectangle): void {
      const view = getView(handle);
      view.bounds = bounds;
    },

    getBounds(handle: ViewHandle): Rectangle {
      const view = getView(handle);
      return view.bounds ?? { x: 0, y: 0, width: 0, height: 0 };
    },

    setBackgroundColor(handle: ViewHandle, color: string): void {
      const view = getView(handle);
      view.backgroundColor = color;
    },

    focus(_handle: ViewHandle): void {
      getView(_handle); // Validate handle exists
    },

    attachToWindow(handle: ViewHandle, windowHandle: WindowHandle, index?: number): void {
      const view = getView(handle);
      const children = getWindowChildren(windowHandle.id);
      const currentIndex = children.indexOf(handle.id);
      const isAttached = currentIndex !== -1;

      // Check if already at the correct position (no-op to preserve focus)
      if (isAttached) {
        // For "top" position (no index), check if already at end
        if (index === undefined && currentIndex === children.length - 1) {
          return; // Already at top
        }
        // For explicit index, check if already there
        if (index !== undefined && currentIndex === index) {
          return; // Already at correct index
        }
        // Need to move - remove first
        children.splice(currentIndex, 1);
      }

      // Add at specified index or append to top
      if (index !== undefined) {
        children.splice(index, 0, handle.id);
      } else {
        children.push(handle.id);
      }

      view.attachedTo = windowHandle.id;
    },

    detachFromWindow(handle: ViewHandle): void {
      const view = getView(handle);
      if (view.attachedTo) {
        const children = windowChildren.get(view.attachedTo);
        if (children) {
          const idx = children.indexOf(handle.id);
          if (idx !== -1) {
            children.splice(idx, 1);
          }
        }
      }
      view.attachedTo = null;
    },

    onDidFinishLoad(handle: ViewHandle, callback: () => void): Unsubscribe {
      getView(handle); // Validate handle exists
      const callbacks = didFinishLoadCallbacks.get(handle.id);
      callbacks?.add(callback);
      return () => {
        callbacks?.delete(callback);
      };
    },

    onWillNavigate(handle: ViewHandle, callback: (url: string) => boolean): Unsubscribe {
      getView(handle); // Validate handle exists
      const callbacks = willNavigateCallbacks.get(handle.id);
      callbacks?.add(callback);
      return () => {
        callbacks?.delete(callback);
      };
    },

    setWindowOpenHandler(handle: ViewHandle, handler: WindowOpenHandler | null): void {
      const view = getView(handle);
      view.hasWindowOpenHandler = handler !== null;
    },

    send(_handle: ViewHandle, _channel: string, ..._args: unknown[]): void {
      getView(_handle); // Validate handle exists
      // No-op in mock - IPC is not simulated
    },

    getWebContents(_handle: ViewHandle): Electron.WebContents | null {
      getView(_handle); // Validate handle exists
      // Return null in mock - WebContents are not available in behavioral mocks
      // Integration tests should not rely on raw WebContents access
      return null;
    },

    async dispose(): Promise<void> {
      views.clear();
      didFinishLoadCallbacks.clear();
      willNavigateCallbacks.clear();
      windowChildren.clear();
    },

    // State inspection for tests
    _getState(): ViewLayerState {
      const state = new Map<string, ViewState>();
      for (const [id, viewState] of views) {
        state.set(id, { ...viewState });
      }
      const childrenState = new Map<string, string[]>();
      for (const [windowId, children] of windowChildren) {
        childrenState.set(windowId, [...children]);
      }
      return { views: state, windowChildren: childrenState };
    },

    _triggerDidFinishLoad(handle: ViewHandle): void {
      const callbacks = didFinishLoadCallbacks.get(handle.id);
      if (callbacks) {
        for (const callback of callbacks) {
          callback();
        }
      }
    },

    _triggerWillNavigate(handle: ViewHandle, url: string): boolean {
      const callbacks = willNavigateCallbacks.get(handle.id);
      if (callbacks) {
        for (const callback of callbacks) {
          const allow = callback(url);
          if (!allow) {
            return false; // Navigation prevented
          }
        }
      }
      return true; // Navigation allowed
    },
  };
}
