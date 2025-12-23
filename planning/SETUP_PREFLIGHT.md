---
status: COMPLETED
last_updated: 2025-12-23
reviewers: [review-typescript, review-arch, review-testing, review-docs]
---

# SETUP_PREFLIGHT

## Overview

- **Problem**: Current setup uses a single version marker (`CURRENT_SETUP_VERSION`). Any change (binary versions, extension versions, wrapper script logic) requires bumping the global version, which re-runs ALL setup steps including slow extension installations.
- **Solution**: Implement a preflight phase that runs on every startup, checks individual component versions, regenerates cheap artifacts (wrapper scripts), and only triggers setup for missing/outdated components.
- **Risks**:
  - Extension version detection relies on parsing VS Code's extension directory format
  - Preflight adds small startup latency (mitigated: only filesystem checks, no network)
- **Alternatives Considered**:
  - Per-step versioning in marker file - rejected: more complex, doesn't handle wrapper script regeneration
  - Content hashing - rejected: overkill for this use case

## Architecture

```
App Start (bootstrap())
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ SCRIPT REGENERATION (WrapperScriptGenerationService)                │
│ Called in bootstrap() before LifecycleApi creation                  │
│                                                                     │
│ └─► Write bin/code, bin/opencode scripts (always - cheap)           │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ PREFLIGHT (VscodeSetupService.preflight())                          │
│ Called by LifecycleApi.getState() - read-only checks                │
│                                                                     │
│ 1. Check binaries (directory exists at version?)                    │
│    ├─► code-server/<VERSION>/ exists?                               │
│    └─► opencode/<VERSION>/ exists?                                  │
│                                                                     │
│ 2. Check extensions (parse installed directories)                   │
│    ├─► Bundled: codehydra.codehydra-<version>/ matches config?      │
│    └─► Marketplace: sst-dev.opencode-*/ exists?                     │
│                                                                     │
│ Returns: PreflightResult { needsSetup, missingBinaries, ... }       │
└─────────────────────────────────────────────────────────────────────┘
    │
    ├── needsSetup: false ──► getState() returns "ready"
    │                         ──► Start services immediately
    │
    ▼ needsSetup: true
    getState() returns "setup"
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ SETUP (VscodeSetupService.setup(preflightResult))                   │
│ Receives PreflightResult to avoid re-checking                       │
│                                                                     │
│ 1. Download missing binaries only                                   │
│    └─► Skip if already installed at correct version                 │
│                                                                     │
│ 2. Install missing/outdated extensions only                         │
│    └─► Skip if already installed at correct version                 │
│                                                                     │
│ 3. Write completion marker                                          │
└─────────────────────────────────────────────────────────────────────┘
    │
    ▼
Start services
```

## Data Flow

```
extensions.json (new format)
┌─────────────────────────────────────────┐
│ {                                       │
│   "marketplace": ["sst-dev.opencode"],  │
│   "bundled": [                          │
│     { "id": "codehydra.codehydra",      │
│       "version": "0.0.1",               │
│       "vsix": "codehydra-0.0.1.vsix" }  │  ◄── Explicit filename
│   ]                                     │
│ }                                       │
└─────────────────────────────────────────┘
           │
           ▼
    ┌──────────────────┐
    │ Preflight checks │
    └──────────────────┘
           │
           ▼
<app-data>/vscode/extensions/
┌─────────────────────────────────────────┐
│ codehydra.codehydra-0.0.1/              │ ◄── Parse with regex (handles prerelease)
│ sst-dev.opencode-1.2.3/                 │ ◄── Check existence (any version)
└─────────────────────────────────────────┘

<app-data>/.setup-completed (new location)
┌─────────────────────────────────────────┐
│ {                                       │
│   "schemaVersion": 1,                   │ ◄── Renamed for clarity
│   "completedAt": "2025-12-23T..."       │
│ }                                       │
└─────────────────────────────────────────┘
```

## Implementation Steps

### Phase 1: Infrastructure Changes

- [x] **Step 1.1: Move marker file location**
  - Update `PathProvider` interface and `DefaultPathProvider`
  - Change path from `<dataRoot>/vscode/.setup-completed` to `<dataRoot>/.setup-completed`
  - Rename property from `vscodeSetupMarkerPath` to `setupMarkerPath`
  - Add migration logic: check new location first, fall back to legacy location
  - Files affected:
    - `src/services/platform/path-provider.ts`
    - `src/services/platform/path-provider.test.ts`
    - `src/services/platform/path-provider.test-utils.ts`
  - Test criteria:
    - `setupMarkerPath` returns `<dataRoot>/.setup-completed`
    - All usages updated to new property name

