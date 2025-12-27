---
status: COMPLETED
last_updated: 2024-12-28
reviewers: [review-arch, review-docs]
---

# EXTENSIONS_DIRECTORY

## Overview

- **Problem**: VS Code extension source is buried in `src/services/vscode-setup/assets/codehydra-sidekick/`, making it hard to find and not scalable for multiple extensions
- **Solution**: Create a dedicated `extensions/` directory at project root for all VS Code extension sources
- **Risks**: Minimal - straightforward file relocation with path updates
- **Alternatives Considered**:
  - Keep extensions in `src/` - rejected because extensions are independent packages, not part of the main app source
  - Put vsix output in `extensions/` - rejected to keep source and build artifacts separated
  - Keep `extensions.json` with consuming service (`src/services/vscode-setup/`) - trade-off between "group by type" vs "group by feature"; chose to keep it with extensions for discoverability

## Architecture

```
BEFORE:
src/services/vscode-setup/assets/
├── extensions.json
├── codehydra-sidekick-0.0.2.vsix  (built, gitignored)
└── codehydra-sidekick/
    └── [extension source]

AFTER:
extensions/                          # Source only (in git)
├── extensions.json                  # Manifest
├── README.md                        # Documents structure for adding extensions
└── codehydra-sidekick/              # Extension source
    └── [extension source]

dist/extensions/                     # Build artifacts (gitignored)
├── extensions.json                  # Copied by build:extensions
└── codehydra-sidekick-0.0.2.vsix   # Built by build:extensions

out/main/assets/                     # Final output (copied by electron-vite)
├── extensions.json
└── codehydra-sidekick-0.0.2.vsix
```

### Build Flow

```
npm run build:extensions
    │
    ├─► mkdir -p dist/extensions (ensure directory exists)
    │
    ├─► cd extensions/codehydra-sidekick
    │   └─► npm install && npm run build && vsce package
    │       └─► outputs to dist/extensions/codehydra-sidekick-0.0.2.vsix
    │
    └─► cp extensions/extensions.json dist/extensions/

npm run build (includes electron-vite build)
    │
    └─► vite-plugin-static-copy
        └─► dist/extensions/* → out/main/assets/
```

**Note**: `npm run build` (line 12 in package.json) chains `build:extensions` before `electron-vite build`, ensuring `dist/extensions/` exists when vite-plugin-static-copy runs.

## Implementation Steps

- [x] **Step 1: Create extensions directory and move files**
  - Create `extensions/` directory at project root
  - Move `src/services/vscode-setup/assets/codehydra-sidekick/` to `extensions/codehydra-sidekick/`
  - Move `src/services/vscode-setup/assets/extensions.json` to `extensions/extensions.json`
  - Create `extensions/README.md` documenting structure for adding new extensions
  - Files affected: directory structure only
  - Test criteria: Files exist in new location, README created

- [x] **Step 2: Search and update hardcoded path references**
  - Search codebase for references to `src/services/vscode-setup/assets/codehydra-sidekick`
  - Update any comments, documentation strings, or error messages
  - Known reference: `src/services/plugin-server/plugin-server.boundary.test.ts` line 775
  - Files affected: any files with hardcoded references
  - Test criteria: `grep -r "vscode-setup/assets/codehydra-sidekick" .` returns no results (excluding planning/)

- [x] **Step 3: Update package.json build script**
  - Rename `build:extension` to `build:extensions`
  - Update script to build to `dist/extensions/` and copy manifest
  - Update `build` script dependency from `build:extension` to `build:extensions`

  **Before (lines 11-12):**

  ```json
  "build:extension": "cd src/services/vscode-setup/assets/codehydra-sidekick && npm install && npm run build && vsce package --no-dependencies -o ../codehydra-sidekick-0.0.2.vsix",
  "build": "npm run build:extension && electron-vite build",
  ```

  **After:**

  ```json
  "build:extensions": "mkdir -p dist/extensions && cd extensions/codehydra-sidekick && npm install && npm run build && vsce package --no-dependencies -o ../../dist/extensions/codehydra-sidekick-0.0.2.vsix && cp ../../extensions/extensions.json ../../dist/extensions/",
  "build": "npm run build:extensions && electron-vite build",
  ```

  - Files affected: `package.json`
  - Test criteria: `npm run build:extensions` succeeds, creates `dist/extensions/codehydra-sidekick-0.0.2.vsix` and `dist/extensions/extensions.json`

