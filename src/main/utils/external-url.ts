/**
 * Cross-platform external URL opener with security validation.
 * Opens URLs in the system's default browser/handler.
 */

import { exec } from "node:child_process";

/**
 * Allowed URL schemes. Only these schemes will be opened externally.
 * This is a security measure to prevent opening potentially dangerous schemes.
 */
export const ALLOWED_SCHEMES: readonly string[] = ["http:", "https:", "mailto:"];

/**
 * Validates a URL and checks if its scheme is allowed.
 * @param url - The URL to validate
 * @returns The parsed URL object
 * @throws Error if the URL is invalid or scheme is not allowed
 */
function validateUrl(url: string): URL {
  // Parse the URL (will throw if invalid)
  const parsed = new URL(url);

  // Check if the scheme is allowed
  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
    throw new Error(`URL scheme '${parsed.protocol}' is not allowed`);
  }

  return parsed;
}

/**
 * Opens an external URL in the system's default browser/handler.
 *
 * Security:
 * - Validates URL scheme against allowlist before opening
 * - Throws for blocked schemes (file://, javascript:, data:, etc.)
 *
 * Fire-and-forget:
 * - Does not throw if the external open fails
 * - Logs errors to console
 *
 * Platform behavior:
 * - Linux: gdbus portal → xdg-open fallback
 * - macOS: open command
 * - Windows: start command
 *
 * @param url - The URL to open
 * @throws Error if the URL is invalid or scheme is not allowed
 */
export function openExternal(url: string): void {
  // Validate URL and scheme (throws on failure)
  validateUrl(url);

  // Get platform-specific opener
  const platform = process.platform;

  if (platform === "linux") {
    openOnLinux(url);
  } else if (platform === "darwin") {
    openOnMac(url);
  } else if (platform === "win32") {
    openOnWindows(url);
  } else {
    console.error(`Failed to open external URL: unsupported platform '${platform}'`);
  }
}

/**
 * Opens a URL on Linux using gdbus portal, falling back to xdg-open.
 */
function openOnLinux(url: string): void {
  // Try gdbus portal first (preferred, works in sandboxed environments)
  const gdbusCommand = `gdbus call --session --dest org.freedesktop.portal.Desktop --object-path /org/freedesktop/portal/desktop --method org.freedesktop.portal.OpenURI.OpenURI "" "${url}" {}`;

  exec(gdbusCommand, (error) => {
    if (error) {
      // Fallback to xdg-open
      exec(`xdg-open "${url}"`, (fallbackError) => {
        if (fallbackError) {
          console.error(`Failed to open external URL: ${url}`);
        }
      });
    }
  });
}

/**
 * Opens a URL on macOS using the open command.
 */
function openOnMac(url: string): void {
  exec(`open "${url}"`, (error) => {
    if (error) {
      console.error(`Failed to open external URL: ${url}`);
    }
  });
}

/**
 * Opens a URL on Windows using the start command.
 */
function openOnWindows(url: string): void {
  // The empty string "" is for the window title (required for start command when URL has special chars)
  exec(`start "" "${url}"`, (error) => {
    if (error) {
      console.error(`Failed to open external URL: ${url}`);
    }
  });
}
