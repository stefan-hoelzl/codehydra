---
status: COMPLETED
last_updated: 2025-12-23
reviewers: [review-typescript, review-arch, review-testing, review-docs]
---

# OPENCODE_NODE_WRAPPER

## Overview

- **Problem**: The opencode wrapper script has duplicated logic between Unix (bash with grep/sed) and Windows (cmd with PowerShell). Both implementations parse `ports.json` to find the managed server port, but use different languages and parsing approaches.
- **Solution**: Consolidate into a single Node.js script that handles all the logic, with thin platform-specific shell wrappers that just invoke Node.
- **Behavior Change**: Removes standalone fallback. Current implementation falls back to `opencode "$@"` if not in git repo or workspace not found. New implementation returns explicit errors instead. This is intentional - the `opencode` command in CodeHydra terminals should only run in managed workspaces.
- **Risks**:
  - Slightly slower cold start due to Node.js initialization (negligible for CLI)
  - Dependency on bundled Node.js path being correct
- **Alternatives Considered**:
  - Keep separate scripts (rejected: maintenance burden, duplication)
  - Use a compiled binary (rejected: overkill for simple logic)
  - Reuse GitClient (rejected: requires bundling dependencies, overkill for one command)

## Architecture

```
<app-data>/
├── bin/
│   ├── opencode           # Unix: thin sh wrapper → invokes Node
│   ├── opencode.cmd       # Windows: thin cmd wrapper → invokes Node
│   └── opencode.cjs       # Shared: all logic (CommonJS for explicit format)
├── code-server/<version>/
│   └── lib/
│       ├── node           # Unix: bundled Node.js
│       └── node.exe       # Windows: bundled Node.js
└── opencode/
    ├── ports.json         # Port mappings (managed by OpenCodeServerManager)
    └── <version>/
        └── opencode[.exe] # Binary
```

### Script Flow

```
User runs `opencode` in terminal
           │
           ▼
┌─────────────────────────────────────┐
│  Thin wrapper (opencode / .cmd)     │
│  exec <bundled-node> opencode.cjs   │
└─────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│  opencode.cjs (Node.js)             │
│  1. execSync: git rev-parse         │
│  2. fs.readFileSync: ports.json     │
│  3. JSON.parse & lookup port        │
│  4. spawnSync: opencode attach <url>│
│  5. Exit with child's exit code     │
└─────────────────────────────────────┘
```

### Generated Node.js Script Structure

```javascript
// opencode.cjs - Generated CommonJS script
const { execSync, spawnSync } = require("child_process");
const { readFileSync, existsSync } = require("fs");
const { join } = require("path");

const OPENCODE_VERSION = "${opencodeVersion}";
const isWindows = process.platform === "win32";

// Paths relative to bin/ directory using path.join for cross-platform
const PORTS_FILE = join(__dirname, "..", "opencode", "ports.json");
const OPENCODE_BIN = join(
  __dirname,
  "..",
  "opencode",
  OPENCODE_VERSION,
  isWindows ? "opencode.exe" : "opencode"
);

// 1. Find git root
let gitRoot;
try {
  gitRoot = execSync("git rev-parse --show-toplevel", {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"], // Capture stderr
  }).trim();
} catch {
  console.error("Error: Not in a git repository");
  process.exit(1);
}

// 2. Read ports.json
if (!existsSync(PORTS_FILE)) {
  console.error("Error: No opencode servers are running");
  process.exit(1);
}

let ports;
try {
  const content = readFileSync(PORTS_FILE, "utf8");
  ports = JSON.parse(content);
} catch {
  console.error("Error: Failed to read ports.json");
  process.exit(1);
}

// 3. Look up port for workspace
const workspaceInfo = ports.workspaces?.[gitRoot];
if (!workspaceInfo?.port) {
  console.error("Error: No opencode server found for workspace: " + gitRoot);
  console.error("Make sure the workspace is open in CodeHydra.");
  process.exit(1);
}

// 4. Spawn opencode attach
const url = "http://127.0.0.1:" + workspaceInfo.port;
const result = spawnSync(OPENCODE_BIN, ["attach", url], { stdio: "inherit" });

// 5. Exit with child's exit code
if (result.error) {
  console.error("Error: Failed to start opencode: " + result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
```

### Thin Wrapper Examples

**Unix wrapper (`opencode`):**

```sh
#!/bin/sh
exec '/path/to/code-server/lib/node' '/path/to/bin/opencode.cjs'
```

**Windows wrapper (`opencode.cmd`):**

```cmd
@echo off
"C:\path\to\code-server\lib\node.exe" "C:\path\to\bin\opencode.cjs" %*
exit /b %ERRORLEVEL%
```

### Error Cases (no standalone fallback)