- [x] **Step 4: Update electron.vite.config.ts**
  - Change vite-plugin-static-copy to copy from `dist/extensions/*` to `assets`

  **Before (lines 19-22):**

  ```typescript
  viteStaticCopy({
    targets: [
      { src: "src/services/vscode-setup/assets/extensions.json", dest: "assets" },
      { src: "src/services/vscode-setup/assets/*.vsix", dest: "assets" },
    ],
  }),
  ```

  **After:**

  ```typescript
  viteStaticCopy({
    targets: [
      { src: "dist/extensions/*", dest: "assets" },
    ],
  }),
  ```

  - Files affected: `electron.vite.config.ts`
  - Test criteria: `npm run build` copies `extensions.json` and `codehydra-sidekick-0.0.2.vsix` to `out/main/assets/`

- [x] **Step 5: Update eslint.config.js**
  - Change ignore pattern from `src/services/vscode-setup/assets/codehydra-sidekick/` to `extensions/`
  - Files affected: `eslint.config.js`
  - Test criteria: `npm run lint` passes, ignores extensions directory

- [x] **Step 6: Update documentation**
  - Update `AGENTS.md` "VS Code Assets" section:
    - Update "Asset Files" table: change `src/services/vscode-setup/assets/extensions.json` to `extensions/extensions.json`
    - Update "Asset Files" table: change `src/services/vscode-setup/assets/codehydra-sidekick/` to `extensions/codehydra-sidekick/`
    - Update "Build Process" section: rename `build:extension` to `build:extensions`, update paths to `dist/extensions/`
  - Update `docs/ARCHITECTURE.md`:
    - Search for all references to `src/services/vscode-setup/assets/` and update to `extensions/`
  - Files affected: `AGENTS.md`, `docs/ARCHITECTURE.md`
  - Test criteria: Documentation accurately reflects new structure, no stale paths

- [x] **Step 7: Validate and clean up**
  - Verify `.gitignore` entry `dist/` covers `dist/extensions/` (line 5 in .gitignore)
  - Verify `node_modules/` pattern covers `extensions/codehydra-sidekick/node_modules/`
  - Run `npm run validate:fix` to ensure everything works
  - Delete old `src/services/vscode-setup/assets/codehydra-sidekick/` directory (should be empty after move)
  - Delete old `src/services/vscode-setup/assets/extensions.json` (should be moved)
  - Files affected: cleanup only
  - Test criteria: `npm run validate:fix` passes, old files removed, no stale references in git

## Testing Strategy

### Integration Tests

No new tests required - this is a refactor. Existing tests verify:

- VscodeSetupService correctly reads extensions.json and installs vsix files
- Tests mock the filesystem, so paths in test fixtures remain unchanged

### Manual Testing Checklist

- [ ] `npm run build:extensions` creates `dist/extensions/codehydra-sidekick-0.0.2.vsix`
- [ ] `npm run build:extensions` creates `dist/extensions/extensions.json`
- [ ] `npm run build` copies both files to `out/main/assets/`
- [ ] `npm run dev` works (extensions install correctly)
- [ ] `npm run validate:fix` passes
- [ ] `grep -r "vscode-setup/assets/codehydra-sidekick" .` returns no results (excluding planning/)

## Dependencies

No new dependencies required.

## Documentation Updates

### Files to Update

| File                   | Changes Required                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `AGENTS.md`            | Update "VS Code Assets" section: Asset Files table paths, Build Process paths and script name |
| `docs/ARCHITECTURE.md` | Update all references from `src/services/vscode-setup/assets/` to `extensions/`               |

### New Documentation Required

| File                   | Purpose                                               |
| ---------------------- | ----------------------------------------------------- |
| `extensions/README.md` | Documents structure for adding new VS Code extensions |

## Definition of Done

- [ ] All implementation steps complete
- [ ] `npm run validate:fix` passes
- [ ] Documentation updated
- [ ] User acceptance testing passed
- [ ] Changes committed
