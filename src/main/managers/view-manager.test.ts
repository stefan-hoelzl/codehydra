// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock Electron and external-url before imports
const { mockWindowManager, MockWebContentsViewClass, mockOpenExternal } = vi.hoisted(() => {
  const createMockView = () => ({
    setBounds: vi.fn(),
    setBackgroundColor: vi.fn(),
    webContents: {
      loadFile: vi.fn(() => Promise.resolve()),
      loadURL: vi.fn(() => Promise.resolve()),
      focus: vi.fn(),
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
      openDevTools: vi.fn(),
      session: {
        setPermissionRequestHandler: vi.fn(),
      },
    },
  });

  // We need to create views dynamically for each call
  const createdViews: ReturnType<typeof createMockView>[] = [];

  function MockWebContentsViewClass(
    this: ReturnType<typeof createMockView>
  ): ReturnType<typeof createMockView> {
    const view = createMockView();
    createdViews.push(view);
    return view;
  }

  const mockWindow = {
    getBounds: vi.fn(() => ({ width: 1200, height: 800, x: 0, y: 0 })),
    on: vi.fn().mockReturnThis(),
    close: vi.fn(),
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
      children: [] as ReturnType<typeof createMockView>[],
    },
  };

  const mockWindowManager = {
    getWindow: vi.fn(() => mockWindow),
    getBounds: vi.fn(() => ({ width: 1200, height: 800 })),
    onResize: vi.fn(() => vi.fn()),
  };

  return {
    mockWebContentsView: createMockView(),
    mockWindowManager,
    MockWebContentsViewClass: vi.fn(
      MockWebContentsViewClass
    ) as unknown as typeof MockWebContentsViewClass & {
      mock: {
        calls: Array<unknown[]>;
        results: Array<{ value: ReturnType<typeof createMockView> }>;
      };
    },
    createdViews,
    mockOpenExternal: vi.fn(),
  };
});

vi.mock("electron", () => ({
  WebContentsView: MockWebContentsViewClass,
}));

vi.mock("../utils/external-url", () => ({
  openExternal: mockOpenExternal,
}));

import { ViewManager, SIDEBAR_WIDTH } from "./view-manager";
import type { WindowManager } from "./window-manager";

