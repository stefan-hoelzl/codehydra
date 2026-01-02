import { defineConfig, mergeConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import baseConfig from "../vite.config.ext";

export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [
      viteStaticCopy({
        targets: [
          { src: "src/audio/webview.html", dest: "audio" },
          { src: "src/audio/audio-processor.js", dest: "audio" },
        ],
      }),
    ],
    build: {
      lib: {
        entry: "src/extension.ts",
      },
      outDir: "dist",
    },
  })
);
