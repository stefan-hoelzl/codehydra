import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "path";

export default defineConfig({
  plugins: [svelte()],
  root: resolve(__dirname),
  base: "/", // Custom domain (codehydra.dev) - no subdirectory needed
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