describe("ViewManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mock's result tracking
    MockWebContentsViewClass.mock.results = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("SIDEBAR_WIDTH constant", () => {
    it("equals 250", () => {
      expect(SIDEBAR_WIDTH).toBe(250);
    });
  });

  describe("create", () => {
    it("creates a ViewManager instance", () => {
      const manager = ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      expect(manager).toBeInstanceOf(ViewManager);
    });

    it("creates UI layer WebContentsView with security settings", () => {
      ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      expect(MockWebContentsViewClass).toHaveBeenCalledWith({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          preload: "/path/to/preload.js",
        },
      });
    });

    it("adds UI layer to window", () => {
      ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      expect(mockWindowManager.getWindow().contentView.addChildView).toHaveBeenCalled();
    });

    it("sets transparent background on UI layer", () => {
      ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      const uiView = MockWebContentsViewClass.mock.results[0]?.value;
      expect(uiView?.setBackgroundColor).toHaveBeenCalledWith("#00000000");
    });

    it("subscribes to window resize events", () => {
      ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      expect(mockWindowManager.onResize).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe("getUIView", () => {
    it("returns the UI layer WebContentsView", () => {
      const manager = ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      const uiView = manager.getUIView();
      const createdUIView = MockWebContentsViewClass.mock.results[0]?.value;

      expect(uiView).toBe(createdUIView);
    });
  });

  describe("createWorkspaceView", () => {
    it("creates WebContentsView with security settings", () => {
      const manager = ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      manager.createWorkspaceView("/path/to/workspace", "http://localhost:8080/?folder=/path");

      // Second call should be for workspace view
      expect(MockWebContentsViewClass.mock.calls[1]?.[0]).toEqual({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          preload: "/path/to/webview-preload.js",
        },
      });
    });

    it("loads the code-server URL", () => {
      const manager = ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      manager.createWorkspaceView("/path/to/workspace", "http://localhost:8080/?folder=/path");

      const workspaceView = MockWebContentsViewClass.mock.results[1]?.value;
      expect(workspaceView?.webContents.loadURL).toHaveBeenCalledWith(
        "http://localhost:8080/?folder=/path"
      );
    });

    it("adds workspace view to window", () => {
      const manager = ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      manager.createWorkspaceView("/path/to/workspace", "http://localhost:8080/?folder=/path");

      // Should be called twice: once for UI view, once for workspace view
      expect(mockWindowManager.getWindow().contentView.addChildView).toHaveBeenCalledTimes(2);
    });

    it("configures window open handler", () => {
      const manager = ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      manager.createWorkspaceView("/path/to/workspace", "http://localhost:8080/?folder=/path");

      const workspaceView = MockWebContentsViewClass.mock.results[1]?.value;
      expect(workspaceView?.webContents.setWindowOpenHandler).toHaveBeenCalled();
    });

    it("returns the created view", () => {
      const manager = ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      const view = manager.createWorkspaceView(
        "/path/to/workspace",
        "http://localhost:8080/?folder=/path"
      );

      const expectedView = MockWebContentsViewClass.mock.results[1]?.value;
      expect(view).toBe(expectedView);
    });
  });

  describe("destroyWorkspaceView", () => {
    it("removes view from window", () => {
      const manager = ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      manager.createWorkspaceView("/path/to/workspace", "http://localhost:8080/?folder=/path");
      manager.destroyWorkspaceView("/path/to/workspace");

      expect(mockWindowManager.getWindow().contentView.removeChildView).toHaveBeenCalled();
    });

    it("closes webContents", () => {
      const manager = ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      manager.createWorkspaceView("/path/to/workspace", "http://localhost:8080/?folder=/path");
      const workspaceView = MockWebContentsViewClass.mock.results[1]?.value;

      manager.destroyWorkspaceView("/path/to/workspace");

      expect(workspaceView?.webContents.close).toHaveBeenCalled();
    });

    it("removes view from internal map", () => {
      const manager = ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      manager.createWorkspaceView("/path/to/workspace", "http://localhost:8080/?folder=/path");
      manager.destroyWorkspaceView("/path/to/workspace");

      expect(manager.getWorkspaceView("/path/to/workspace")).toBeUndefined();
    });
  });

  describe("getWorkspaceView", () => {
    it("returns the view for existing workspace", () => {
      const manager = ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      manager.createWorkspaceView("/path/to/workspace", "http://localhost:8080/?folder=/path");
      const view = manager.getWorkspaceView("/path/to/workspace");

      const expectedView = MockWebContentsViewClass.mock.results[1]?.value;
      expect(view).toBe(expectedView);
    });

    it("returns undefined for non-existent workspace", () => {
      const manager = ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      const view = manager.getWorkspaceView("/path/to/nonexistent");

      expect(view).toBeUndefined();
    });
  });

  describe("updateBounds", () => {
    it("sets UI layer bounds to sidebar width", () => {
      mockWindowManager.getBounds.mockReturnValue({ width: 1400, height: 900 });
      const manager = ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      manager.updateBounds();

      const uiView = MockWebContentsViewClass.mock.results[0]?.value;
      expect(uiView?.setBounds).toHaveBeenCalledWith({
        x: 0,
        y: 0,
        width: SIDEBAR_WIDTH,
        height: 900,
      });
    });

    it("sets active workspace bounds to content area", () => {
      mockWindowManager.getBounds.mockReturnValue({ width: 1400, height: 900 });
      const manager = ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      manager.createWorkspaceView("/path/to/workspace", "http://localhost:8080/?folder=/path");
      manager.setActiveWorkspace("/path/to/workspace");
      manager.updateBounds();

      const workspaceView = MockWebContentsViewClass.mock.results[1]?.value;
      expect(workspaceView?.setBounds).toHaveBeenCalledWith({
        x: SIDEBAR_WIDTH,
        y: 0,
        width: 1400 - SIDEBAR_WIDTH,
        height: 900,
      });
    });

    it("sets inactive workspace bounds to zero", () => {
      mockWindowManager.getBounds.mockReturnValue({ width: 1400, height: 900 });
      const manager = ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      manager.createWorkspaceView("/path/to/workspace1", "http://localhost:8080/?folder=/path1");
      manager.createWorkspaceView("/path/to/workspace2", "http://localhost:8080/?folder=/path2");
      manager.setActiveWorkspace("/path/to/workspace1");
      manager.updateBounds();

      const inactiveView = MockWebContentsViewClass.mock.results[2]?.value;
      expect(inactiveView?.setBounds).toHaveBeenCalledWith({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
    });

    it("clamps bounds at minimum window size", () => {
      // Smaller than minimum 800x600
      mockWindowManager.getBounds.mockReturnValue({ width: 600, height: 400 });
      const manager = ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      manager.createWorkspaceView("/path/to/workspace", "http://localhost:8080/?folder=/path");
      manager.setActiveWorkspace("/path/to/workspace");
      manager.updateBounds();

      const workspaceView = MockWebContentsViewClass.mock.results[1]?.value;
      // Should use clamped values
      expect(workspaceView?.setBounds).toHaveBeenCalledWith({
        x: SIDEBAR_WIDTH,
        y: 0,
        width: 800 - SIDEBAR_WIDTH,
        height: 600,
      });
    });
  });

  describe("setActiveWorkspace", () => {
    it("updates active workspace path", () => {
      const manager = ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      manager.createWorkspaceView("/path/to/workspace", "http://localhost:8080/?folder=/path");
      manager.setActiveWorkspace("/path/to/workspace");
      manager.updateBounds();

      // Active workspace should get content bounds
      const workspaceView = MockWebContentsViewClass.mock.results[1]?.value;
      const setBoundsCalls = workspaceView?.setBounds.mock.calls ?? [];
      const lastCall = setBoundsCalls[setBoundsCalls.length - 1];
      expect(lastCall?.[0].width).toBeGreaterThan(0);
    });

    it("handles null active workspace", () => {
      const manager = ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      manager.createWorkspaceView("/path/to/workspace", "http://localhost:8080/?folder=/path");
      manager.setActiveWorkspace("/path/to/workspace");
      manager.setActiveWorkspace(null);
      manager.updateBounds();

      // All workspaces should have zero bounds
      const workspaceView = MockWebContentsViewClass.mock.results[1]?.value;
      const setBoundsCalls = workspaceView?.setBounds.mock.calls ?? [];
      const lastCall = setBoundsCalls[setBoundsCalls.length - 1];
      expect(lastCall?.[0]).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    });
  });

  describe("focusActiveWorkspace", () => {
    it("focuses the active workspace view", () => {
      const manager = ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      manager.createWorkspaceView("/path/to/workspace", "http://localhost:8080/?folder=/path");
      manager.setActiveWorkspace("/path/to/workspace");

      manager.focusActiveWorkspace();

      const workspaceView = MockWebContentsViewClass.mock.results[1]?.value;
      expect(workspaceView?.webContents.focus).toHaveBeenCalled();
    });

    it("does nothing when no active workspace", () => {
      const manager = ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      // Should not throw
      expect(() => manager.focusActiveWorkspace()).not.toThrow();
    });
  });

  describe("focusUI", () => {
    it("focuses the UI layer view", () => {
      const manager = ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      manager.focusUI();

      const uiView = MockWebContentsViewClass.mock.results[0]?.value;
      expect(uiView?.webContents.focus).toHaveBeenCalled();
    });
  });

  describe("window open handler", () => {
    it("calls openExternal for external URLs", () => {
      const manager = ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      manager.createWorkspaceView("/path/to/workspace", "http://localhost:8080/?folder=/path");

      const workspaceView = MockWebContentsViewClass.mock.results[1]?.value;
      const handler = workspaceView?.webContents.setWindowOpenHandler.mock
        .calls[0]?.[0] as (details: { url: string }) => { action: string };

      const result = handler({ url: "https://external.com" });

      expect(mockOpenExternal).toHaveBeenCalledWith("https://external.com");
      expect(result).toEqual({ action: "deny" });
    });
  });

  describe("will-navigate handler", () => {
    it("prevents navigation away from code-server URL", () => {
      const manager = ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      manager.createWorkspaceView("/path/to/workspace", "http://localhost:8080/?folder=/path");

      const workspaceView = MockWebContentsViewClass.mock.results[1]?.value;

      // Find the will-navigate handler
      const onCalls = workspaceView?.webContents.on.mock.calls ?? [];
      const willNavigateCall = onCalls.find((call: unknown[]) => call[0] === "will-navigate") as
        | [string, (event: { preventDefault: () => void }, url: string) => void]
        | undefined;

      expect(willNavigateCall).toBeDefined();

      const handler = willNavigateCall?.[1];
      const mockEvent = { preventDefault: vi.fn() };

      // External URL should be prevented and opened externally
      handler?.(mockEvent, "https://external.com");
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockOpenExternal).toHaveBeenCalledWith("https://external.com");
    });

    it("allows navigation within code-server origin", () => {
      const manager = ViewManager.create(mockWindowManager as unknown as WindowManager, {
        uiPreloadPath: "/path/to/preload.js",
        webviewPreloadPath: "/path/to/webview-preload.js",
        codeServerPort: 8080,
      });

      manager.createWorkspaceView("/path/to/workspace", "http://localhost:8080/?folder=/path");

      const workspaceView = MockWebContentsViewClass.mock.results[1]?.value;

      // Find the will-navigate handler
      const onCalls = workspaceView?.webContents.on.mock.calls ?? [];
      const willNavigateCall = onCalls.find((call: unknown[]) => call[0] === "will-navigate") as
        | [string, (event: { preventDefault: () => void }, url: string) => void]
        | undefined;

      const handler = willNavigateCall?.[1];
      const mockEvent = { preventDefault: vi.fn() };

      // Clear previous calls
      mockOpenExternal.mockClear();

      // Code-server URL should be allowed
      handler?.(mockEvent, "http://localhost:8080/other-path");
      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
      expect(mockOpenExternal).not.toHaveBeenCalled();
    });
  });
});
