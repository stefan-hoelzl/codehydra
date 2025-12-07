/**
 * Tests for IPC channel definitions.
 */

import { describe, it, expect } from "vitest";
import { IpcChannels } from "./ipc";

describe("IpcChannels", () => {
  describe("SHORTCUT_ENABLE", () => {
    it("exists with correct channel name", () => {
      expect(IpcChannels.SHORTCUT_ENABLE).toBe("shortcut:enable");
    });
  });

  describe("SHORTCUT_DISABLE", () => {
    it("exists with correct channel name", () => {
      expect(IpcChannels.SHORTCUT_DISABLE).toBe("shortcut:disable");
    });
  });
});