- [x] **Step 1.2: Update extensions.json format**
  - Change bundled extensions from filename strings to objects with id, version, and explicit vsix filename
  - Update `ExtensionsConfig` type in `types.ts`
  - Add runtime type guard for format validation with helpful error messages
  - Files affected:
    - `src/services/vscode-setup/types.ts`
    - `src/services/vscode-setup/assets/extensions.json`
  - Test criteria:
    - Type reflects new structure: `{ id: string; version: string; vsix: string }`
    - Type guard validates format and returns descriptive error on mismatch

- [x] **Step 1.3: Add extension version detection utility**
  - Create function to parse extension directory names using regex
  - Use pattern `/^([a-z0-9-]+\.[a-z0-9-]+)-(.+)$/i` to handle prerelease versions
  - Return map of extension id to installed version
  - Files affected:
    - `src/services/vscode-setup/extension-utils.ts` (new file)
    - `src/services/vscode-setup/extension-utils.test.ts` (new file)
    - `src/services/vscode-setup/extension-utils.boundary.test.ts` (new file)
  - Test criteria:
    - Parses `publisher.name-1.0.0` → `{ id: "publisher.name", version: "1.0.0" }`
    - Parses `publisher.name-1.0.0-beta.1` → `{ id: "publisher.name", version: "1.0.0-beta.1" }`
    - Returns null for malformed names (no version, no dot in id)
    - Ignores hidden files (`.DS_Store`, `.git`)
    - Ignores non-extension folders (`node_modules`)
    - Boundary test with real filesystem operations

### Phase 2: Preflight Implementation

- [x] **Step 2.1: Create PreflightResult type**
  - Define discriminated union result type (success/failure)
  - Use readonly arrays for all collection fields
  - Add JSDoc explaining field semantics
  - Files affected:
    - `src/services/vscode-setup/types.ts`
  - Test criteria:
    - Types compile with readonly modifiers
    - JSDoc present on all fields

```typescript
/** Result of preflight checks */
type PreflightResult =
  | {
      readonly success: true;
      /** True if any component needs installation/update */
      readonly needsSetup: boolean;
      /** Binary types that are missing or at wrong version */
      readonly missingBinaries: readonly BinaryType[];
      /** Extension IDs that are not installed (any version) */
      readonly missingExtensions: readonly string[];
      /** Extension IDs installed but at wrong version */
      readonly outdatedExtensions: readonly string[];
    }
  | {
      readonly success: false;
      readonly error: PreflightError;
    };
```

- [x] **Step 2.2: Create WrapperScriptGenerationService**
  - Extract script generation logic from `VscodeSetupService.setupBinDirectory()`
  - Create new service with single responsibility: generating wrapper scripts
  - Inject dependencies: PathProvider, FileSystemLayer, PlatformInfo
  - Add method `regenerate(): Promise<void>` that writes all scripts
  - Files affected:
    - `src/services/vscode-setup/wrapper-script-generation-service.ts` (new file)
    - `src/services/vscode-setup/wrapper-script-generation-service.test.ts` (new file)
    - `src/services/vscode-setup/index.ts` (export new service)
  - Test criteria:
    - `regenerate()` writes bin/code and bin/opencode scripts
    - Generates `.cmd` scripts on Windows, shell scripts on Unix
    - Scripts contain correct binary paths for platform

- [x] **Step 2.3: Integrate script regeneration into bootstrap()**
  - Call `WrapperScriptGenerationService.regenerate()` in `bootstrap()` before creating LifecycleApi
  - This ensures scripts are always fresh without side effects in `getState()`
  - Log preflight results for debugging (info level when needsSetup, debug otherwise)
  - Files affected:
    - `src/main/index.ts`
  - Test criteria:
    - Scripts regenerated on every app start
    - `getState()` remains a pure read operation

