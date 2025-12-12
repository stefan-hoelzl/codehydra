/**
 * GPU throttling configuration for workspace views.
 *
 * Provides multi-layer throttling to prevent GPU crashes with many workspaces:
 * - `off`: No throttling (current behavior)
 * - `basic`: setBackgroundThrottling + visibilitychange dispatch
 * - `full`: Basic + WebGL context loss to release GPU memory
 */

/**
 * Available throttle levels.
 */
export type ThrottleLevel = "off" | "basic" | "full";

/**
 * Parsed Electron command-line flag.
 */
export interface ElectronFlag {
  name: string;
  value?: string;
}

/**
 * Gets the current throttle level from environment variable.
 * Returns 'off' if not set or invalid (case-sensitive).
 *
 * Environment variable: CODEHYDRA_WORKSPACE_THROTTLING
 * Valid values: 'off', 'basic', 'full'
 */
export function getThrottleLevel(): ThrottleLevel {
  const value = process.env.CODEHYDRA_WORKSPACE_THROTTLING;
  if (value === "off" || value === "basic" || value === "full") {
    return value;
  }
  return "off";
}

/**
 * Parses Electron command-line flags from a string.
 *
 * @param flags - Space-separated flags string (e.g., "--disable-gpu --use-gl=swiftshader")
 * @returns Array of parsed flags
 * @throws Error if quotes are detected (not supported)
 */
export function parseElectronFlags(flags: string | undefined): ElectronFlag[] {
  if (!flags || !flags.trim()) {
    return [];
  }

  // Check for quotes (not supported)
  if (flags.includes('"') || flags.includes("'")) {
    throw new Error(
      "Quoted values are not supported in CODEHYDRA_ELECTRON_FLAGS. " +
        'Use --flag=value instead of --flag="value".'
    );
  }

  const result: ElectronFlag[] = [];

  // Split by whitespace and process each flag
  const parts = flags.trim().split(/\s+/);

  for (const part of parts) {
    // Remove leading dashes
    const withoutDashes = part.replace(/^--?/, "");

    // Check for value assignment
    const eqIndex = withoutDashes.indexOf("=");
    if (eqIndex !== -1) {
      result.push({
        name: withoutDashes.substring(0, eqIndex),
        value: withoutDashes.substring(eqIndex + 1),
      });
    } else {
      result.push({ name: withoutDashes });
    }
  }

  return result;
}

/**
 * Applies Electron command-line flags from environment variable.
 * Must be called BEFORE app.whenReady().
 *
 * Environment variable: CODEHYDRA_ELECTRON_FLAGS
 * Example: "--disable-gpu --use-gl=swiftshader"
 *
 * @param app - Electron app instance
 */
export function applyElectronFlags(app: Electron.App): void {
  const flags = process.env.CODEHYDRA_ELECTRON_FLAGS;
  if (!flags) {
    return;
  }

  const parsed = parseElectronFlags(flags);

  for (const flag of parsed) {
    if (flag.value !== undefined) {
      app.commandLine.appendSwitch(flag.name, flag.value);
      console.log(`[CodeHydra] Applied Electron flag: --${flag.name}=${flag.value}`);
    } else {
      app.commandLine.appendSwitch(flag.name);
      console.log(`[CodeHydra] Applied Electron flag: --${flag.name}`);
    }
  }
}