| Condition                   | Error Message                                           |
| --------------------------- | ------------------------------------------------------- |
| Not in git repo             | `Error: Not in a git repository`                        |
| ports.json missing          | `Error: No opencode servers are running`                |
| ports.json invalid JSON     | `Error: Failed to read ports.json`                      |
| Workspace not in ports.json | `Error: No opencode server found for workspace: <path>` |
| opencode binary spawn fails | `Error: Failed to start opencode: <message>`            |

## Implementation Steps

- [x] **Step 1: Add bundled Node path to PathProvider**
  - Add `bundledNodePath` property to `PathProvider` interface
  - Implement in `DefaultPathProvider`: `<codeServerDir>/lib/node[.exe]`
  - Platform-specific: `lib/node` (Unix) or `lib/node.exe` (Windows)
  - Update test utilities with mock path
  - Files affected: `src/services/platform/path-provider.ts`, `src/services/platform/path-provider.test.ts`, `src/services/platform/path-provider.test-utils.ts`
  - Test criteria: Path resolves correctly for all platforms

- [x] **Step 2: Add bundled Node path to BinTargetPaths**
  - Add `bundledNodePath: string` to `BinTargetPaths` interface
  - Update `resolveTargetPaths()` in VscodeSetupService to include it from `pathProvider.bundledNodePath`
  - Files affected: `src/services/vscode-setup/types.ts`, `src/services/vscode-setup/vscode-setup-service.ts`
  - Test criteria: BinTargetPaths includes correct Node path

- [x] **Step 3: Create Node.js script generator**
  - Add `generateOpencodeNodeScript(opencodeVersion: string): string` function
  - Generated script logic (see "Generated Node.js Script Structure" above):
    1. `execSync('git rev-parse --show-toplevel')` wrapped in try-catch
    2. `existsSync()` + `readFileSync()` for ports.json
    3. `JSON.parse()` wrapped in try-catch
    4. Lookup `ports.workspaces[gitRoot].port`
    5. `spawnSync()` with `stdio: 'inherit'` for passthrough
    6. Exit with `result.status` or error code
  - Use `.cjs` extension for explicit CommonJS format
  - Use `path.join()` for all path construction (cross-platform)
  - Files affected: `src/services/vscode-setup/bin-scripts.ts`
  - Test criteria: Generated script is valid JS, contains all error handling

- [x] **Step 4: Update thin wrapper generators**
  - Rename/refactor `generateUnixOpencodeScript(bundledNodePath, scriptPath)` → simple `exec`
  - Rename/refactor `generateWindowsOpencodeScript(bundledNodePath, scriptPath)` → simple invocation with `exit /b %ERRORLEVEL%`
  - Use consistent parameter name `bundledNodePath` (not `nodePath`)
  - Files affected: `src/services/vscode-setup/bin-scripts.ts`
  - Test criteria: Wrappers correctly invoke Node with script path

- [x] **Step 5: Update generateOpencodeScript to return multiple files**
  - Change return type to `GeneratedScript[]` (was single `GeneratedScript`)
  - Return: `[opencode.cjs, platform-specific wrapper]`
  - The `.cjs` file doesn't need executable flag
  - Files affected: `src/services/vscode-setup/bin-scripts.ts`
  - Test criteria: Returns correct array of scripts

- [x] **Step 6: Update generateScripts and callers**
  - Update `generateScripts()` to spread array from `generateOpencodeScript()`
  - Ensure VscodeSetupService writes all generated scripts
  - Files affected: `src/services/vscode-setup/bin-scripts.ts`, `src/services/vscode-setup/vscode-setup-service.ts`
  - Test criteria: All scripts written to bin directory

- [x] **Step 7: Add unit tests for generators**
  - Test generated Node.js script content (string patterns)
  - Verify script contains `require()` for child_process, fs, path
  - Verify script uses `path.join()` for paths (grep for `join(`)
  - Verify error messages match Error Cases table
  - Verify `spawnSync` with `stdio: 'inherit'`
  - Verify exit code propagation logic
  - Files affected: `src/services/vscode-setup/bin-scripts.test.ts`
  - Test criteria: All code patterns verified

- [x] **Step 8: Add boundary tests for script execution**
  - Create `src/services/vscode-setup/bin-scripts.boundary.test.ts`
  - Create test utilities: `createFakeGitRepo()`, `createPortsJson()`, `executeScript()`
  - Test cases:
    - Script executes successfully when workspace in ports.json
    - Error when not in git repo
    - Error when ports.json missing
    - Error when ports.json is invalid JSON
    - Error when workspace not in ports.json
    - Exit code propagation from spawned process
  - Use temp directories and real filesystem
  - Platform-specific tests with `it.skipIf()`
  - Files affected: `src/services/vscode-setup/bin-scripts.boundary.test.ts`, `src/services/vscode-setup/bin-scripts.test-utils.ts`
  - Test criteria: All error paths and success path verified with real execution