- [x] **Step 2.4: Implement preflight in VscodeSetupService**
  - Add `preflight(): Promise<PreflightResult>` method
  - Check binary directories exist using BinaryDownloadService.isInstalled()
  - Check extension versions against config using extension-utils
  - Handle errors gracefully (return failure result, not throw)
  - Files affected:
    - `src/services/vscode-setup/vscode-setup-service.ts`
    - `src/services/vscode-setup/vscode-setup-service.test.ts`
    - `src/services/vscode-setup/types.ts` (IVscodeSetup interface)
  - Test criteria:
    - Returns `{ success: true, needsSetup: false }` when all components installed
    - Returns `{ success: true, needsSetup: true, missingBinaries: ["code-server"] }` when binary missing
    - Returns `{ success: true, needsSetup: true, outdatedExtensions: ["codehydra.codehydra"] }` when version mismatch
    - Returns `{ success: false, error }` when extensions directory unreadable

- [x] **Step 2.5: Integrate preflight into getState()**
  - Replace `isSetupComplete()` with preflight-based check
  - Store preflight result for later use by setup()
  - Flow: call preflight → if needsSetup return "setup", else return "ready"
  - Files affected:
    - `src/main/api/lifecycle-api.ts`
    - `src/main/api/lifecycle-api.test.ts`
  - Test criteria:
    - `getState()` returns "ready" when preflight.needsSetup is false
    - `getState()` returns "setup" when preflight.needsSetup is true
    - Preflight result is cached for setup() to use

### Phase 3: Selective Setup

- [x] **Step 3.1: Update setup() to accept PreflightResult**
  - Change signature: `setup(preflightResult: PreflightResult, onProgress?: ProgressCallback)`
  - Use preflightResult to determine which components need installation
  - Skip binary downloads for binaries not in missingBinaries
  - Skip extension installs for extensions not in missingExtensions/outdatedExtensions
  - Files affected:
    - `src/services/vscode-setup/vscode-setup-service.ts`
    - `src/services/vscode-setup/vscode-setup-service.test.ts`
    - `src/services/vscode-setup/types.ts` (IVscodeSetup interface)
  - Test criteria:
    - When `missingBinaries: []`, no binary downloads attempted
    - When `missingBinaries: ["opencode"]`, only opencode downloaded
    - When `outdatedExtensions: ["codehydra.codehydra"]`, only that extension reinstalled

- [x] **Step 3.2: Make cleanVscodeDir() selective**
  - Instead of removing entire vscode directory, only clean components being reinstalled
  - Add parameter: `cleanComponents(extensions: string[]): Promise<void>`
  - Clean only specific extension directories before reinstalling
  - Keep method for manual full reset scenarios
  - Files affected:
    - `src/services/vscode-setup/vscode-setup-service.ts`
    - `src/services/vscode-setup/vscode-setup-service.test.ts`
  - Test criteria:
    - `cleanComponents(["codehydra.codehydra"])` removes only that extension directory
    - Other extensions and vscode user-data preserved
    - `cleanVscodeDir()` still available for full reset

- [x] **Step 3.3: Remove auto-clean from LifecycleApi.setup()**
  - Remove the `cleanVscodeDir()` call before setup
  - Selective cleaning now happens in VscodeSetupService based on preflight results
  - Files affected:
    - `src/main/api/lifecycle-api.ts`
    - `src/main/api/lifecycle-api.test.ts`
  - Test criteria:
    - Setup preserves existing valid installations
    - Only components identified by preflight are reinstalled

### Phase 4: Cleanup & Documentation

- [x] **Step 4.1: Update marker schema**
  - Rename `version` to `schemaVersion` in marker file
  - Set `schemaVersion: 1` for new marker format
  - Handle legacy markers: any marker with old `version` field triggers full re-setup
  - Check both new and legacy marker locations during migration period
  - Files affected:
    - `src/services/vscode-setup/types.ts`
    - `src/services/vscode-setup/vscode-setup-service.ts`
  - Test criteria:
    - New markers use `schemaVersion` field
    - Legacy markers (with `version` field) trigger needsSetup: true
    - Markers at old location (`vscode/.setup-completed`) detected and treated as legacy

- [x] **Step 4.2: Update AGENTS.md documentation**
  - Document new extensions.json format requirement
  - Add rule: bundled extension changes must update extensions.json (id, version, vsix)
  - Update VS Code Setup section with new marker location
  - Files affected:
    - `AGENTS.md`
  - Test criteria: Documentation reflects new behavior

