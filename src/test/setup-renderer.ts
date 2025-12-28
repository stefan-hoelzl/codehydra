/**
 * Setup file for renderer tests.
 * Loads vscode-elements and provides happy-dom compatibility mocks.
 */

// Mock attachInternals for vscode-elements in happy-dom
if (typeof HTMLElement.prototype.attachInternals === "undefined") {
  HTMLElement.prototype.attachInternals = function () {
    return {
      setFormValue: () => {},
      setValidity: () => {},
      states: new Set(),
    } as unknown as ElementInternals;
  };
}

// Create codicon stylesheet link required by vscode-icon component
// Must be created before vscode-elements are imported
const link = document.createElement("link");
link.rel = "stylesheet";
link.id = "vscode-codicon-stylesheet";
link.href = ""; // Empty href is fine for tests - we just need the element to exist
document.head.appendChild(link);

// Import vscode-elements so custom elements are registered
import "@vscode-elements/elements/dist/bundled.js";
