/**
 * Test utilities and mock factories for Electron APIs.
 * Used by test files in src/main/ directory.
 */

import { vi, type MockedFunction } from "vitest";
import type { BaseWindow, WebContentsView, Rectangle, WebContents } from "electron";

/**
 * Type for a mocked BaseWindow.
 */
export interface MockBaseWindow {
  getBounds: MockedFunction<() => Rectangle>;
  on: MockedFunction<(event: string, callback: () => void) => BaseWindow>;
  close: MockedFunction<() => void>;
  contentView: {
    addChildView: MockedFunction<(view: WebContentsView) => void>;
    removeChildView: MockedFunction<(view: WebContentsView) => void>;
  };
}

/**
 * Type for mocked WebContents.
 */
export interface MockWebContents {
  loadFile: MockedFunction<(path: string) => Promise<void>>;
  loadURL: MockedFunction<(url: string) => Promise<void>>;
  focus: MockedFunction<() => void>;
  send: MockedFunction<(channel: string, ...args: unknown[]) => void>;
  setWindowOpenHandler: MockedFunction<(handler: unknown) => void>;
  on: MockedFunction<(event: string, handler: unknown) => WebContents>;
  close: MockedFunction<() => void>;
  openDevTools: MockedFunction<() => void>;
  session: {
    setPermissionRequestHandler: MockedFunction<(handler: unknown) => void>;
  };
}

/**
 * Type for a mocked WebContentsView.
 */
export interface MockWebContentsView {
  setBounds: MockedFunction<(bounds: Rectangle) => void>;
  setBackgroundColor: MockedFunction<(color: string) => void>;
  webContents: MockWebContents;
}

/**
 * Creates a mock BaseWindow for testing.
 */
export function createMockBaseWindow(): MockBaseWindow {
  const mock: MockBaseWindow = {
    getBounds: vi.fn(() => ({ width: 1200, height: 800, x: 0, y: 0 })),
    on: vi.fn().mockReturnThis() as MockBaseWindow["on"],
    close: vi.fn(),
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
  };
  return mock;
}

/**
 * Creates a mock WebContentsView for testing.
 */
export function createMockWebContentsView(): MockWebContentsView {
  const mock: MockWebContentsView = {
    setBounds: vi.fn(),
    setBackgroundColor: vi.fn(),
    webContents: {
      loadFile: vi.fn(() => Promise.resolve()),
      loadURL: vi.fn(() => Promise.resolve()),
      focus: vi.fn(),
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn().mockReturnThis() as MockWebContents["on"],
      close: vi.fn(),
      openDevTools: vi.fn(),
      session: {
        setPermissionRequestHandler: vi.fn(),
      },
    },
  };
  return mock;
}

/**
 * Resets all mocks in provided mock objects.
 */
export function resetMocks(
  ...mocks: (MockBaseWindow | MockWebContentsView | Record<string, unknown>)[]
): void {
  for (const mock of mocks) {
    for (const value of Object.values(mock)) {
      if (typeof value === "function" && "mockClear" in value) {
        (value as MockedFunction<() => unknown>).mockClear();
      } else if (typeof value === "object" && value !== null) {
        resetMocks(value as Record<string, unknown>);
      }
    }
  }
}
