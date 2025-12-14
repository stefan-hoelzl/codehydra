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

// Import vscode-elements so custom elements are registered
import "@vscode-elements/elements/dist/bundled.js";
