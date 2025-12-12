---
status: CLEANUP
last_updated: 2025-12-12
reviewers:
  - review-electron
  - review-arch
  - review-testing
  - review-senior
  - review-docs
---

# VIEW_GPU_THROTTLE

## Overview

- **Problem**: GPU crashes (GNOME compositor crash) with 5+ workspaces. Detached views still hold GPU resources (WebGL contexts, compositor allocations) even though they're not rendering.
- **Solution**: Multi-layer throttling for inactive views controlled by `CODEHYDRA_WORKSPACE_THROTTLING` env var:
  - `off` - No throttling (current behavior)
  - `basic` - `setBackgroundThrottling(true)` + `visibilitychange` dispatch
  - `full` - Basic + WebGL context loss to release GPU memory
- **Additional**: Replace `CODEHYDRA_DISABLE_HARDWARE_ACCELERATION` with flexible `CODEHYDRA_ELECTRON_FLAGS` env var for arbitrary Electron command-line switches.
- **Risks**:
  - VS Code extension compatibility with WebGL context loss → Mitigated: WebGL contexts auto-restore via `WEBGL_lose_context.restoreContext()`; code-server is trusted content
  - Slight delay when switching workspaces (context restore) → Mitigated: fire-and-forget unthrottle after attach for visual continuity
  - Extensions that don't handle `visibilitychange` → Low risk: standard browser API
  - Race condition during rapid workspace switching → Mitigated: cancellation tracking per view
- **Alternatives Considered**:
  - View unloading (navigate to blank): Too aggressive, loses VS Code state
  - Always-on throttling: Some users may not need it, adds complexity
  - Per-view GPU process: Not supported by Electron architecture

## Architecture

