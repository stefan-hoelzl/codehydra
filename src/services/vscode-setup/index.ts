/**
 * VS Code setup service exports.
 */

export { VscodeSetupService } from "./vscode-setup-service";
export { WrapperScriptGenerationService } from "./wrapper-script-generation-service";
export { generateScript, generateScripts } from "./bin-scripts";
export {
  CURRENT_SETUP_VERSION,
  type IVscodeSetup,
  type SetupResult,
  type SetupError,
  type SetupStep,
  type SetupProgress,
  type ProgressCallback,
  type SetupMarker,
  type ProcessRunner,
  type ProcessResult,
  type BinTargetPaths,
  type GeneratedScript,
  type ScriptFilename,
  type ExtensionsConfig,
  type BundledExtensionConfig,
  type PreflightResult,
  type PreflightError,
  type PreflightErrorType,
  type BinaryType,
  validateExtensionsConfig,
} from "./types";
export { parseExtensionDir, listInstalledExtensions } from "./extension-utils";
