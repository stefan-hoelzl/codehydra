/**
 * Initial prompt utility for sending a prompt to a freshly started OpenCode server.
 *
 * This is used when creating a workspace with an initial prompt - the prompt is
 * sent asynchronously after the server becomes healthy.
 */

import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import type { Logger } from "../logging";
import { getErrorMessage } from "../errors";
import type { PromptModel } from "../../shared/api/types";

/**
 * Factory function type for creating SDK clients.
 * Used for dependency injection and testing.
 */
export type SdkClientFactory = (baseUrl: string) => OpencodeClient;

/**
 * Default SDK factory that creates a real OpencodeClient.
 */
export const defaultSdkFactory: SdkClientFactory = (baseUrl: string) =>
  createOpencodeClient({ baseUrl });

/**
 * Send an initial prompt to an OpenCode server.
 *
 * This function has fire-and-forget semantics:
 * - Catches all errors and logs them
 * - Never throws exceptions
 * - Returns void regardless of success/failure
 *
 * Used when creating a workspace with an initial prompt.
 *
 * @param port - Port number of the OpenCode server
 * @param prompt - The prompt text to send
 * @param agent - Optional agent name to use (e.g., "code", "build")
 * @param model - Optional model to use (providerID + modelID)
 * @param logger - Logger for error reporting
 * @param sdkFactory - Factory for creating SDK clients (default: createOpencodeClient)
 */
export async function sendInitialPrompt(
  port: number,
  prompt: string,
  agent: string | undefined,
  model: PromptModel | undefined,
  logger: Logger,
  sdkFactory: SdkClientFactory = defaultSdkFactory
): Promise<void> {
  try {
    const baseUrl = `http://localhost:${port}`;
    const sdk = sdkFactory(baseUrl);

    // Create a new session
    const sessionResult = await sdk.session.create({ body: {} });
    if (!sessionResult.data) {
      logger.error("Failed to send initial prompt: session creation returned no data", {
        port,
        prompt: prompt.substring(0, 50),
        ...(agent !== undefined && { agent }),
      });
      return;
    }

    const sessionId = sessionResult.data.id;

    // Send the prompt
    await sdk.session.prompt({
      path: { id: sessionId },
      body: {
        ...(agent !== undefined && { agent }),
        ...(model !== undefined && { model }),
        parts: [{ type: "text", text: prompt }],
      },
    });

    logger.info("Initial prompt sent", {
      port,
      sessionId,
      promptLength: prompt.length,
      ...(agent !== undefined && { agent }),
      ...(model !== undefined && { model: `${model.providerID}/${model.modelID}` }),
    });
  } catch (error) {
    logger.error("Failed to send initial prompt", {
      port,
      prompt: prompt.substring(0, 50),
      ...(agent !== undefined && { agent }),
      ...(model !== undefined && { model: `${model.providerID}/${model.modelID}` }),
      error: getErrorMessage(error),
    });
  }
}