- [x] **Step 9: Update existing bin-scripts tests**
  - Update tests for new wrapper format (thin wrappers)
  - Update tests for `generateOpencodeScript` returning array
  - Remove tests for standalone fallback (no longer exists)
  - Add platform-specific test skipping where needed
  - Files affected: `src/services/vscode-setup/bin-scripts.test.ts`
  - Test criteria: All tests pass with new implementation

## Testing Strategy

### Unit Tests (vitest)

| Test Case                                          | Description                                                        | File                  |
| -------------------------------------------------- | ------------------------------------------------------------------ | --------------------- |
| `should generate valid JavaScript syntax`          | Script parses without errors (use `new Function()` or `vm.Script`) | bin-scripts.test.ts   |
| `should include correct opencode binary path`      | Script contains path with provided version                         | bin-scripts.test.ts   |
| `should use path.join for all paths`               | Script contains `join(__dirname` patterns                          | bin-scripts.test.ts   |
| `should use CommonJS require`                      | Script contains `require('child_process')` etc.                    | bin-scripts.test.ts   |
| `should handle git error with try-catch`           | Script contains try-catch around execSync                          | bin-scripts.test.ts   |
| `should handle JSON parse error`                   | Script contains try-catch around JSON.parse                        | bin-scripts.test.ts   |
| `should use spawnSync with stdio inherit`          | Script contains `spawnSync` and `stdio: 'inherit'`                 | bin-scripts.test.ts   |
| `should propagate exit code`                       | Script contains `process.exit(result.status`                       | bin-scripts.test.ts   |
| `Unix wrapper uses exec with correct paths`        | Contains `exec '<node>' '<script>'`                                | bin-scripts.test.ts   |
| `Windows wrapper uses correct paths and exit`      | Contains node/script paths and `exit /b`                           | bin-scripts.test.ts   |
| `generateOpencodeScript returns array of 2`        | Returns [.cjs, wrapper]                                            | bin-scripts.test.ts   |
| `bundledNodePath correct for Unix`                 | PathProvider returns `lib/node`                                    | path-provider.test.ts |
| `bundledNodePath correct for Windows`              | PathProvider returns `lib/node.exe`                                | path-provider.test.ts |
| `should generate identical output for same inputs` | Generator is pure/deterministic                                    | bin-scripts.test.ts   |

### Boundary Tests (vitest)

| Test Case                                    | Description                           | File                         |
| -------------------------------------------- | ------------------------------------- | ---------------------------- |
| `should attach when workspace in ports.json` | Full success path with mock opencode  | bin-scripts.boundary.test.ts |
| `should error when not in git repo`          | Run in non-git directory              | bin-scripts.boundary.test.ts |
| `should error when ports.json missing`       | Run without ports.json file           | bin-scripts.boundary.test.ts |
| `should error when ports.json invalid`       | Run with malformed JSON               | bin-scripts.boundary.test.ts |
| `should error when workspace not found`      | Run with ports.json missing workspace | bin-scripts.boundary.test.ts |
| `should propagate exit code 0 on success`    | Verify exit code passthrough          | bin-scripts.boundary.test.ts |
| `should propagate non-zero exit code`        | Verify failure exit code              | bin-scripts.boundary.test.ts |
| `should handle paths with spaces`            | Test with spaced directory names      | bin-scripts.boundary.test.ts |

### Manual Testing Checklist

- [ ] Run `opencode` in a CodeHydra workspace terminal (Linux/macOS)
- [ ] Run `opencode` in a CodeHydra workspace terminal (Windows)
- [ ] Run `opencode` outside a git repository → verify error message matches table
- [ ] Run `opencode` in a git repo not managed by CodeHydra → verify error message matches table
- [ ] Verify Ctrl+C properly terminates the opencode process

## Dependencies

No new dependencies required. Uses:

- Bundled Node.js from code-server (`<codeServerDir>/lib/node[.exe]`)
- Node.js built-ins only: `child_process`, `fs`, `path`

## Documentation Updates

### Files to Update

| File      | Changes Required                                                                                                                                                                                                                                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AGENTS.md | Update CLI Wrapper Scripts section: (1) Change opencode description to "Uses bundled Node.js to parse ports.json and attach to managed server", (2) Add note about Node.js wrapper architecture (thin shell → Node.js script → binary), (3) Note that standalone mode is not supported - opencode only works in managed workspaces |

### New Documentation Required

None required.

## Definition of Done

- [ ] All implementation steps complete
- [ ] `npm run validate:fix` passes
- [ ] Documentation updated
- [ ] User acceptance testing passed
- [ ] Changes committed
