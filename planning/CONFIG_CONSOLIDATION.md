---
status: COMPLETED
last_updated: 2026-01-02
reviewers: [review-typescript, review-docs]
---

# CONFIG_CONSOLIDATION

## Overview

- **Problem**: Configuration files are duplicated and inconsistently structured across the monorepo (app, extensions, site). Extensions use esbuild while everything else uses Vite. TypeScript configs don't follow a clear inheritance hierarchy.
- **Solution**: Consolidate configs with clear inheritance - base settings at root, environment-specific overrides in subdirectories. Migrate extensions from esbuild to Vite for tooling consistency.
- **Risks**:
  - electron-vite may expect specific tsconfig locations - **Mitigation**: Test `pnpm dev` and `pnpm build` after each phase to catch issues early
  - Extension Vite build must produce identical output to current esbuild build (CJS, externals) - **Mitigation**: Compare bundle sizes and verify imports after migration
- **Alternatives Considered**:
  - Separate `config/` directory for base configs - rejected for simplicity (configs live with code)
  - Keep esbuild for extensions - rejected for tooling consistency and Vitest integration

## Architecture

```
BEFORE                                    AFTER
======                                    =====

tsconfig.json (base+refs)                 tsconfig.json (base + ESM defaults + refs)
tsconfig.node.json (main/services)        │
tsconfig.web.json (renderer)              ├── src/tsconfig.node.json
                                          ├── src/renderer/tsconfig.web.json
extensions/dictation/tsconfig.json        ├── extensions/tsconfig.ext.json
extensions/dictation/esbuild.config.js    │   └── vite.config.ext.ts (shared)
extensions/sidekick/esbuild.config.js     │
extensions/sidekick/extension.js          │   (sidekick restructured to src/)
                                          └── site/tsconfig.web.json
site/tsconfig.json
site/svelte.config.js (duplicate)              (deleted - uses root)

Inheritance:
┌─────────────────────────────────────────────────────────────────┐
│                      tsconfig.json                              │
│              (strict rules + ESM module defaults)               │
│       references: [src/tsconfig.node, src/renderer/tsconfig.web]│
└───────┬──────────────┬──────────────┬──────────────┬────────────┘
        │              │              │              │
        ▼              ▼              ▼              ▼
   src/tsconfig   src/renderer/   extensions/    site/
    .node.json    tsconfig.web    tsconfig.ext   tsconfig.web
   (+Node types)  (+DOM types)    (→CommonJS)    (+DOM types)
```

## Implementation Steps

### Phase 1: TypeScript Config Restructure

