/**
 * Shell layer exports.
 *
 * Provides abstractions over Electron's visual container APIs:
 * - WindowLayer: BaseWindow abstraction
 * - ViewLayer: WebContentsView abstraction
 * - SessionLayer: Session abstraction
 */

// Errors
export { ShellError, isShellError, isShellErrorWithCode, type ShellErrorCode } from "./errors";

// Types
export {
  type WindowHandle,
  type ViewHandle,
  type SessionHandle,
  type Rectangle,
  type WebPreferences,
  createWindowHandle,
  createViewHandle,
  createSessionHandle,
} from "./types";

// Window layer
export {
  type WindowLayer,
  type WindowLayerInternal,
  type WindowOptions,
  type ContentView,
  type Unsubscribe,
  DefaultWindowLayer,
} from "./window";

// Session layer
export {
  type SessionLayer,
  type Permission,
  type PermissionRequestHandler,
  type PermissionCheckHandler,
  DefaultSessionLayer,
} from "./session";

// View layer
export {
  type ViewLayer,
  type ViewOptions,
  type WindowOpenDetails,
  type WindowOpenAction,
  type WindowOpenHandler,
  DefaultViewLayer,
} from "./view";
