// @vitest-environment node

/**
 * Integration test for ShortcutController.
 * Tests the full path from input event through to IPC message.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WebContents, Event as ElectronEvent, Input, BaseWindow } from "electron";
import { ApiIpcChannels } from "../shared/ipc";
import { ShortcutController } from "./shortcut-controller";

/**
 * Creates a mock Electron Input object for testing.
 */
function createMockElectronInput(
  key: string,
  type: "keyDown" | "keyUp" = "keyDown",
  options: { alt?: boolean; isAutoRepeat?: boolean } = {}
): Input {
  return {
    type,
    key,
    code: `Key${key.toUpperCase()}`,
    alt: options.alt ?? false,
    control: false,
    shift: false,
    meta: false,
    isAutoRepeat: options.isAutoRepeat ?? false,
    isComposing: false,
    location: 0,
    modifiers: [],
  };
}

/**
 * Creates a mock Electron event with preventDefault spy.
 */
function createMockElectronEvent(): ElectronEvent & { preventDefault: ReturnType<typeof vi.fn> } {
  return {
    preventDefault: vi.fn(),
  } as unknown as ElectronEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

/**
 * Creates a mock WebContents for testing.
 */
function createMockWebContents(): WebContents & {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
} {
  return {
    on: vi.fn().mockReturnThis(),
    off: vi.fn(),
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
  } as unknown as WebContents & {
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    isDestroyed: ReturnType<typeof vi.fn>;
  };
}

/**
 * Creates mock dependencies for ShortcutController.
 */
function createMockDeps() {
  const mockUIWebContents = createMockWebContents();
  const deps = {
    setDialogMode: vi.fn(),
    focusUI: vi.fn(),
    getUIWebContents: vi.fn(() => mockUIWebContents),
    mockUIWebContents,
  };
  return deps;
}

/**
 * Creates a mock BaseWindow for testing.
 */
function createMockWindow(): BaseWindow & {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
} {
  return {
    on: vi.fn().mockReturnThis(),
    off: vi.fn(),
  } as unknown as BaseWindow & {
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
  };
}

describe("ShortcutController Integration", () => {
  let mockWindow: ReturnType<typeof createMockWindow>;
  let mockDeps: ReturnType<typeof createMockDeps>;
  let controller: ShortcutController;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWindow = createMockWindow();
    mockDeps = createMockDeps();
    controller = new ShortcutController(mockWindow, mockDeps);
  });

  afterEach(() => {
    controller.dispose();
  });

  describe("keyboard-wiring-roundtrip", () => {
    it("Alt keydown followed by X keydown triggers full chain: setDialogMode, focusUI, IPC message", () => {
      // 1. Create and register a mock WebContents view (simulating workspace view)
      const workspaceWebContents = createMockWebContents();
      controller.registerView(workspaceWebContents);

      // 2. Get the before-input-event handler that was registered
      const inputHandler = workspaceWebContents.on.mock.calls.find(
        (call: unknown[]) => call[0] === "before-input-event"
      )?.[1] as (event: ElectronEvent, input: Input) => void;
      expect(inputHandler).toBeDefined();

      // 3. Simulate Alt keydown
      const altEvent = createMockElectronEvent();
      inputHandler(altEvent, createMockElectronInput("Alt", "keyDown"));

      // Verify Alt keydown was captured (preventDefault called)
      expect(altEvent.preventDefault).toHaveBeenCalled();

      // 4. Simulate X keydown
      const xEvent = createMockElectronEvent();
      inputHandler(xEvent, createMockElectronInput("x", "keyDown"));

      // 5. Verify the full chain was executed:
      // - X keydown was captured
      expect(xEvent.preventDefault).toHaveBeenCalled();

      // - setDialogMode(true) was called
      expect(mockDeps.setDialogMode).toHaveBeenCalledTimes(1);
      expect(mockDeps.setDialogMode).toHaveBeenCalledWith(true);

      // - focusUI() was called
      expect(mockDeps.focusUI).toHaveBeenCalledTimes(1);

      // - IPC message was sent to UI WebContents
      expect(mockDeps.getUIWebContents).toHaveBeenCalled();
      expect(mockDeps.mockUIWebContents.send).toHaveBeenCalledTimes(1);
      expect(mockDeps.mockUIWebContents.send).toHaveBeenCalledWith(ApiIpcChannels.SHORTCUT_ENABLE);
    });

    it("verifies execution order: setDialogMode before focusUI before IPC", () => {
      const workspaceWebContents = createMockWebContents();
      controller.registerView(workspaceWebContents);

      const inputHandler = workspaceWebContents.on.mock.calls.find(
        (call: unknown[]) => call[0] === "before-input-event"
      )?.[1] as (event: ElectronEvent, input: Input) => void;

      // Track execution order
      const executionOrder: string[] = [];
      mockDeps.setDialogMode.mockImplementation(() => {
        executionOrder.push("setDialogMode");
      });
      mockDeps.focusUI.mockImplementation(() => {
        executionOrder.push("focusUI");
      });
      mockDeps.mockUIWebContents.send.mockImplementation(() => {
        executionOrder.push("send");
      });

      // Trigger Alt+X
      inputHandler(createMockElectronEvent(), createMockElectronInput("Alt", "keyDown"));
      inputHandler(createMockElectronEvent(), createMockElectronInput("x", "keyDown"));

      // Verify order
      expect(executionOrder).toEqual(["setDialogMode", "focusUI", "send"]);
    });

    it("does not trigger chain when only Alt is pressed (no X follow-up)", () => {
      const workspaceWebContents = createMockWebContents();
      controller.registerView(workspaceWebContents);

      const inputHandler = workspaceWebContents.on.mock.calls.find(
        (call: unknown[]) => call[0] === "before-input-event"
      )?.[1] as (event: ElectronEvent, input: Input) => void;

      // Only press Alt
      inputHandler(createMockElectronEvent(), createMockElectronInput("Alt", "keyDown"));

      // Verify nothing in the chain was called
      expect(mockDeps.setDialogMode).not.toHaveBeenCalled();
      expect(mockDeps.focusUI).not.toHaveBeenCalled();
      expect(mockDeps.mockUIWebContents.send).not.toHaveBeenCalled();
    });

    it("does not trigger chain when X is pressed without prior Alt", () => {
      const workspaceWebContents = createMockWebContents();
      controller.registerView(workspaceWebContents);

      const inputHandler = workspaceWebContents.on.mock.calls.find(
        (call: unknown[]) => call[0] === "before-input-event"
      )?.[1] as (event: ElectronEvent, input: Input) => void;

      // Only press X (no prior Alt)
      inputHandler(createMockElectronEvent(), createMockElectronInput("x", "keyDown"));

      // Verify nothing in the chain was called
      expect(mockDeps.setDialogMode).not.toHaveBeenCalled();
      expect(mockDeps.focusUI).not.toHaveBeenCalled();
      expect(mockDeps.mockUIWebContents.send).not.toHaveBeenCalled();
    });
  });
});
