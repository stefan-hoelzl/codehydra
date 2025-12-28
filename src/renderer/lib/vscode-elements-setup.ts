/**
 * VSCode Elements Setup
 *
 * This module imports and registers all vscode-elements web components.
 * Import this file once at application startup (in main.ts) before mounting the app.
 *
 * After import, vscode-elements are available globally as custom elements:
 * - <vscode-button>
 * - <vscode-textfield>
 * - <vscode-checkbox>
 * - <vscode-progress-bar>
 * - <vscode-progress-ring>
 * - <vscode-badge>
 * - <vscode-divider>
 * - <vscode-toolbar>
 * - <vscode-icon>
 * - <vscode-form-helper>
 * - etc.
 */

// Import codicon CSS URL (Vite resolves this to the bundled asset path)
// Must be loaded before vscode-elements to ensure icon font is available
import codiconCssUrl from "@vscode/codicons/dist/codicon.css?url";

// Create stylesheet link required by vscode-icon component
// Must be created before vscode-elements are used
const link = document.createElement("link");
link.rel = "stylesheet";
link.id = "vscode-codicon-stylesheet";
link.href = codiconCssUrl;
document.head.appendChild(link);

// Now import vscode-elements (after codicon stylesheet is set up)
import "@vscode-elements/elements/dist/bundled.js";
