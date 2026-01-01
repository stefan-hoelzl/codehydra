/**
 * Shell layer exports.
 *
 * Provides abstractions over Electron's visual container APIs:
 * - WindowLayer: BaseWindow abstraction
 * - ViewLayer: WebContentsView abstraction (Slice 5)
 * - SessionLayer: Session abstraction (Slice 5)
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
