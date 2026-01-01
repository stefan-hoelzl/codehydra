---
status: USER_TESTING
last_updated: 2026-01-02
reviewers: []
---

# PNPM_MIGRATION

## Overview

- **Problem**: Currently using npm as the package manager. pnpm offers faster installs, better disk space efficiency through content-addressable storage, and built-in version management for both itself and Node.js.
- **Solution**: Migrate from npm to pnpm with minimal workspaces (extensions only). Use pnpm's built-in features to manage both pnpm and Node.js versions directly in the repository.
- **Risks**:
  - CI workflows need careful updates to avoid broken builds
  - Extension build script uses `npm install` internally - needs pnpm + shell option for Windows
  - VS Code tasks use npm task type - needs shell type instead
  - Postinstall hooks may behave differently - needs testing
- **Alternatives Considered**:
  - **pnpm without workspaces**: Rejected - `useNodeVersion` requires `pnpm-workspace.yaml`
  - **Keep npm**: Would miss out on pnpm's speed and disk efficiency benefits
  - **Yarn**: pnpm has better disk efficiency and simpler migration path
  - **.nvmrc for Node version**: Rejected - pnpm's `useNodeVersion` is more integrated

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Version Management                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  package.json                     pnpm-workspace.yaml (new)              │
│  ┌──────────────────────┐        ┌─────────────────────────────┐        │
│  │ "packageManager":    │        │ packages:                   │        │
│  │   "pnpm@10.11.0"     │        │   - 'extensions/*'          │        │
│  └──────────────────────┘        │ useNodeVersion: "22.12.0"   │        │
│           │                      └─────────────────────────────┘        │
│           ▼                                  │                           │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    pnpm (auto-managed)                           │    │
│  │  - Downloads correct pnpm version automatically                  │    │
│  │  - Downloads correct Node.js version automatically               │    │
│  │  - Installs root + extension dependencies with single command    │    │
│  │  - Works on all platforms (Linux, macOS, Windows)                │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                         Workspace Structure                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  codehydra/                                                              │
│  ├── package.json           (root - implicitly included)                 │
│  ├── pnpm-workspace.yaml    (workspace config + Node version)            │
│  ├── pnpm-lock.yaml         (single lockfile for all packages)           │
│  └── extensions/                                                         │
│      ├── sidekick/          (workspace package)                          │
│      │   └── package.json                                                │
│      └── dictation/         (workspace package)                          │
│          └── package.json                                                │
│                                                                          │
│  Note: site/ is NOT a workspace package (uses root's vite config)        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                              CI Flow                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  GitHub Actions (order matters!)                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 1. actions/checkout@v4                                            │   │
│  │ 2. pnpm/action-setup@v4  ←── MUST be before setup-node            │   │
│  │ 3. actions/setup-node@v4 (cache: pnpm)                            │   │
│  │ 4. pnpm install --frozen-lockfile  ←── Installs root + extensions │   │
│  │ 5. pnpm validate / pnpm build / etc.                              │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Implementation Steps

- [x] **Step 1: Add pnpm configuration files**
  - Add `packageManager` field to `package.json`: `"packageManager": "pnpm@10.11.0"`
  - Create `pnpm-workspace.yaml`:
    ```yaml
    packages:
      - "extensions/*"
    useNodeVersion: "22.12.0"
    ```
  - Files: `package.json`, `pnpm-workspace.yaml` (new)
  - Test criteria: `pnpm install` succeeds (validates both files)

- [x] **Step 2: Update .gitignore**
  - Ensure `pnpm-lock.yaml` is NOT ignored (must be committed)
  - Add `.pnpm-store/` if not present
  - Verify `pnpm-debug.log*` is ignored
  - Files: `.gitignore`
  - Test criteria: `git status` shows `pnpm-lock.yaml` as trackable

- [x] **Step 3: Update GitHub CI workflow**
  - Add `pnpm/action-setup@v4` step BEFORE `actions/setup-node@v4`
  - Change `cache: npm` to `cache: pnpm` in setup-node
  - Replace `npm ci --force` with `pnpm install --frozen-lockfile`
  - Remove the extension install loop (workspace handles it)
  - Replace `npm run X` with `pnpm X` throughout
  - Exact changes:

    ```yaml
    # Add after checkout, BEFORE setup-node:
    - uses: pnpm/action-setup@v4

    # Change setup-node:
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: pnpm # was: npm

    # Replace install:
    - run: pnpm install --frozen-lockfile # was: npm ci --force

    # Remove extension install loop entirely (workspace handles it)

    # Replace commands:
    - run: pnpm validate # was: npm run validate
    - run: pnpm test:boundary # was: npm run test:boundary
    - run: pnpm dist # was: npm run dist
    ```

  - Files: `.github/workflows/ci.yaml`
  - Test criteria: Workflow syntax is valid, CI passes

- [x] **Step 4: Update GitHub Release workflow**
  - Same changes as CI workflow
  - Add `pnpm/action-setup@v4` step BEFORE `actions/setup-node@v4`
  - Change `cache: npm` to `cache: pnpm` in setup-node
  - Replace `npm ci --force` with `pnpm install --frozen-lockfile`
  - Remove the extension install loop
  - Replace `npm run X` with `pnpm X` throughout
  - Files: `.github/workflows/release.yaml`
  - Test criteria: Workflow syntax is valid

- [x] **Step 5: Update VS Code tasks**
  - Change from npm task type to shell type
  - Exact JSON transformation:
    ```json
    {
      "label": "setup",
      "type": "shell",
      "command": "pnpm",
      "args": ["setup"],
      "problemMatcher": [],
      "runOptions": {
        "runOn": "folderOpen"
      },
      "presentation": {
        "reveal": "silent",
        "close": true
      }
    }
    ```
  - Files: `.vscode/tasks.json`
  - Test criteria: Task runs correctly when opening folder in VS Code

- [x] **Step 6: Update extension build script**
  - Change `npm install` to `pnpm install` with `shell: true` option
  - Change `npm run build` to `pnpm build` with `shell: true` option
  - The `shell: true` option is needed for Windows where pnpm may be a .cmd shim
  - Update comments referencing npm
  - Exact changes in `buildExtension()`:

    ```typescript
    // Line 247-248: Change from:
    execSync("npm install", { cwd: extPath, stdio: "inherit" });
    // To:
    execSync("pnpm install", { cwd: extPath, stdio: "inherit", shell: true });

    // Line 251-252: Change from:
    execSync("npm run build", { cwd: extPath, stdio: "inherit" });
    // To:
    execSync("pnpm build", { cwd: extPath, stdio: "inherit", shell: true });
    ```

  - Update comment on line 16: `npm run build:extensions` → `pnpm build:extensions`
  - Update comment on line 222: `npm install && npm run build` → `pnpm install && pnpm build`
  - Files: `scripts/build-extensions.ts`
  - Test criteria: `pnpm build:extensions` succeeds on both Linux and Windows

- [x] **Step 7: Update AGENTS.md**
  - Change "Package Manager | npm" to "Package Manager | pnpm"
  - Update all command examples from `npm run X` to `pnpm X`
  - Update `npm test` to `pnpm test`
  - Update `npm install` references to `pnpm install`
  - Update Prerequisites section: list pnpm as a requirement
  - Files: `AGENTS.md`
  - Test criteria: No npm command references remain (except npm registry references)

- [x] **Step 8: Update README.md**
  - Update Quick Start section:

    ```bash
    # Install dependencies
    pnpm install

    # Run in development mode
    pnpm dev
    ```

  - Update Prerequisites: "pnpm" (pnpm manages Node.js version automatically)
  - Update Commands table: all `npm run X` → `pnpm X`
  - Files: `README.md`
  - Test criteria: All commands use pnpm

- [x] **Step 9: Update docs/TESTING.md**
  - Replace all `npm run X` with `pnpm X`
  - Replace `npm test` with `pnpm test`
  - Files: `docs/TESTING.md`
  - Test criteria: All commands use pnpm

- [x] **Step 10: Update docs/ARCHITECTURE.md**
  - Replace all `npm run X` with `pnpm X`
  - Replace `npm install` references with `pnpm install`
  - Files: `docs/ARCHITECTURE.md`
  - Test criteria: All commands use pnpm

- [x] **Step 11: Update docs/RELEASE.md**
  - Check for any npm command references and update to pnpm
  - Files: `docs/RELEASE.md`
  - Test criteria: All commands use pnpm (if any present)

- [x] **Step 12: Update landing page QuickStart**
  - Update CODE constant in QuickStart.svelte:

    ```typescript
    const CODE = `# Clone the repository
    git clone https://github.com/stefanhoelzl/codehydra.git
    cd codehydra
    
    # Install dependencies
    pnpm install
    
    # Run in development mode
    pnpm dev`;
    ```

  - Files: `site/src/components/QuickStart.svelte`
  - Test criteria: Landing page shows pnpm commands

- [x] **Step 13: Update remaining scripts and files**
  - `scripts/download-binaries.ts`: Update comments (lines 4, 12)
  - `scripts/check-path-length.cjs`: Update comments (lines 4, 57)
  - `opencode.jsonc`: Check for npm references
  - `docs/PATTERNS.md`: Verify no npm references (already confirmed clean)
  - Files: `scripts/download-binaries.ts`, `scripts/check-path-length.cjs`, `opencode.jsonc`
  - Test criteria: Comments are accurate, no stale npm references

- [x] **Step 14: Delete npm lockfiles and generate pnpm lockfile**
  - Delete `package-lock.json`
  - Delete `extensions/sidekick/package-lock.json`
  - Delete `extensions/dictation/package-lock.json`
  - Run `pnpm install` to generate single `pnpm-lock.yaml` at root
  - Verify workspace packages are installed (extensions/\*/node_modules)
  - Files: Delete 3 `package-lock.json` files, create `pnpm-lock.yaml`
  - Test criteria: `pnpm install` succeeds, single `pnpm-lock.yaml` created at root

- [x] **Step 15: Verify build, tests, and hooks**
  - Run `pnpm validate:fix` to ensure everything works
  - Verify `preinstall` and `postinstall` hooks execute correctly
  - Test extension build: `pnpm build:extensions`
  - Files: N/A
  - Test criteria: All checks pass, hooks work, extensions build

## Testing Strategy

### Integration Tests

No new integration tests needed - this is a tooling change that doesn't affect application code.

### Manual Testing Checklist

- [ ] `pnpm install` succeeds from clean state (no node_modules)
- [ ] `pnpm install` triggers postinstall hook (downloads binaries)
- [ ] Extension dependencies install correctly (check extensions/sidekick/node_modules)
- [ ] `pnpm dev` starts the application
- [ ] `pnpm build` produces output in `out/`
- [ ] `pnpm test` runs all tests
- [ ] `pnpm validate:fix` passes all checks
- [ ] `pnpm build:extensions` packages extensions correctly
- [ ] VS Code tasks work (setup task on folder open)
- [ ] CI workflow passes on GitHub Actions (Linux and Windows)
- [ ] Landing page shows correct pnpm commands

## Dependencies

| Package | Purpose             | Approved |
| ------- | ------------------- | -------- |
| (none)  | No new dependencies | N/A      |

**Note**: pnpm is a CLI tool, not a package dependency.

## Documentation Updates

### Files to Update

| File                                    | Changes Required                                                  |
| --------------------------------------- | ----------------------------------------------------------------- |
| `AGENTS.md`                             | All npm commands → pnpm, package manager reference, prerequisites |
| `README.md`                             | Quick start commands, prerequisites                               |
| `docs/TESTING.md`                       | All command references                                            |
| `docs/ARCHITECTURE.md`                  | All command references                                            |
| `docs/RELEASE.md`                       | Check for npm references                                          |
| `site/src/components/QuickStart.svelte` | Installation commands                                             |

### New Documentation Required

| File   | Purpose |
| ------ | ------- |
| (none) | N/A     |

## Definition of Done

- [ ] All implementation steps complete
- [ ] `pnpm validate:fix` passes
- [ ] Documentation updated
- [ ] User acceptance testing passed
- [ ] CI passed
- [ ] Merged to main

---

## Appendix: Key pnpm Features Used

### packageManager Field

In `package.json`:

```json
{
  "packageManager": "pnpm@10.11.0"
}
```

When pnpm is installed, it reads this field and automatically uses the correct version. The setting `managePackageManagerVersions` (default `true` in pnpm 10.x) enables this.

### Workspaces with useNodeVersion

In `pnpm-workspace.yaml`:

```yaml
packages:
  - "extensions/*"
useNodeVersion: "22.12.0"
```

- `packages` defines which subdirectories are workspace packages (root is implicit)
- `useNodeVersion` requires `pnpm-workspace.yaml` to exist
- pnpm will automatically download and use the specified Node.js version
- Single `pnpm install` at root installs all workspace packages

**Benefits:**

- Single lockfile for entire project
- Shared devDependencies (esbuild, typescript) are deduplicated
- Consistent Node.js version across all developers and CI
- Works on Windows, Linux, and macOS

### Lockfile

pnpm uses `pnpm-lock.yaml` instead of `package-lock.json`. The `--frozen-lockfile` flag in CI ensures reproducible builds.

### Command Equivalents

| npm            | pnpm                             |
| -------------- | -------------------------------- |
| `npm install`  | `pnpm install`                   |
| `npm ci`       | `pnpm install --frozen-lockfile` |
| `npm run X`    | `pnpm X` (or `pnpm run X`)       |
| `npm test`     | `pnpm test`                      |
| `npm add X`    | `pnpm add X`                     |
| `npm add -D X` | `pnpm add -D X`                  |
