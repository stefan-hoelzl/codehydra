import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "path";

export default defineConfig({
  plugins: [svelte()],
  root: resolve(__dirname),
  base: "/codehydra/", // GitHub Pages subdirectory (works for custom domain too)
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
