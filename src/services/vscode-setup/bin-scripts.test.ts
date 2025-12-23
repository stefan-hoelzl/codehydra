// @vitest-environment node
/**
 * Unit tests for bin-scripts utility module.
 */

import { describe, it, expect } from "vitest";
import { generateScript, generateScripts, generateOpencodeScript } from "./bin-scripts";
import { createMockPlatformInfo } from "../platform/platform-info.test-utils";
import type { BinTargetPaths } from "./types";

describe("generateScript", () => {
  describe("Unix (Linux/macOS)", () => {
    it("starts with shebang", () => {
      const script = generateScript("code", "/path/to/code-cli.sh", false);

      expect(script.content).toMatch(/^#!/);
      expect(script.content.startsWith("#!/bin/sh\n")).toBe(true);
    });

    it("uses exec command", () => {
      const script = generateScript("code", "/path/to/code-cli.sh", false);

      expect(script.content).toContain("exec ");
    });

    it("passes arguments with $@", () => {
      const script = generateScript("code", "/path/to/code-cli.sh", false);

      expect(script.content).toContain('"$@"');
    });

    it("wraps path in single quotes", () => {
      const script = generateScript("code", "/path/to/binary", false);

      expect(script.content).toContain("'/path/to/binary'");
    });

    it("escapes single quotes in path", () => {
      const script = generateScript("code", "/path/to/user's/binary", false);

      // Single quotes in path should be escaped: ' -> '\''
      expect(script.content).toContain("'\\''");
    });

    it("has needsExecutable = true", () => {
      const script = generateScript("code", "/path/to/binary", false);

      expect(script.needsExecutable).toBe(true);
    });

    it("filename has no extension", () => {
      const script = generateScript("code", "/path/to/binary", false);

      expect(script.filename).toBe("code");
    });
  });

  describe("Windows", () => {
    it("starts with @echo off", () => {
      const script = generateScript("code", "C:/path/to/code.exe", true);

      expect(script.content.startsWith("@echo off")).toBe(true);
    });

    it("uses .cmd extension", () => {
      const script = generateScript("code", "C:/path/to/code.exe", true);

      expect(script.filename).toBe("code.cmd");
    });

    it("wraps path in double quotes", () => {
      const script = generateScript("code", "C:/path/to/code.exe", true);

      expect(script.content).toContain('"C:\\path\\to\\code.exe"');
    });

    it("converts forward slashes to backslashes", () => {
      const script = generateScript("code", "C:/Program Files/Code/code.exe", true);

      expect(script.content).toContain("C:\\Program Files\\Code\\code.exe");
    });

    it("passes arguments with %*", () => {
      const script = generateScript("code", "C:/path/to/code.exe", true);

      expect(script.content).toContain("%*");
    });

    it("has needsExecutable = false", () => {
      const script = generateScript("code", "C:/path/to/code.exe", true);

      expect(script.needsExecutable).toBe(false);
    });
  });

  describe("paths with spaces", () => {
    it("handles Unix paths with spaces", () => {
      const script = generateScript("code", "/path/with spaces/to/binary", false);

      expect(script.content).toContain("'/path/with spaces/to/binary'");
    });

    it("handles Windows paths with spaces", () => {
      const script = generateScript("code", "C:/Program Files/Code/code.exe", true);

      expect(script.content).toContain('"C:\\Program Files\\Code\\code.exe"');
    });
  });
});

describe("generateOpencodeScript", () => {
  const TEST_VERSION = "1.0.163";

  describe("Unix (Linux/macOS)", () => {
    it("starts with shebang", () => {
      const script = generateOpencodeScript(false, TEST_VERSION);

      expect(script.content.startsWith("#!/bin/sh\n")).toBe(true);
    });

    it("has correct filename", () => {
      const script = generateOpencodeScript(false, TEST_VERSION);

      expect(script.filename).toBe("opencode");
    });

    it("has needsExecutable = true", () => {
      const script = generateOpencodeScript(false, TEST_VERSION);

      expect(script.needsExecutable).toBe(true);
    });

    it("references ports.json relative path", () => {
      const script = generateOpencodeScript(false, TEST_VERSION);

      expect(script.content).toContain("../opencode/ports.json");
    });

    it("references versioned path for opencode binary", () => {
      const script = generateOpencodeScript(false, TEST_VERSION);

      expect(script.content).toContain(`../opencode/${TEST_VERSION}/opencode`);
      // Should NOT contain 'current' symlink path
      expect(script.content).not.toContain("current/opencode");
    });

    it("uses git rev-parse to find workspace root", () => {
      const script = generateOpencodeScript(false, TEST_VERSION);

      expect(script.content).toContain("git rev-parse --show-toplevel");
    });

    it("uses attach command in managed mode", () => {
      const script = generateOpencodeScript(false, TEST_VERSION);

      expect(script.content).toContain("attach");
      expect(script.content).toContain("http://127.0.0.1:$PORT");
    });

    it("falls back to standalone mode with all args", () => {
      const script = generateOpencodeScript(false, TEST_VERSION);

      // Last exec should pass all args
      expect(script.content).toContain('exec "$OPENCODE_BIN" "$@"');
    });

    it("uses exec for attach command (no background process)", () => {
      const script = generateOpencodeScript(false, TEST_VERSION);

      // Should use exec for attach, not background with &
      expect(script.content).toContain('exec "$OPENCODE_BIN" attach');
      expect(script.content).not.toContain("sleep");
      expect(script.content).not.toContain("&\n");
    });
  });

  describe("Windows", () => {
    it("starts with @echo off", () => {
      const script = generateOpencodeScript(true, TEST_VERSION);

      expect(script.content.startsWith("@echo off")).toBe(true);
    });

    it("uses .cmd extension", () => {
      const script = generateOpencodeScript(true, TEST_VERSION);

      expect(script.filename).toBe("opencode.cmd");
    });

    it("has needsExecutable = false", () => {
      const script = generateOpencodeScript(true, TEST_VERSION);

      expect(script.needsExecutable).toBe(false);
    });

    it("references ports.json relative path", () => {
      const script = generateOpencodeScript(true, TEST_VERSION);

      expect(script.content).toContain("opencode\\ports.json");
    });

    it("references versioned path for opencode binary", () => {
      const script = generateOpencodeScript(true, TEST_VERSION);

      expect(script.content).toContain(`opencode\\${TEST_VERSION}\\opencode.exe`);
      // Should NOT contain 'current' symlink path
      expect(script.content).not.toContain("current\\opencode");
    });

    it("uses git rev-parse to find workspace root", () => {
      const script = generateOpencodeScript(true, TEST_VERSION);

      expect(script.content).toContain("git rev-parse --show-toplevel");
    });

    it("uses PowerShell to parse JSON", () => {
      const script = generateOpencodeScript(true, TEST_VERSION);

      expect(script.content).toContain("powershell");
      expect(script.content).toContain("ConvertFrom-Json");
    });

    it("uses attach command in managed mode", () => {
      const script = generateOpencodeScript(true, TEST_VERSION);

      expect(script.content).toContain("attach");
    });

    it("falls back to standalone mode with all args", () => {
      const script = generateOpencodeScript(true, TEST_VERSION);

      // Last line should pass all args
      expect(script.content).toContain('"%OPENCODE_BIN%" %*');
    });

    it("runs attach command directly (no background process)", () => {
      const script = generateOpencodeScript(true, TEST_VERSION);

      // Should call attach directly, not with start /b
      expect(script.content).toContain('"%OPENCODE_BIN%" attach');
      expect(script.content).not.toContain("start /b");
      expect(script.content).not.toContain("timeout");
      expect(script.content).not.toContain("tasklist");
    });
  });
});

describe("generateScripts", () => {
  const TEST_VERSION = "1.0.163";
  // Path format matches what BinaryDownloadService produces: <dataRoot>/opencode/<version>/opencode
  const createTargetPaths = (
    opencodePath: string | null = `/app/opencode/${TEST_VERSION}/opencode`
  ): BinTargetPaths => ({
    codeRemoteCli: "/app/code-server/lib/vscode/bin/remote-cli/code-linux.sh",
    opencodeBinary: opencodePath,
  });

  describe("platform detection", () => {
    it("uses Unix template on Linux", () => {
      const platformInfo = createMockPlatformInfo({ platform: "linux" });
      const scripts = generateScripts(platformInfo, createTargetPaths());

      // All scripts should be Unix-style (no .cmd extension)
      expect(scripts.every((s) => !s.filename.endsWith(".cmd"))).toBe(true);
      expect(scripts.every((s) => s.needsExecutable)).toBe(true);
    });

    it("uses Unix template on macOS", () => {
      const platformInfo = createMockPlatformInfo({ platform: "darwin" });
      const scripts = generateScripts(platformInfo, createTargetPaths());

      expect(scripts.every((s) => !s.filename.endsWith(".cmd"))).toBe(true);
      expect(scripts.every((s) => s.needsExecutable)).toBe(true);
    });

    it("uses Windows template on Windows", () => {
      const platformInfo = createMockPlatformInfo({ platform: "win32" });
      const scripts = generateScripts(platformInfo, createTargetPaths());

      expect(scripts.every((s) => s.filename.endsWith(".cmd"))).toBe(true);
      expect(scripts.every((s) => !s.needsExecutable)).toBe(true);
    });
  });

  describe("script generation", () => {
    it("generates consistent set per platform (Linux)", () => {
      const platformInfo = createMockPlatformInfo({ platform: "linux" });
      const scripts = generateScripts(platformInfo, createTargetPaths());

      const filenames = scripts.map((s) => s.filename);
      expect(filenames).toContain("code");
      expect(filenames).toContain("opencode");
      expect(scripts).toHaveLength(2);
    });

    it("generates consistent set per platform (Windows)", () => {
      const platformInfo = createMockPlatformInfo({ platform: "win32" });
      const scripts = generateScripts(platformInfo, createTargetPaths());

      const filenames = scripts.map((s) => s.filename);
      expect(filenames).toContain("code.cmd");
      expect(filenames).toContain("opencode.cmd");
      expect(scripts).toHaveLength(2);
    });

    it("skips opencode when null", () => {
      const platformInfo = createMockPlatformInfo({ platform: "linux" });
      const scripts = generateScripts(platformInfo, createTargetPaths(null));

      const filenames = scripts.map((s) => s.filename);
      expect(filenames).toContain("code");
      expect(filenames).not.toContain("opencode");
      expect(scripts).toHaveLength(1);
    });

    it("skips opencode when version cannot be extracted from path", () => {
      const platformInfo = createMockPlatformInfo({ platform: "linux" });
      // A path without proper structure - just a filename without parent dir
      const scripts = generateScripts(platformInfo, createTargetPaths("opencode"));

      const filenames = scripts.map((s) => s.filename);
      expect(filenames).toContain("code");
      expect(filenames).not.toContain("opencode");
      expect(scripts).toHaveLength(1);
    });

    it("extracts version from Windows-style path", () => {
      const platformInfo = createMockPlatformInfo({ platform: "win32" });
      const targetPaths: BinTargetPaths = {
        codeRemoteCli: "C:\\app\\code-server\\bin\\code-server.cmd",
        opencodeBinary: `C:\\app\\opencode\\${TEST_VERSION}\\opencode.exe`,
      };
      const scripts = generateScripts(platformInfo, targetPaths);

      const opencodeScript = scripts.find((s) => s.filename === "opencode.cmd");
      expect(opencodeScript?.content).toContain(`opencode\\${TEST_VERSION}\\opencode.exe`);
    });

    it("includes correct target path in code script", () => {
      const platformInfo = createMockPlatformInfo({ platform: "linux" });
      const targetPaths = createTargetPaths();
      const scripts = generateScripts(platformInfo, targetPaths);

      const codeScript = scripts.find((s) => s.filename === "code");

      expect(codeScript?.content).toContain(targetPaths.codeRemoteCli);
    });

    it("opencode script uses smart managed/standalone logic", () => {
      const platformInfo = createMockPlatformInfo({ platform: "linux" });
      const scripts = generateScripts(platformInfo, createTargetPaths());

      const opencodeScript = scripts.find((s) => s.filename === "opencode");

      // Should use relative paths to versioned directory, not symlink
      expect(opencodeScript?.content).toContain(`../opencode/${TEST_VERSION}/opencode`);
      expect(opencodeScript?.content).toContain("ports.json");
    });
  });
});
