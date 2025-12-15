/**
 * Barrel export for IPC modules.
 */

// Setup handlers (registered early in bootstrap, before startServices)
export {
  createSetupReadyHandler,
  createSetupStartHandler,
  createSetupRetryHandler,
  createSetupQuitHandler,
  type SetupEventEmitters,
} from "./setup-handlers";

// API handlers (registered in startServices via CodeHydraApiImpl)
export { registerApiHandlers, wireApiEvents } from "./api-handlers";
