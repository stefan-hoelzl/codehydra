import { defineConfig, type UserConfig } from "vite";

/**
 * Base Vite configuration for VS Code extensions.
 * Individual extensions should merge this with their own config to provide the entry point.
 */
const baseConfig: UserConfig = {
  build: {
    lib: {
      entry: "", // Must be overridden by each extension
      formats: ["cjs"],
      fileName: () => "extension.js",
    },
    rollupOptions: {
      external: ["vscode", "bufferutil", "utf-8-validate"],
    },
    minify: false,
    sourcemap: false,
    emptyOutDir: true,
  },
};

export default defineConfig(baseConfig);
