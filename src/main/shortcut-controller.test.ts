// @vitest-environment node

/**
 * Tests for ShortcutController.
 * Tests the Alt+X shortcut detection state machine.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WebContents, Event as ElectronEvent, Input, BaseWindow } from "electron";
import { IpcChannels } from "../shared/ipc";
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
  return {
    setDialogMode: vi.fn(),
    focusUI: vi.fn(),
    getUIWebContents: vi.fn(() => mockUIWebContents) as ReturnType<typeof vi.fn> & {
      mockReturnValue: (value: WebContents | null) => void;
    },
    mockUIWebContents,
  };
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

describe("ShortcutController", () => {
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

  describe("constructor", () => {
    it("subscribes to window blur event", () => {
      expect(mockWindow.on).toHaveBeenCalledWith("blur", expect.any(Function));
    });
  });

  describe("registerView", () => {
    it("subscribes to before-input-event and destroyed events", () => {
      const webContents = createMockWebContents();

      controller.registerView(webContents);

      expect(webContents.on).toHaveBeenCalledWith("before-input-event", expect.any(Function));
      expect(webContents.on).toHaveBeenCalledWith("destroyed", expect.any(Function));
    });

    it("does not register the same view twice", () => {
      const webContents = createMockWebContents();

      controller.registerView(webContents);
      controller.registerView(webContents);

      expect(webContents.on).toHaveBeenCalledTimes(2); // once for each event type
    });
  });

  describe("unregisterView", () => {
    it("removes event listeners from view", () => {
      const webContents = createMockWebContents();

      controller.registerView(webContents);
      controller.unregisterView(webContents);

      expect(webContents.off).toHaveBeenCalledWith("before-input-event", expect.any(Function));
      expect(webContents.off).toHaveBeenCalledWith("destroyed", expect.any(Function));
    });

    it("does not throw when unregistering non-registered view", () => {
      const webContents = createMockWebContents();

      expect(() => controller.unregisterView(webContents)).not.toThrow();
    });
  });

  describe("state machine: NORMAL → ALT_WAITING", () => {
    it("controller-normal-to-waiting: Alt keydown transitions to ALT_WAITING and prevents default", () => {
      const webContents = createMockWebContents();
      controller.registerView(webContents);

      const event = createMockElectronEvent();
      const input = createMockElectronInput("Alt", "keyDown");

      // Get the handler and simulate input
      const inputHandler = webContents.on.mock.calls.find(
        (call: unknown[]) => call[0] === "before-input-event"
      )?.[1] as (event: ElectronEvent, input: Input) => void;
      inputHandler(event, input);

      expect(event.preventDefault).toHaveBeenCalled();
    });
  });

  describe("state machine: ALT_WAITING → NORMAL (activate)", () => {
    it("controller-waiting-to-activate: X keydown calls setDialogMode, focusUI, emits ENABLE, prevents default", () => {
      const webContents = createMockWebContents();
      controller.registerView(webContents);

      // Get the handler
      const inputHandler = webContents.on.mock.calls.find(
        (call: unknown[]) => call[0] === "before-input-event"
      )?.[1] as (event: ElectronEvent, input: Input) => void;

      // First: Alt down to enter ALT_WAITING
      inputHandler(createMockElectronEvent(), createMockElectronInput("Alt", "keyDown"));

      // Second: X down to activate
      const event = createMockElectronEvent();
      inputHandler(event, createMockElectronInput("x", "keyDown"));

      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockDeps.setDialogMode).toHaveBeenCalledWith(true);
      expect(mockDeps.focusUI).toHaveBeenCalled();
      expect(mockDeps.mockUIWebContents.send).toHaveBeenCalledWith(IpcChannels.SHORTCUT_ENABLE);
    });

    it("controller-uses-ipc-channel: webContents.send called with IpcChannels.SHORTCUT_ENABLE", () => {
      const webContents = createMockWebContents();
      controller.registerView(webContents);

      const inputHandler = webContents.on.mock.calls.find(
        (call: unknown[]) => call[0] === "before-input-event"
      )?.[1] as (event: ElectronEvent, input: Input) => void;

      // Alt down, then X down
      inputHandler(createMockElectronEvent(), createMockElectronInput("Alt", "keyDown"));
      inputHandler(createMockElectronEvent(), createMockElectronInput("x", "keyDown"));

      // Verify it uses the constant, not a hardcoded string
      expect(mockDeps.mockUIWebContents.send).toHaveBeenCalledWith("shortcut:enable");
      expect(IpcChannels.SHORTCUT_ENABLE).toBe("shortcut:enable");
    });
  });

  describe("state machine: ALT_WAITING → NORMAL (non-X key)", () => {
    it("controller-waiting-non-x: Non-X keydown returns to NORMAL without preventing default", () => {
      const webContents = createMockWebContents();
      controller.registerView(webContents);

      const inputHandler = webContents.on.mock.calls.find(
        (call: unknown[]) => call[0] === "before-input-event"
      )?.[1] as (event: ElectronEvent, input: Input) => void;

      // Alt down to enter ALT_WAITING
      inputHandler(createMockElectronEvent(), createMockElectronInput("Alt", "keyDown"));

      // Non-X key (e.g., "j" for Alt+J)
      const event = createMockElectronEvent();
      inputHandler(event, createMockElectronInput("j", "keyDown"));

      // Should NOT prevent default (let the keystroke through to VS Code)
      expect(event.preventDefault).not.toHaveBeenCalled();
      // Should NOT activate shortcut mode
      expect(mockDeps.setDialogMode).not.toHaveBeenCalled();
    });
  });

  describe("Alt keyup suppression", () => {
    it("controller-waiting-alt-up: Alt keyup in ALT_WAITING is suppressed", () => {
      const webContents = createMockWebContents();
      controller.registerView(webContents);

      const inputHandler = webContents.on.mock.calls.find(
        (call: unknown[]) => call[0] === "before-input-event"
      )?.[1] as (event: ElectronEvent, input: Input) => void;

      // Alt down to enter ALT_WAITING
      inputHandler(createMockElectronEvent(), createMockElectronInput("Alt", "keyDown"));

      // Alt up
      const event = createMockElectronEvent();
      inputHandler(event, createMockElectronInput("Alt", "keyUp"));

      expect(event.preventDefault).toHaveBeenCalled();
    });

    it("controller-normal-alt-up: Alt keyup in NORMAL is suppressed", () => {
      const webContents = createMockWebContents();
      controller.registerView(webContents);

      const inputHandler = webContents.on.mock.calls.find(
        (call: unknown[]) => call[0] === "before-input-event"
      )?.[1] as (event: ElectronEvent, input: Input) => void;

      // Alt up without prior Alt down (NORMAL state)
      const event = createMockElectronEvent();
      inputHandler(event, createMockElectronInput("Alt", "keyUp"));

      expect(event.preventDefault).toHaveBeenCalled();
    });
  });

  describe("auto-repeat handling", () => {
    it("controller-ignore-repeat: Auto-repeat events are ignored", () => {
      const webContents = createMockWebContents();
      controller.registerView(webContents);

      const inputHandler = webContents.on.mock.calls.find(
        (call: unknown[]) => call[0] === "before-input-event"
      )?.[1] as (event: ElectronEvent, input: Input) => void;

      // Auto-repeat Alt keydown
      const event = createMockElectronEvent();
      inputHandler(event, createMockElectronInput("Alt", "keyDown", { isAutoRepeat: true }));

      // Should NOT prevent default or change state
      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe("window blur handling", () => {
    it("controller-window-blur: Window blur resets ALT_WAITING to NORMAL", () => {
      const webContents = createMockWebContents();
      controller.registerView(webContents);

      const inputHandler = webContents.on.mock.calls.find(
        (call: unknown[]) => call[0] === "before-input-event"
      )?.[1] as (event: ElectronEvent, input: Input) => void;

      // Alt down to enter ALT_WAITING
      inputHandler(createMockElectronEvent(), createMockElectronInput("Alt", "keyDown"));

      // Simulate window blur
      const blurHandler = mockWindow.on.mock.calls.find(
        (call: unknown[]) => call[0] === "blur"
      )?.[1] as () => void;
      blurHandler();

      // X down should NOT activate (state was reset to NORMAL)
      const event = createMockElectronEvent();
      inputHandler(event, createMockElectronInput("x", "keyDown"));

      expect(mockDeps.setDialogMode).not.toHaveBeenCalled();
    });
  });

  describe("null WebContents handling", () => {
    it("controller-emit-null-webcontents: emitEnable handles null WebContents gracefully", () => {
      mockDeps.getUIWebContents.mockReturnValue(null as unknown as WebContents);

      const webContents = createMockWebContents();
      controller.registerView(webContents);

      const inputHandler = webContents.on.mock.calls.find(
        (call: unknown[]) => call[0] === "before-input-event"
      )?.[1] as (event: ElectronEvent, input: Input) => void;

      // Alt down, then X down
      inputHandler(createMockElectronEvent(), createMockElectronInput("Alt", "keyDown"));

      // Should NOT throw when UI WebContents is null
      expect(() => {
        inputHandler(createMockElectronEvent(), createMockElectronInput("x", "keyDown"));
      }).not.toThrow();

      // setDialogMode and focusUI should still be called
      expect(mockDeps.setDialogMode).toHaveBeenCalledWith(true);
      expect(mockDeps.focusUI).toHaveBeenCalled();
    });

    it("handles destroyed WebContents gracefully", () => {
      mockDeps.mockUIWebContents.isDestroyed.mockReturnValue(true);

      const webContents = createMockWebContents();
      controller.registerView(webContents);

      const inputHandler = webContents.on.mock.calls.find(
        (call: unknown[]) => call[0] === "before-input-event"
      )?.[1] as (event: ElectronEvent, input: Input) => void;

      // Alt down, then X down
      inputHandler(createMockElectronEvent(), createMockElectronInput("Alt", "keyDown"));

      // Should NOT throw when UI WebContents is destroyed
      expect(() => {
        inputHandler(createMockElectronEvent(), createMockElectronInput("x", "keyDown"));
      }).not.toThrow();

      // send should NOT be called on destroyed webContents
      expect(mockDeps.mockUIWebContents.send).not.toHaveBeenCalled();
    });
  });

  describe("dispose cleanup", () => {
    it("controller-dispose-cleanup: dispose unregisters all views and window blur handler", () => {
      const webContents1 = createMockWebContents();
      const webContents2 = createMockWebContents();

      controller.registerView(webContents1);
      controller.registerView(webContents2);

      controller.dispose();

      expect(webContents1.off).toHaveBeenCalledWith("before-input-event", expect.any(Function));
      expect(webContents1.off).toHaveBeenCalledWith("destroyed", expect.any(Function));
      expect(webContents2.off).toHaveBeenCalledWith("before-input-event", expect.any(Function));
      expect(webContents2.off).toHaveBeenCalledWith("destroyed", expect.any(Function));
      expect(mockWindow.off).toHaveBeenCalledWith("blur", expect.any(Function));
    });
  });

  describe("multiple views", () => {
    it("controller-multiple-views: Alt+X with multiple views emits only one ENABLE event", () => {
      const webContents1 = createMockWebContents();
      const webContents2 = createMockWebContents();

      controller.registerView(webContents1);
      controller.registerView(webContents2);

      // Get handler from first view
      const inputHandler = webContents1.on.mock.calls.find(
        (call: unknown[]) => call[0] === "before-input-event"
      )?.[1] as (event: ElectronEvent, input: Input) => void;

      // Alt down, then X down
      inputHandler(createMockElectronEvent(), createMockElectronInput("Alt", "keyDown"));
      inputHandler(createMockElectronEvent(), createMockElectronInput("x", "keyDown"));

      // Should only emit once (one controller instance)
      expect(mockDeps.mockUIWebContents.send).toHaveBeenCalledTimes(1);
    });
  });

  describe("destroyed WebContents auto-cleanup", () => {
    it("controller-destroyed-webcontents: Destroyed WebContents auto-unregistered", () => {
      const webContents = createMockWebContents();

      controller.registerView(webContents);

      // Get the destroyed handler
      const destroyedHandler = webContents.on.mock.calls.find(
        (call: unknown[]) => call[0] === "destroyed"
      )?.[1] as () => void;

      // Simulate destruction
      destroyedHandler();

      // Should have called off to unregister
      expect(webContents.off).toHaveBeenCalled();
    });
  });

  describe("case-insensitive X key", () => {
    it("handles uppercase X", () => {
      const webContents = createMockWebContents();
      controller.registerView(webContents);

      const inputHandler = webContents.on.mock.calls.find(
        (call: unknown[]) => call[0] === "before-input-event"
      )?.[1] as (event: ElectronEvent, input: Input) => void;

      // Alt down, then uppercase X down
      inputHandler(createMockElectronEvent(), createMockElectronInput("Alt", "keyDown"));
      inputHandler(createMockElectronEvent(), createMockElectronInput("X", "keyDown"));

      expect(mockDeps.setDialogMode).toHaveBeenCalledWith(true);
    });
  });

  describe("SHORTCUT_DISABLE event", () => {
    it("handles race condition: Alt released before focus switches after activation", () => {
      // This test documents the race condition that SHORTCUT_DISABLE solves:
      // When user releases Alt very quickly after Alt+X, the workspace view
      // (not yet unfocused) catches the Alt keyup. Without SHORTCUT_DISABLE,
      // the UI would never know Alt was released.

      const webContents = createMockWebContents();
      controller.registerView(webContents);

      const inputHandler = webContents.on.mock.calls.find(
        (call: unknown[]) => call[0] === "before-input-event"
      )?.[1] as (event: ElectronEvent, input: Input) => void;

      // Step 1: Activate shortcut mode with Alt+X
      inputHandler(createMockElectronEvent(), createMockElectronInput("Alt", "keyDown"));
      inputHandler(createMockElectronEvent(), createMockElectronInput("x", "keyDown"));

      // Verify activation happened
      expect(mockDeps.setDialogMode).toHaveBeenCalledWith(true);
      expect(mockDeps.focusUI).toHaveBeenCalled();
      expect(mockDeps.mockUIWebContents.send).toHaveBeenCalledWith(IpcChannels.SHORTCUT_ENABLE);

      // Step 2: Alt is released while workspace view still has focus
      // (simulates the race condition - focus hasn't switched yet)
      mockDeps.mockUIWebContents.send.mockClear();
      inputHandler(createMockElectronEvent(), createMockElectronInput("Alt", "keyUp"));

      // Step 3: SHORTCUT_DISABLE should be sent to notify UI
      expect(mockDeps.mockUIWebContents.send).toHaveBeenCalledWith(IpcChannels.SHORTCUT_DISABLE);
    });

    it("should emit SHORTCUT_DISABLE when Alt is released after activation", () => {
      const webContents = createMockWebContents();
      controller.registerView(webContents);

      const inputHandler = webContents.on.mock.calls.find(
        (call: unknown[]) => call[0] === "before-input-event"
      )?.[1] as (event: ElectronEvent, input: Input) => void;

      // Setup: activate shortcut mode with Alt+X
      inputHandler(createMockElectronEvent(), createMockElectronInput("Alt", "keyDown"));
      inputHandler(createMockElectronEvent(), createMockElectronInput("x", "keyDown"));

      // Verify SHORTCUT_ENABLE was sent
      expect(mockDeps.mockUIWebContents.send).toHaveBeenCalledWith(IpcChannels.SHORTCUT_ENABLE);
      mockDeps.mockUIWebContents.send.mockClear();

      // Now release Alt (this would normally be caught by workspace view before focus switches)
      inputHandler(createMockElectronEvent(), createMockElectronInput("Alt", "keyUp"));

      // Should emit SHORTCUT_DISABLE to notify UI
      expect(mockDeps.mockUIWebContents.send).toHaveBeenCalledWith(IpcChannels.SHORTCUT_DISABLE);
    });

    it("should NOT emit SHORTCUT_DISABLE when Alt is released without prior activation", () => {
      const webContents = createMockWebContents();
      controller.registerView(webContents);

      const inputHandler = webContents.on.mock.calls.find(
        (call: unknown[]) => call[0] === "before-input-event"
      )?.[1] as (event: ElectronEvent, input: Input) => void;

      // Just Alt down then up, without X (no activation)
      inputHandler(createMockElectronEvent(), createMockElectronInput("Alt", "keyDown"));
      inputHandler(createMockElectronEvent(), createMockElectronInput("Alt", "keyUp"));

      // Should NOT emit SHORTCUT_DISABLE (shortcut mode was never activated)
      expect(mockDeps.mockUIWebContents.send).not.toHaveBeenCalled();
    });

    it("should reset shortcutModeActive on window blur", () => {
      const webContents = createMockWebContents();
      controller.registerView(webContents);

      const inputHandler = webContents.on.mock.calls.find(
        (call: unknown[]) => call[0] === "before-input-event"
      )?.[1] as (event: ElectronEvent, input: Input) => void;

      // Activate shortcut mode
      inputHandler(createMockElectronEvent(), createMockElectronInput("Alt", "keyDown"));
      inputHandler(createMockElectronEvent(), createMockElectronInput("x", "keyDown"));
      mockDeps.mockUIWebContents.send.mockClear();

      // Simulate window blur
      const blurHandler = mockWindow.on.mock.calls.find(
        (call: unknown[]) => call[0] === "blur"
      )?.[1] as () => void;
      blurHandler();

      // Now Alt keyup should NOT emit SHORTCUT_DISABLE (flag was reset by blur)
      inputHandler(createMockElectronEvent(), createMockElectronInput("Alt", "keyUp"));
      expect(mockDeps.mockUIWebContents.send).not.toHaveBeenCalledWith(
        IpcChannels.SHORTCUT_DISABLE
      );
    });

    it("should handle null WebContents gracefully when emitting SHORTCUT_DISABLE", () => {
      const webContents = createMockWebContents();
      controller.registerView(webContents);

      const inputHandler = webContents.on.mock.calls.find(
        (call: unknown[]) => call[0] === "before-input-event"
      )?.[1] as (event: ElectronEvent, input: Input) => void;

      // Activate shortcut mode
      inputHandler(createMockElectronEvent(), createMockElectronInput("Alt", "keyDown"));
      inputHandler(createMockElectronEvent(), createMockElectronInput("x", "keyDown"));

      // Now make getUIWebContents return null
      mockDeps.getUIWebContents.mockReturnValue(null as unknown as WebContents);

      // Alt keyup should not throw
      expect(() => {
        inputHandler(createMockElectronEvent(), createMockElectronInput("Alt", "keyUp"));
      }).not.toThrow();
    });
  });
});