- [x] **Step 1: Update root tsconfig.json**
  - Add common module settings: `module`, `moduleResolution`, `target`
  - Keep all strict settings
  - Update `references` to point to new locations: `src/tsconfig.node.json`, `src/renderer/tsconfig.web.json`
  - Keep `files: []` (required for project references)
  - Files: `tsconfig.json`
  - Test: N/A (references point to files that don't exist yet)

- [x] **Step 2: Create src/tsconfig.node.json**
  - Move content from root `tsconfig.node.json`
  - Update `extends` to `../tsconfig.json`
  - Adjust paths (remove `src/` prefix from includes)
  - Files: `src/tsconfig.node.json`
  - Test: `pnpm check` passes

- [x] **Step 3: Create src/renderer/tsconfig.web.json**
  - Move content from root `tsconfig.web.json`
  - Update `extends` to `../../tsconfig.json`
  - Add `lib: ["ESNext", "DOM", "DOM.Iterable"]`
  - Adjust paths and includes
  - Files: `src/renderer/tsconfig.web.json`
  - Test: `pnpm check` passes

- [x] **Step 4: Delete old root tsconfig files**
  - Delete `tsconfig.node.json`
  - Delete `tsconfig.web.json`
  - Files: (deletions)
  - Test: `pnpm check` passes

- [x] **Step 5: Verify electron-vite compatibility**
  - electron-vite uses Vite's built-in TypeScript handling, not explicit tsconfig references
  - Verify `pnpm build` succeeds with new tsconfig locations
  - Verify `pnpm dev` starts correctly
  - Files: (none - verification only)
  - Test: `pnpm build` succeeds, `pnpm dev` starts

- [x] **Step 6: Verify vitest alias resolution**
  - Run full test suite to confirm `$lib/*`, `@shared/*`, `@services/*` aliases resolve
  - Files: (none - verification only)
  - Test: `pnpm test` passes with no import resolution errors

- [x] **Step 7: Update site/tsconfig.json**
  - Rename to `site/tsconfig.web.json`
  - Update `extends` to `../tsconfig.json` (was `../tsconfig.web.json` which is now deleted)
  - Add DOM-specific settings: `lib: ["ESNext", "DOM", "DOM.Iterable"]`
  - Files: `site/tsconfig.web.json` (renamed from `site/tsconfig.json`)
  - Test: `pnpm site:check` passes

- [x] **Step 8: Delete site/svelte.config.js**
  - Site will use root svelte.config.js (Vite resolves relative to root)
  - Files: `site/svelte.config.js` (delete)
  - Test: `pnpm site:build` succeeds, verify svelte components compile correctly

- [x] **Step 9: Create extensions/tsconfig.ext.json**
  - Consolidate extension TypeScript settings
  - Extends `../tsconfig.json`
  - Override to CommonJS: `module: "CommonJS"`, `moduleResolution: "node"`, `target: "ES2020"`
  - Add `lib: ["ES2020"]`
  - Add `declaration: false`, `noEmit: true` (from current dictation config)
  - Include pattern: `*/src/**/*` (all extensions use src/ directory)
  - Delete `extensions/dictation/tsconfig.json`
  - Files: `extensions/tsconfig.ext.json`, `extensions/dictation/tsconfig.json` (delete)
  - Test: `pnpm check:extensions` passes (after updating script in Step 14)

### Phase 2: Extension Build Migration (esbuild → Vite)

- [x] **Step 10: Restructure sidekick extension to use src/ directory**
  - Move `extensions/sidekick/extension.js` to `extensions/sidekick/src/extension.js`
  - Update `package.json` main field if needed
  - This aligns sidekick with dictation's structure for shared tsconfig
  - Files: `extensions/sidekick/src/extension.js` (moved), `extensions/sidekick/package.json`
  - Test: N/A (build not updated yet)

- [x] **Step 11: Create extensions/vite.config.ext.ts**
  - Shared Vite config for all extensions using library mode
  - Configuration:

    ```typescript
    import { defineConfig } from "vite";

    export default defineConfig({
      build: {
        lib: {
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
    });
    ```

  - Files: `extensions/vite.config.ext.ts`
  - Test: N/A (no build yet)

- [x] **Step 12: Update sidekick extension build**
  - Create `extensions/sidekick/vite.config.ts`:

    ```typescript
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
    ```

  - Update `package.json`: remove `devDependencies` (esbuild), update build script to `vite build`
  - Delete `extensions/sidekick/esbuild.config.js`
  - Files: `extensions/sidekick/vite.config.ts`, `extensions/sidekick/package.json`, `extensions/sidekick/esbuild.config.js` (delete)
  - Test: Run `pnpm --filter sidekick build`, verify:
    - `dist/extension.js` exists and is CommonJS (uses `require`/`module.exports`)
    - No bundled copies of vscode or ws dependencies
    - File size comparable to previous esbuild output

- [x] **Step 13: Update dictation extension build**
  - Create `extensions/dictation/vite.config.ts`:

    ```typescript
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
    ```

  - Update `package.json`: remove `devDependencies` (esbuild, typescript, @types/vscode), update build script to `vite build`
  - Delete `extensions/dictation/esbuild.config.js`
  - Files: `extensions/dictation/vite.config.ts`, `extensions/dictation/package.json`, `extensions/dictation/esbuild.config.js` (delete)
  - Test: Run `pnpm --filter codehydra-dictation build`, verify:
    - `dist/extension.js` exists and is CommonJS
    - `dist/audio/webview.html` and `dist/audio/audio-processor.js` exist
    - File size comparable to previous esbuild output

- [x] **Step 14: Update build-extensions.ts**
  - Replace esbuild invocation with `pnpm --filter './extensions/*' build`
  - Remove shell-specific esbuild execution code
  - Keep version injection and vsce packaging logic
  - Files: `scripts/build-extensions.ts`
  - Test: `pnpm build:extensions` succeeds, verify .vsix files are created

### Phase 3: Cleanup

- [x] **Step 15: Update package.json scripts**
  - Update `check:extensions` to: `tsc -p extensions/tsconfig.ext.json`
  - Files: `package.json`
  - Test: `pnpm check:extensions` passes, `pnpm validate` passes

- [x] **Step 16: Update AGENTS.md**
  - Update "VS Code Assets > Build Process" section:
    - Change "Extension packaging: `pnpm build:extensions` auto-discovers extension folders, packages them to `dist/extensions/`" to reflect Vite usage
    - Remove any references to esbuild.config.js files
  - Update "Tech Stack" table if it mentions esbuild (currently only mentions "Build: Vite" so likely OK)
  - Files: `AGENTS.md`
  - Test: N/A

- [x] **Step 17: Verify full build pipeline**
  - Run complete validation to ensure all changes work together
  - Files: (none - verification only)
  - Test: `pnpm validate` passes

## Testing Strategy

### Integration Tests

No new integration tests needed - this is a build infrastructure change.

| #   | Test Case                | Entry Point             | Behavior Verified                     |
| --- | ------------------------ | ----------------------- | ------------------------------------- |
| 1   | Existing extension tests | `vitest run extensions` | Extensions still build and tests pass |

### Manual Testing Checklist

- [ ] `pnpm check` passes (TypeScript for app)
- [ ] `pnpm check:extensions` passes (TypeScript for extensions)
- [ ] `pnpm site:check` passes (TypeScript for site)
- [ ] `pnpm build` succeeds (full app build including extensions)
- [ ] `pnpm test` passes (all tests)
- [ ] `pnpm site:build` succeeds (landing page)
- [ ] `pnpm dev` works (development mode)
- [ ] Built extensions work in VS Code:
  - Install sidekick .vsix: extension activates without errors
  - Install dictation .vsix: extension activates, webview loads, audio processor accessible
- [ ] Compare extension bundle sizes (Vite vs esbuild): should be comparable (within 20%)

## Dependencies

No new dependencies required.

| Package | Purpose | Approved |
| ------- | ------- | -------- |
| (none)  | -       | -        |

Note: `vite-plugin-static-copy` is already a root dependency.

## Documentation Updates

### Files to Update

| File        | Changes Required                                                                   |
| ----------- | ---------------------------------------------------------------------------------- |
| `AGENTS.md` | Update VS Code Assets > Build Process section to reflect Vite usage for extensions |

### New Documentation Required

| File   | Purpose |
| ------ | ------- |
| (none) | -       |

## Definition of Done

- [ ] All implementation steps complete
- [ ] `pnpm validate:fix` passes
- [ ] Documentation updated
- [ ] User acceptance testing passed
- [ ] CI passed
- [ ] Merged to main
