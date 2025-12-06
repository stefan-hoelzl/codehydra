/**
 * Preload script for code-server WebContentsViews.
 *
 * SECURITY: This script MUST NOT use contextBridge.exposeInMainWorld()
 * Code-server views load potentially untrusted content (extensions, extension webviews).
 * They must have minimal privileges.
 *
 * Currently only suppresses Alt keyup to prevent VS Code menu activation.
 * Full keyboard capture (Alt+X mode) is Phase 5 scope.
 */

/**
 * Suppress Alt keyup to prevent VS Code menu activation.
 * Uses capture phase to intercept before VS Code handles it.
 */
window.addEventListener(
  "keyup",
  (e) => {
    if (e.key === "Alt") {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  },
  true // Capture phase
);