- [x] **Step 4.3: Update ARCHITECTURE.md documentation**
  - Update marker file location from `vscode/.setup-completed` to `.setup-completed`
  - Update "Asset Files" subsection with new extensions.json format
  - Add "Preflight Phase" subsection explaining: runs on startup, checks components, regenerates scripts
  - Update startup flow diagram to show script regeneration and preflight
  - Files affected:
    - `docs/ARCHITECTURE.md`
  - Test criteria: Architecture documentation reflects new startup flow

- [x] **Step 4.4: Update integration tests**
  - Ensure integration tests cover preflight scenarios
  - Test selective setup (some components installed, others not)
  - Test marker migration from legacy location/format
  - All integration tests must use temp directories (never actual app-data)
  - Files affected:
    - `src/services/vscode-setup/vscode-setup-service.integration.test.ts`
    - `src/main/api/lifecycle-api.test.ts`
  - Test criteria: All integration tests pass

## Testing Strategy

### Unit Tests (vitest)

| Test Case                                | Description                                     | File                                        |
| ---------------------------------------- | ----------------------------------------------- | ------------------------------------------- |
| `parseExtensionDir - standard version`   | Parses `publisher.name-1.0.0` correctly         | `extension-utils.test.ts`                   |
| `parseExtensionDir - prerelease version` | Parses `publisher.name-1.0.0-beta.1` correctly  | `extension-utils.test.ts`                   |
| `parseExtensionDir - no version`         | Returns null for `publisher.name`               | `extension-utils.test.ts`                   |
| `parseExtensionDir - hidden files`       | Ignores `.DS_Store`, `.git`                     | `extension-utils.test.ts`                   |
| `parseExtensionDir - non-extension`      | Ignores `node_modules`                          | `extension-utils.test.ts`                   |
| `isValidExtensionsConfig`                | Type guard validates new format                 | `types.test.ts`                             |
| `isValidExtensionsConfig - legacy`       | Detects old format with helpful error           | `types.test.ts`                             |
| `regenerate - Unix`                      | Generates shell scripts with correct paths      | `wrapper-script-generation-service.test.ts` |
| `regenerate - Windows`                   | Generates .cmd scripts with correct paths       | `wrapper-script-generation-service.test.ts` |
| `preflight - all installed`              | Returns `needsSetup: false`                     | `vscode-setup-service.test.ts`              |
| `preflight - missing binary`             | Returns `missingBinaries: ["code-server"]`      | `vscode-setup-service.test.ts`              |
| `preflight - outdated extension`         | Returns `outdatedExtensions: ["..."]`           | `vscode-setup-service.test.ts`              |
| `preflight - missing marketplace ext`    | Returns `missingExtensions: ["..."]`            | `vscode-setup-service.test.ts`              |
| `preflight - corrupted marker`           | Returns `needsSetup: true`                      | `vscode-setup-service.test.ts`              |
| `preflight - unreadable dir`             | Returns `success: false` with error             | `vscode-setup-service.test.ts`              |
| `setup - selective binary`               | Only downloads missing binaries                 | `vscode-setup-service.test.ts`              |
| `setup - selective extension`            | Only installs outdated extensions               | `vscode-setup-service.test.ts`              |
| `cleanComponents`                        | Removes only specified extensions               | `vscode-setup-service.test.ts`              |
| `getState - ready`                       | Returns "ready" when preflight.needsSetup false | `lifecycle-api.test.ts`                     |
| `getState - setup`                       | Returns "setup" when preflight.needsSetup true  | `lifecycle-api.test.ts`                     |
| `marker - legacy version field`          | Triggers re-setup                               | `vscode-setup-service.test.ts`              |
| `marker - legacy location`               | Detected and triggers re-setup                  | `vscode-setup-service.test.ts`              |

### Boundary Tests

| Test Case                                 | Description                        | File                               |
| ----------------------------------------- | ---------------------------------- | ---------------------------------- |
| `listExtensions - real directory`         | Lists actual extension directories | `extension-utils.boundary.test.ts` |
| `listExtensions - empty directory`        | Returns empty map                  | `extension-utils.boundary.test.ts` |
| `listExtensions - non-existent directory` | Returns empty map (not error)      | `extension-utils.boundary.test.ts` |
| `listExtensions - mixed valid/invalid`    | Parses valid, ignores invalid      | `extension-utils.boundary.test.ts` |

### Integration Tests

