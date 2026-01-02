import { defineConfig, mergeConfig } from "vite";
import baseConfig from "../vite.config.ext";

export default mergeConfig(
  baseConfig,
  defineConfig({
    build: {
      lib: {
        entry: "src/extension.js",
      },
      outDir: "dist",
    },
  })
);