```
Environment Variables:
┌─────────────────────────────────────────────────────────────────────┐
│ CODEHYDRA_WORKSPACE_THROTTLING=off|basic|full (default: off)        │
│ CODEHYDRA_ELECTRON_FLAGS="--flag1 --flag2" (optional, no quotes)    │
└─────────────────────────────────────────────────────────────────────┘

Throttling Levels:
┌─────────────────────────────────────────────────────────────────────┐
│ OFF (default)                                                        │
│  └── Current behavior: detach only, no additional throttling        │
├─────────────────────────────────────────────────────────────────────┤
│ BASIC                                                                │
│  └── setBackgroundThrottling(true) only - safe, no JS injection     │
├─────────────────────────────────────────────────────────────────────┤
│ FULL                                                                 │
│  ├── setBackgroundThrottling(true)                                  │
│  ├── visibilitychange dispatch - hints VS Code to reduce activity   │
│  └── WebGL context loss - releases GPU memory from canvases         │
└─────────────────────────────────────────────────────────────────────┘

View State Machine (throttling adds to existing detachment):
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   ACTIVE ──(detach)──► DETACHED ──(throttle)──► THROTTLED           │
│     ▲                                               │                │
│     │                                               │                │
│     └────────(unthrottle)────(attach)───────────────┘                │
│                                                                      │
│   Note: Throttling happens AFTER detachment (not instead of).       │
│         Views progress: Active → Detached → Throttled (if enabled)  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

View States:
┌─────────────────────────────────────────────────────────────────────┐
│ ACTIVE (attached to contentView)                                     │
│  ├── backgroundThrottling: false                                    │
│  ├── visibilitychange dispatched (document.hidden unchanged)        │
│  └── WebGL contexts: active                                         │
├─────────────────────────────────────────────────────────────────────┤
│ INACTIVE + THROTTLED (detached from contentView)                    │
│  ├── backgroundThrottling: true (basic/full)                        │
│  ├── visibilitychange dispatched (document.hidden unchanged)        │
│  └── WebGL contexts: LOST (full only) - GPU memory freed            │
└─────────────────────────────────────────────────────────────────────┘

Note: We only dispatch visibilitychange events, NOT override document.hidden.
Overriding document.hidden with Object.defineProperty breaks VS Code's
internal state tracking and causes black screens on view re-activation.

Race Condition Prevention:
┌─────────────────────────────────────────────────────────────────────┐
│ Each view tracks in-flight throttle operations via AbortController. │
│ When a new operation starts, any previous operation is cancelled.   │
│                                                                      │
│   throttleOperations: Map<workspacePath, AbortController>           │
│                                                                      │
│   throttleView(path):                                               │
│     1. Cancel any existing operation for path                       │
│     2. Create new AbortController, store in map                     │
│     3. Execute throttle (check signal.aborted before each step)     │
│     4. Remove from map on completion                                │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Implementation Steps

### Step 1: Write throttling configuration tests

- [x] **Step 1a: Test getThrottleLevel returns 'off' when env var not set**
  - Files: `src/main/throttling.test.ts`
  - Test criteria: `getThrottleLevel()` returns `'off'` when `CODEHYDRA_WORKSPACE_THROTTLING` is undefined

- [x] **Step 1b: Test getThrottleLevel returns correct values**
  - Files: `src/main/throttling.test.ts`
  - Test criteria: Returns `'off'`, `'basic'`, `'full'` for corresponding env var values

- [x] **Step 1c: Test getThrottleLevel returns 'off' for invalid values**
  - Files: `src/main/throttling.test.ts`
  - Test criteria: Returns `'off'` for invalid values like `'invalid'`, `''`, `'FULL'` (case-sensitive)

### Step 2: Implement throttling configuration

- [x] **Step 2a: Create throttling types and getThrottleLevel**
  - Create NEW file `src/main/throttling.ts` with:
    - `ThrottleLevel` type: `'off' | 'basic' | 'full'`
    - `getThrottleLevel()` function that reads `CODEHYDRA_WORKSPACE_THROTTLING`
    - Default to `'off'` if env var not set or invalid (case-sensitive)
  - Files: `src/main/throttling.ts`
  - Verify Step 1 tests pass

### Step 3: Write Electron flags tests

- [x] **Step 3a: Test parseElectronFlags parses single flag**
  - Files: `src/main/throttling.test.ts`
  - Test criteria: `parseElectronFlags('--disable-gpu')` returns `[{ name: 'disable-gpu' }]`

- [x] **Step 3b: Test parseElectronFlags parses multiple flags**
  - Files: `src/main/throttling.test.ts`
  - Test criteria: `parseElectronFlags('--flag1 --flag2')` returns both flags

- [x] **Step 3c: Test parseElectronFlags parses flags with values**
  - Files: `src/main/throttling.test.ts`
  - Test criteria: `parseElectronFlags('--use-gl=swiftshader')` returns `[{ name: 'use-gl', value: 'swiftshader' }]`

- [x] **Step 3d: Test parseElectronFlags throws on quotes**
  - Files: `src/main/throttling.test.ts`
  - Test criteria: `parseElectronFlags('--flag="value"')` throws error with helpful message

- [x] **Step 3e: Test parseElectronFlags handles empty/whitespace**
  - Files: `src/main/throttling.test.ts`
  - Test criteria: Returns empty array for `''`, `'   '`, `undefined`

### Step 4: Implement Electron flags parsing

- [x] **Step 4a: Add parseElectronFlags function**
  - Add to `src/main/throttling.ts`:
    - `parseElectronFlags(flags: string | undefined)` function
    - Returns array of `{ name: string, value?: string }`
    - Throws error if quotes detected (with helpful message about not supporting quoted values)
    - Splits by whitespace, parses `--name=value` or `--name` format
  - Files: `src/main/throttling.ts`
  - Verify Step 3 tests pass

- [x] **Step 4b: Add applyElectronFlags function**
  - Add to `src/main/throttling.ts`:
    - `applyElectronFlags(app: Electron.App)` function
    - Reads `CODEHYDRA_ELECTRON_FLAGS` env var
    - Calls `parseElectronFlags()` and applies each via `app.commandLine.appendSwitch()`
    - Logs each applied flag to console
  - Files: `src/main/throttling.ts`

- [x] **Step 4c: Integrate flags in main process**
  - In `src/main/index.ts`, at module scope (TOP of file, before any other Electron API usage):
    - Remove `CODEHYDRA_DISABLE_HARDWARE_ACCELERATION` code block
    - Import `applyElectronFlags` from `./throttling`
    - Call `applyElectronFlags(app)` immediately after imports
    - CRITICAL: Must be before `app.whenReady()` and before any code that might trigger GPU initialization
  - Files: `src/main/index.ts`

### Step 5: Write throttling method tests

- [x] **Step 5a: Test throttleView with level=off**
  - Files: `src/main/managers/view-manager.test.ts`
  - Test criteria: No `setBackgroundThrottling` call, no `executeJavaScript` call

- [x] **Step 5b: Test throttleView with level=basic**
  - Files: `src/main/managers/view-manager.test.ts`
  - Test criteria: `setBackgroundThrottling(true)` called, `executeJavaScript` called with script containing `visibilitychange` (see Appendix: Basic Throttle Script)

- [x] **Step 5c: Test throttleView with level=full**
  - Files: `src/main/managers/view-manager.test.ts`
  - Test criteria: `setBackgroundThrottling(true)` called, `executeJavaScript` called with script containing `visibilitychange` AND `loseContext` (see Appendix: Full Throttle Script)

- [x] **Step 5d: Test unthrottleView with level=off**
  - Files: `src/main/managers/view-manager.test.ts`
  - Test criteria: No `setBackgroundThrottling` call, no `executeJavaScript` call

- [x] **Step 5e: Test unthrottleView with level=basic**
  - Files: `src/main/managers/view-manager.test.ts`
  - Test criteria: `setBackgroundThrottling(false)` called, `executeJavaScript` called with visibility restore script (see Appendix: Basic Unthrottle Script)

- [x] **Step 5f: Test unthrottleView with level=full**
  - Files: `src/main/managers/view-manager.test.ts`
  - Test criteria: `setBackgroundThrottling(false)` called, `executeJavaScript` called with script containing `restoreContext` (see Appendix: Full Unthrottle Script)

- [x] **Step 5g: Test throttle operation cancellation**
  - Files: `src/main/managers/view-manager.test.ts`
  - Test criteria: Starting new throttle/unthrottle cancels previous in-flight operation for same view

- [x] **Step 5h: Test throttleView error handling**
  - Files: `src/main/managers/view-manager.test.ts`
  - Test criteria: Errors from `executeJavaScript` are caught and logged (not thrown)

### Step 6: Implement throttling in ViewManager

- [x] **Step 6a: Add throttle level and operation tracking to ViewManager**
  - Import `getThrottleLevel` and `ThrottleLevel` from `./throttling`
  - Add `private readonly throttleLevel: ThrottleLevel` (read once in constructor)
  - Add `private readonly throttleOperations = new Map<string, AbortController>()`
  - Files: `src/main/managers/view-manager.ts`

- [x] **Step 6b: Implement throttleView method**
  - Add `private async throttleView(workspacePath: string): Promise<void>`
  - Early return if level is `'off'`
  - Cancel any existing operation for this path (abort + delete from map)
  - Create new AbortController, store in map
  - Call `view.webContents.setBackgroundThrottling(true)` for basic/full
  - Call `view.webContents.executeJavaScript()` with Basic Throttle Script (see Appendix)
  - For full only: call `executeJavaScript()` with WebGL context loss script (see Appendix)
  - Check `signal.aborted` before each step, return early if aborted
  - Wrap in try-catch, log errors with context (workspace path, level, error)
  - Remove from map on completion (success or error)
  - Files: `src/main/managers/view-manager.ts`

- [x] **Step 6c: Implement unthrottleView method**
  - Add `private async unthrottleView(workspacePath: string): Promise<void>`
  - Early return if level is `'off'`
  - Cancel any existing operation for this path
  - Create new AbortController, store in map
  - Call `view.webContents.setBackgroundThrottling(false)` for basic/full
  - For full only: call `executeJavaScript()` with WebGL context restore script (see Appendix)
  - Call `executeJavaScript()` with visibility restore script (see Appendix)
  - Check `signal.aborted` before each step
  - Wrap in try-catch, log errors
  - Remove from map on completion
  - Files: `src/main/managers/view-manager.ts`

- [x] **Step 6d: Integrate throttleView with detachView**
  - In the existing `detachView()` method, after `contentView.removeChildView(view)`:
  - Call `void this.throttleView(workspacePath)` (fire-and-forget, don't await)
  - Note: Fire-and-forget because view is already hidden; throttling happens in background
  - Files: `src/main/managers/view-manager.ts`

- [x] **Step 6e: Integrate unthrottleView with attachView**
  - In the existing `attachView()` method, after `contentView.addChildView(view)`:
  - Call `void this.unthrottleView(workspacePath)` (fire-and-forget)
  - Note: Fire-and-forget for visual continuity (attach-before-detach); unthrottle in background
  - Files: `src/main/managers/view-manager.ts`

- [x] **Step 6f: Verify Step 5 tests pass**

### Step 7: Integration tests

- [x] **Step 7a: Test workspace switch with throttling=full**
  - Files: `src/main/managers/view-manager.test.ts`
  - Test criteria:
    - Create 3 workspaces, activate first
    - Switch to second workspace
    - Assert: second view attached and unthrottled, first view detached and throttle called
    - Switch to third workspace
    - Assert: third view attached and unthrottled, second view detached and throttle called

- [x] **Step 7b: Test rapid switching with throttling=full**
  - Files: `src/main/managers/view-manager.test.ts`
  - Test criteria:
    - Create 3 workspaces
    - Switch 10 times rapidly between them
    - Assert: final workspace view is attached, no exceptions thrown
    - Assert: throttle operations for intermediate views were cancelled (via AbortController)

### Step 8: Update documentation

- [x] **Step 8a: Update AGENTS.md**
  - Update "View Detachment Pattern" section to mention throttling
  - Add new section "GPU Troubleshooting" with:
    - `CODEHYDRA_WORKSPACE_THROTTLING` levels and when to use each
    - `CODEHYDRA_ELECTRON_FLAGS` with common examples
    - Note that `setBackgroundThrottling` is best-effort for GPU (primarily affects timers)
    - Note that quotes are not supported in flags (will error)
  - Files: `AGENTS.md`

- [x] **Step 8b: Update ARCHITECTURE.md**
  - Add throttling states to View Lifecycle diagram
  - Document state machine: Active → Detached → Throttled
  - Document throttle/unthrottle timing (fire-and-forget vs await)
  - Files: `docs/ARCHITECTURE.md`

## Testing Strategy

### Unit Tests (vitest)

| Test Case                    | Description                                  | File                 |
| ---------------------------- | -------------------------------------------- | -------------------- |
| getThrottleLevel-default     | Returns 'off' when env var not set           | throttling.test.ts   |
| getThrottleLevel-basic       | Returns 'basic' when env var is 'basic'      | throttling.test.ts   |
| getThrottleLevel-full        | Returns 'full' when env var is 'full'        | throttling.test.ts   |
| getThrottleLevel-invalid     | Returns 'off' for invalid values             | throttling.test.ts   |
| parseElectronFlags-single    | Parses single flag                           | throttling.test.ts   |
| parseElectronFlags-multiple  | Parses multiple flags                        | throttling.test.ts   |
| parseElectronFlags-values    | Parses flags with values                     | throttling.test.ts   |
| parseElectronFlags-quotes    | Throws on quotes                             | throttling.test.ts   |
| parseElectronFlags-empty     | Returns empty for empty input                | throttling.test.ts   |
| throttleView-off             | No throttling when level=off                 | view-manager.test.ts |
| throttleView-basic           | Background throttling + visibility for basic | view-manager.test.ts |
| throttleView-full            | Basic + WebGL context loss for full          | view-manager.test.ts |
| unthrottleView-off           | No unthrottling when level=off               | view-manager.test.ts |
| unthrottleView-basic         | Restore throttling + visibility for basic    | view-manager.test.ts |
| unthrottleView-full          | Basic + WebGL context restore for full       | view-manager.test.ts |
| throttle-cancellation        | New operation cancels previous               | view-manager.test.ts |
| throttleView-error           | Errors logged, not thrown                    | view-manager.test.ts |
| integration-switch-throttled | Workspace switch works with throttling       | view-manager.test.ts |
| integration-rapid-throttled  | Rapid switching cancels intermediate ops     | view-manager.test.ts |

### Manual Testing Checklist

#### Environment Variables

- [ ] `CODEHYDRA_WORKSPACE_THROTTLING` not set → behaves as current (no throttling)
- [ ] `CODEHYDRA_WORKSPACE_THROTTLING=off` → no throttling
- [ ] `CODEHYDRA_WORKSPACE_THROTTLING=basic` → basic throttling active
- [ ] `CODEHYDRA_WORKSPACE_THROTTLING=full` → full throttling active
- [ ] `CODEHYDRA_WORKSPACE_THROTTLING=FULL` → falls back to off (case-sensitive)
- [ ] `CODEHYDRA_ELECTRON_FLAGS="--disable-gpu"` → GPU disabled, logged to console
- [ ] `CODEHYDRA_ELECTRON_FLAGS="--flag=\"value\""` → Error on startup (quotes not supported)

#### GPU Stability (with throttling=full)

- [ ] Open 5 workspaces, switch between them → no GPU crash
- [ ] Open 10 workspaces, switch between them → no GPU crash
- [ ] Rapid switching between workspaces → no GPU crash
- [ ] Leave app running 30 minutes with workspaces → stable

#### Visual Quality (with throttling=full)

- [ ] Workspace switch has acceptable delay (<500ms)
- [ ] No white flash between switches
- [ ] VS Code UI renders correctly after switch
- [ ] Monaco editor works correctly after switch
- [ ] Terminal works correctly after switch
- [ ] Extensions work correctly after switch

#### Fallback Testing

- [ ] `CODEHYDRA_ELECTRON_FLAGS="--disable-gpu"` prevents all GPU crashes
- [ ] CPU usage acceptable with `--disable-gpu` flag

## Dependencies

None - uses existing Electron APIs.

## Documentation Updates

### Files to Update

| File                 | Changes Required                                   |
| -------------------- | -------------------------------------------------- |
| AGENTS.md            | Add GPU Troubleshooting section, document env vars |
| docs/ARCHITECTURE.md | Add throttling to View Lifecycle, document states  |

### New Documentation Required

None - all documentation fits in existing files.

## Definition of Done

- [ ] All implementation steps complete
- [ ] All unit tests pass
- [ ] `npm run validate:fix` passes
- [ ] Documentation updated (AGENTS.md, ARCHITECTURE.md)
- [ ] Manual testing checklist completed
- [ ] GPU stability verified with throttling=full (5+ workspaces, no crash)
- [ ] User acceptance testing passed
- [ ] Changes committed

## Appendix: Throttling Scripts

Note: We only dispatch visibilitychange events, NOT override document.hidden.
Overriding document.hidden with Object.defineProperty breaks VS Code's internal
state tracking and causes black screens on view re-activation.

### Visibility Change Script (basic + full)

```javascript
(function () {
  // Dispatch visibilitychange to hint VS Code to reduce/restore activity
  // Note: We do NOT modify document.hidden - VS Code will read the real value
  document.dispatchEvent(new Event("visibilitychange"));
  return true;
})();
```

### WebGL Context Loss Script (full only)

```javascript
(function () {
  // Force WebGL context loss on all canvases to release GPU memory
  document.querySelectorAll("canvas").forEach((canvas) => {
    try {
      const gl = canvas.getContext("webgl") || canvas.getContext("webgl2");
      if (gl) {
        const ext = gl.getExtension("WEBGL_lose_context");
        if (ext) ext.loseContext();
      }
    } catch (e) {
      // Ignore - canvas may not have WebGL context
    }
  });
  return true;
})();
```

### WebGL Context Restore Script (full only)

```javascript
(function () {
  // Restore WebGL contexts
  document.querySelectorAll("canvas").forEach((canvas) => {
    try {
      const gl = canvas.getContext("webgl") || canvas.getContext("webgl2");
      if (gl) {
        const ext = gl.getExtension("WEBGL_lose_context");
        if (ext) ext.restoreContext();
      }
    } catch (e) {
      // Ignore - canvas may not have WebGL context
    }
  });
  return true;
})();
```

## Appendix: Common Electron Flags for GPU Issues

Reference: https://www.electronjs.org/docs/latest/api/command-line-switches

| Flag                                   | Effect                        | Use When                        |
| -------------------------------------- | ----------------------------- | ------------------------------- |
| `--disable-gpu`                        | Disables all GPU acceleration | Complete GPU/compositor crashes |
| `--disable-gpu-compositing`            | Disables GPU compositor only  | Compositor-specific crashes     |
| `--disable-gpu-rasterization`          | Disables GPU rasterization    | Rasterization crashes           |
| `--use-gl=swiftshader`                 | Software WebGL rendering      | WebGL crashes but need WebGL    |
| `--disable-software-rasterizer`        | Disables software fallback    | Force GPU or nothing            |
| `--ignore-gpu-blocklist`               | Ignores GPU blocklist         | GPU incorrectly blocked         |
| `--enable-features=VaapiVideoDecoder`  | Enable VA-API on Linux        | Hardware video decode           |
| `--disable-features=VaapiVideoDecoder` | Disable VA-API on Linux       | VA-API causing issues           |

**Note**: Quoted values are NOT supported. `CODEHYDRA_ELECTRON_FLAGS="--flag=\"value\""` will error on startup.