| Test Case                      | Description                                  | File                                       |
| ------------------------------ | -------------------------------------------- | ------------------------------------------ |
| `preflight - e2e with real fs` | Full preflight check in temp directory       | `vscode-setup-service.integration.test.ts` |
| `selective setup - e2e`        | Setup with partial installation state        | `vscode-setup-service.integration.test.ts` |
| `marker migration - location`  | Legacy location detected, re-setup triggered | `vscode-setup-service.integration.test.ts` |
| `marker migration - format`    | Legacy format detected, re-setup triggered   | `vscode-setup-service.integration.test.ts` |
| `recovery from partial state`  | Handles interrupted previous setup           | `vscode-setup-service.integration.test.ts` |
| `concurrent preflight`         | Multiple calls don't corrupt state           | `vscode-setup-service.integration.test.ts` |

### Performance Tests

| Test Case           | Description                                | File                           |
| ------------------- | ------------------------------------------ | ------------------------------ |
| `preflight < 100ms` | Preflight completes within acceptable time | `vscode-setup-service.test.ts` |

### Manual Testing Checklist

- [ ] Fresh install: preflight detects all missing, setup runs completely
- [ ] Second launch: preflight passes, no setup needed, scripts regenerated
- [ ] Bump bundled extension version: preflight detects outdated, setup reinstalls only that extension
- [ ] Bump binary version: preflight detects missing, setup downloads only that binary
- [ ] Delete wrapper scripts: scripts regenerated on next launch, no setup triggered
- [ ] Delete one binary: preflight detects, setup downloads only that binary
- [ ] Corrupt extension directory: graceful handling, triggers re-setup for that extension
- [ ] Delete marker file: re-setup triggered on next launch
- [ ] Upgrade from legacy marker location: detected, re-setup triggered

## Dependencies

| Package | Purpose                      | Approved |
| ------- | ---------------------------- | -------- |
| (none)  | No new dependencies required | N/A      |

## Documentation Updates

### Files to Update

| File                   | Changes Required                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AGENTS.md`            | Document extensions.json format `{ id, version, vsix }`, add rule for version bumps                                                                                      |
| `docs/ARCHITECTURE.md` | Update marker location to `<dataRoot>/.setup-completed`, document extensions.json format in "Asset Files", add "Preflight Phase" subsection, update startup flow diagram |

### New Documentation Required

| File   | Purpose                                        |
| ------ | ---------------------------------------------- |
| (none) | No new docs needed - existing docs cover setup |

## Definition of Done

- [x] All implementation steps complete
- [x] `npm run validate:fix` passes
- [x] Documentation updated (AGENTS.md, ARCHITECTURE.md)
- [ ] User acceptance testing passed
- [ ] Changes committed

## Technical Notes

### Extension Directory Format

VS Code stores extensions in directories named `<publisher>.<name>-<version>`:

- `codehydra.codehydra-0.0.1`
- `sst-dev.opencode-1.2.3`
- `publisher.name-1.0.0-beta.1` (prerelease versions supported)

The preflight parser uses regex `/^([a-z0-9-]+\.[a-z0-9-]+)-(.+)$/i` to correctly handle:

- Standard versions: `1.0.0`
- Prerelease versions: `1.0.0-beta.1`, `1.0.0-alpha`
- Build metadata: `1.0.0+build123`

### Marker File Format

**New format:**

```json
{
  "schemaVersion": 1,
  "completedAt": "2025-12-23T10:30:00.000Z"
}
```

**Legacy format (triggers re-setup):**

```json
{
  "version": 6,
  "completedAt": "2025-12-23T10:30:00.000Z"
}
```

The `schemaVersion` field only changes for:

- Schema changes to the marker file itself
- Fundamental changes to the preflight/setup architecture

Component version changes are detected by preflight, not marker version.

### Script Regeneration Safety

Regenerating scripts on every startup is safe because:

1. Scripts are small (~500 bytes each)
2. Write is atomic (new content replaces old)
3. No state is stored in scripts
4. Ensures scripts always match current binary versions

Scripts are regenerated in `bootstrap()` before LifecycleApi is created, ensuring `getState()` remains a pure read operation.

### Migration Period

During migration from legacy marker location:

1. Check new location first: `<dataRoot>/.setup-completed`
2. If not found, check legacy location: `<dataRoot>/vscode/.setup-completed`
3. If found at legacy location, treat as requiring re-setup
4. Do NOT delete legacy marker (allows rollback to older app version)
