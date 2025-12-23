/**
 * Boundary tests for extension utilities.
 *
 * Tests listInstalledExtensions against a real filesystem to verify
 * actual directory parsing behavior.
 */

import { join } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { listInstalledExtensions } from "./extension-utils";
import { DefaultFileSystemLayer } from "../platform/filesystem";
import { createMockLogger } from "../logging/logging.test-utils";

describe("extension-utils boundary", () => {
  let testDir: string;
  let fs: DefaultFileSystemLayer;

  beforeEach(async () => {
    testDir = join(tmpdir(), `extension-utils-test-${Date.now()}-${Math.random().toString(36)}`);
    await mkdir(testDir, { recursive: true });
    fs = new DefaultFileSystemLayer(createMockLogger());
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("listInstalledExtensions", () => {
    it("lists extensions from real directory", async () => {
      // Create extension directories
      await mkdir(join(testDir, "codehydra.codehydra-0.0.1"));
      await mkdir(join(testDir, "sst-dev.opencode-1.2.3"));

      const result = await listInstalledExtensions(fs, testDir);

      expect(result.size).toBe(2);
      expect(result.get("codehydra.codehydra")).toBe("0.0.1");
      expect(result.get("sst-dev.opencode")).toBe("1.2.3");
    });

    it("returns empty map for empty directory", async () => {
      const result = await listInstalledExtensions(fs, testDir);

      expect(result.size).toBe(0);
    });

    it("returns empty map for non-existent directory", async () => {
      const result = await listInstalledExtensions(fs, join(testDir, "does-not-exist"));

      expect(result.size).toBe(0);
    });

    it("ignores files (only processes directories)", async () => {
      // Create a file with extension-like name
      await writeFile(join(testDir, "codehydra.codehydra-0.0.1"), "not a directory");
      // Create an actual extension directory
      await mkdir(join(testDir, "sst-dev.opencode-1.2.3"));

      const result = await listInstalledExtensions(fs, testDir);

      expect(result.size).toBe(1);
      expect(result.get("sst-dev.opencode")).toBe("1.2.3");
    });

    it("handles mixed valid and invalid entries", async () => {
      // Valid extension directories
      await mkdir(join(testDir, "codehydra.codehydra-0.0.1"));

      // Invalid entries
      await mkdir(join(testDir, ".git")); // Hidden directory
      await mkdir(join(testDir, "node_modules")); // Non-extension directory
      await mkdir(join(testDir, "random-folder")); // No dot in name

      const result = await listInstalledExtensions(fs, testDir);

      expect(result.size).toBe(1);
      expect(result.get("codehydra.codehydra")).toBe("0.0.1");
    });

    it("handles prerelease versions", async () => {
      await mkdir(join(testDir, "publisher.ext-1.0.0-beta.1"));
      await mkdir(join(testDir, "another.ext-2.0.0-alpha"));

      const result = await listInstalledExtensions(fs, testDir);

      expect(result.size).toBe(2);
      expect(result.get("publisher.ext")).toBe("1.0.0-beta.1");
      expect(result.get("another.ext")).toBe("2.0.0-alpha");
    });
  });
});
