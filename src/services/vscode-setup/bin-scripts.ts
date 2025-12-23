/**
 * Utility module for generating platform-specific CLI wrapper scripts.
 *
 * This module contains pure functions that generate script content based on:
 * - Target binary paths
 * - Platform information (linux, darwin, win32)
 *
 * The generated scripts allow users to run `code` and `opencode`
 * from the integrated terminal without needing to know the full binary paths.
 *
 * The opencode wrapper script is "smart" - it checks if CodeHydra is managing
 * a server for the current workspace and attaches to it if so. Otherwise,
 * it falls back to standalone mode.
 */

import type { PlatformInfo } from "../platform/platform-info";
import type { BinTargetPaths, GeneratedScript, ScriptFilename } from "./types";

/**
 * Create a branded ScriptFilename.
 */
function asScriptFilename(name: string): ScriptFilename {
  return name as ScriptFilename;
}

/**
 * Generate Unix (Linux/macOS) wrapper script content for simple passthrough.
 * Uses exec to replace the shell process with the target binary.
 * Single quotes around path handle most special characters.
 *
 * @param targetPath - Absolute path to the target binary
 * @returns Shell script content
 */
function generateUnixScript(targetPath: string): string {
  // Escape single quotes in path by ending quote, adding escaped quote, starting new quote
  const escapedPath = targetPath.replace(/'/g, "'\\''");
  return `#!/bin/sh
exec '${escapedPath}' "$@"
`;
}

/**
 * Generate Windows wrapper script content (.cmd) for simple passthrough.
 * Uses double quotes around path for proper handling.
 *
 * @param targetPath - Absolute path to the target binary
 * @returns CMD script content
 */
function generateWindowsScript(targetPath: string): string {
  // Convert forward slashes to backslashes for Windows paths
  const windowsPath = targetPath.replace(/\//g, "\\");
  return `@echo off
"${windowsPath}" %*
`;
}

/**
 * Generate Unix opencode wrapper that uses managed server mode when available.
 *
 * Logic:
 * 1. Find git root for current directory
 * 2. Read ports.json and look up port for this workspace
 * 3. If port found: run `opencode attach http://127.0.0.1:$PORT`
 * 4. If port not found: run `opencode "$@"` (standalone mode)
 *
 * The script runs `opencode attach` directly via exec. If the server isn't
 * available, the attach command will fail fast on its own.
 *
 * @param opencodeVersion - Version of opencode binary (e.g., "1.0.163")
 */
function generateUnixOpencodeScript(opencodeVersion: string): string {
  return `#!/bin/sh
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PORTS_FILE="$SCRIPT_DIR/../opencode/ports.json"
OPENCODE_BIN="$SCRIPT_DIR/../opencode/${opencodeVersion}/opencode"

GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)

# If in a git repo and ports file exists, try managed mode
if [ -n "$GIT_ROOT" ] && [ -f "$PORTS_FILE" ]; then
    # Parse JSON to find port for this workspace
    # Use grep/sed for portability (no jq dependency)
    # Format: "path": { "port": 14001 }
    PORT=$(grep -A1 "\\"$GIT_ROOT\\"" "$PORTS_FILE" 2>/dev/null | grep '"port"' | sed 's/.*: *\\([0-9]*\\).*/\\1/')

    if [ -n "$PORT" ]; then
        # Managed mode: connect to existing server
        exec "$OPENCODE_BIN" attach "http://127.0.0.1:$PORT"
    fi
fi

# Standalone mode: pass all args
exec "$OPENCODE_BIN" "$@"
`;
}

/**
 * Generate Windows opencode wrapper that uses managed server mode when available.
 *
 * Logic mirrors Unix version but uses Windows scripting.
 * Runs `opencode attach` directly - if server isn't available, attach fails fast.
 *
 * @param opencodeVersion - Version of opencode binary (e.g., "1.0.163")
 */
function generateWindowsOpencodeScript(opencodeVersion: string): string {
  return `@echo off
setlocal EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "PORTS_FILE=%SCRIPT_DIR%..\\opencode\\ports.json"
set "OPENCODE_BIN=%SCRIPT_DIR%..\\opencode\\${opencodeVersion}\\opencode.exe"

for /f "tokens=*" %%i in ('git rev-parse --show-toplevel 2^>nul') do set "GIT_ROOT=%%i"

if defined GIT_ROOT if exist "%PORTS_FILE%" (
    REM Use PowerShell to parse JSON (available on all modern Windows)
    for /f "tokens=*" %%p in ('powershell -NoProfile -Command "(Get-Content '%PORTS_FILE%' | ConvertFrom-Json).workspaces.'%GIT_ROOT%'.port" 2^>nul') do set "PORT=%%p"

    if defined PORT (
        REM Managed mode: connect to existing server
        "%OPENCODE_BIN%" attach "http://127.0.0.1:!PORT!"
        exit /b
    )
)

"%OPENCODE_BIN%" %*
`;
}

/**
 * Generate a single wrapper script for a given tool.
 *
 * @param name - Script name without extension (e.g., "code")
 * @param targetPath - Absolute path to the target binary
 * @param isWindows - Whether generating for Windows platform
 * @returns Generated script with filename, content, and executable flag
 */
export function generateScript(
  name: string,
  targetPath: string,
  isWindows: boolean
): GeneratedScript {
  if (isWindows) {
    return {
      filename: asScriptFilename(`${name}.cmd`),
      content: generateWindowsScript(targetPath),
      needsExecutable: false, // Windows determines executability by extension
    };
  }

  return {
    filename: asScriptFilename(name),
    content: generateUnixScript(targetPath),
    needsExecutable: true, // Unix needs chmod +x
  };
}

/**
 * Generate the opencode wrapper script with managed/standalone mode logic.
 *
 * @param isWindows - Whether generating for Windows platform
 * @param opencodeVersion - Version of opencode binary (e.g., "1.0.163")
 * @returns Generated script with filename, content, and executable flag
 */
export function generateOpencodeScript(
  isWindows: boolean,
  opencodeVersion: string
): GeneratedScript {
  if (isWindows) {
    return {
      filename: asScriptFilename("opencode.cmd"),
      content: generateWindowsOpencodeScript(opencodeVersion),
      needsExecutable: false,
    };
  }

  return {
    filename: asScriptFilename("opencode"),
    content: generateUnixOpencodeScript(opencodeVersion),
    needsExecutable: true,
  };
}

/**
 * Extract version from opencode binary path.
 *
 * The path format is: <dataRoot>/opencode/<version>/opencode[.exe]
 * For example: /app/opencode/1.0.163/opencode -> "1.0.163"
 *
 * @param opencodePath - Path to opencode binary
 * @returns Version string or null if cannot be extracted
 */
function extractOpencodeVersion(opencodePath: string): string | null {
  // Split path and find version segment (parent directory of the binary)
  // Path format: .../opencode/<version>/opencode[.exe]
  const segments = opencodePath.split(/[/\\]/);
  // Version is the second-to-last segment (parent of the binary file)
  if (segments.length >= 2) {
    return segments[segments.length - 2] ?? null;
  }
  return null;
}

/**
 * Generate all wrapper scripts for the given platform and target paths.
 *
 * Scripts generated:
 * - `code` / `code.cmd` - Wrapper for code-server's remote-cli (VS Code CLI)
 * - `opencode` / `opencode.cmd` - Smart wrapper that uses managed mode when available
 *
 * Note: code-server wrapper is not generated because we launch code-server
 * directly with an absolute path.
 *
 * @param platformInfo - Platform information (for determining script type)
 * @param targetPaths - Paths to target binaries
 * @returns Array of generated scripts ready to write to disk
 */
export function generateScripts(
  platformInfo: PlatformInfo,
  targetPaths: BinTargetPaths
): GeneratedScript[] {
  const isWindows = platformInfo.platform === "win32";
  const scripts: GeneratedScript[] = [];

  // Generate code wrapper (for VS Code CLI)
  scripts.push(generateScript("code", targetPaths.codeRemoteCli, isWindows));

  // Generate opencode wrapper with managed/standalone mode logic
  if (targetPaths.opencodeBinary !== null) {
    const version = extractOpencodeVersion(targetPaths.opencodeBinary);
    if (version !== null) {
      scripts.push(generateOpencodeScript(isWindows, version));
    }
  }

  return scripts;
}
