/**
 * Process spawning utilities.
 */

import { execa, type Options as ExecaOptions, type ResultPromise } from "execa";
import { createServer } from "net";

/**
 * Find an available port on the system.
 * Uses the Node.js net module to bind to port 0, which the OS assigns an available port.
 *
 * @returns Promise resolving to an available port number
 */
export async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Failed to get port from server address")));
      }
    });
    server.on("error", reject);
  });
}

export interface SpawnProcessOptions {
  /** Working directory for the process */
  readonly cwd?: string;
  /** Environment variables */
  readonly env?: NodeJS.ProcessEnv;
  /** Timeout in milliseconds */
  readonly timeout?: number;
}

/**
 * Spawn a process with cleanup options.
 * Uses execa with cleanup: true to ensure child processes are terminated
 * when the parent exits.
 *
 * @param command Command to run
 * @param args Command arguments
 * @param options Spawn options
 * @returns Execa result promise with subprocess handle
 */
export function spawnProcess(
  command: string,
  args: string[],
  options: SpawnProcessOptions = {}
): ResultPromise {
  const execaOptions: ExecaOptions = {
    cleanup: true,
    cwd: options.cwd,
    env: options.env,
    timeout: options.timeout,
    // Capture output as strings
    encoding: "utf8",
    // Don't reject on non-zero exit (we handle this ourselves)
    reject: true,
  };

  return execa(command, args, execaOptions);
}
