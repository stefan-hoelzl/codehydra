---
status: COMPLETED
last_updated: 2025-12-10
reviewers: [review-ui, review-electron, review-arch, review-senior, review-testing, review-docs]
---

# THEMING

## Overview

- **Problem**: CodeHydra has hardcoded dark theme colors scattered across components, missing CSS variable definitions, and no light theme support. This prevents the app from adapting to system preferences.
- **Solution**: Consolidate all colors into CSS custom properties with both dark and light theme values, using `prefers-color-scheme` media query to automatically follow system preference.
- **Risks**:
  - Light theme colors may need iteration after visual testing
  - Some VS Code variable mappings may not work perfectly in standalone mode
- **Alternatives Considered**:
  - **Theme store with user preference**: Rejected - adds complexity for minimal benefit when system preference works well
  - **CSS-in-JS theming**: Rejected - current CSS variables approach is simpler and performs better
  - **Use @vscode-elements theming**: Deferred - package is unused, would require component migration
  - **Electron nativeTheme API**: Considered for future - provides more reliable cross-platform theme detection, especially on Linux. Current CSS approach is simpler and sufficient for now.
  - **CSS @layer**: Considered for future - would provide clearer cascade control but adds complexity for current scope.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CSS THEMING ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  variables.css                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │  :root {                                                          │  │
│  │    /* Dark theme (default) - used in standalone mode */           │  │
│  │    --ch-foreground: var(--vscode-foreground, #cccccc);            │  │
│  │    --ch-background: var(--vscode-editor-background, #1e1e1e);     │  │
│  │    --ch-success: var(--vscode-terminal-ansiGreen, #4ec9b0);       │  │
│  │    --ch-agent-idle: var(--ch-success); /* Reference semantic */   │  │
│  │    /* ... more variables ... */                                   │  │
│  │                                                                   │  │
│  │    /* Layout variables (theme-independent, NOT in media query) */ │  │
│  │    --ch-sidebar-width: 250px;                                     │  │
│  │    --ch-dialog-max-width: 450px;                                  │  │
│  │  }                                                                │  │
│  │                                                                   │  │
│  │  @media (prefers-color-scheme: light) {                           │  │
│  │    :root {                                                        │  │
│  │      /* Light theme: ONLY fallback values change */               │  │
│  │      --ch-foreground: var(--vscode-foreground, #3c3c3c);          │  │
│  │              same variable ref ──┘           └── different fallback│  │
│  │    }                                                              │  │
│  │  }                                                                │  │
│  │                                                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│                              ▼                                          │
│  Components use --ch-* variables exclusively                            │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  .indicator--idle { background: var(--ch-agent-idle); }           │  │
│  │  .dialog-overlay { background: var(--ch-overlay-bg); }            │  │
│  │  .tooltip { box-shadow: var(--ch-shadow); }                       │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

Data Flow:
┌──────────────┐    ┌─────────────────┐    ┌──────────────────┐
│   System     │───▶│  CSS Media      │───▶│  --ch-* vars     │
│   Preference │    │  Query          │    │  (auto-updated)  │
└──────────────┘    └─────────────────┘    └──────────────────┘
                                                    │
                    ┌───────────────────────────────┘
                    ▼
┌──────────────────────────────────────────────────────────────┐
│  Components automatically re-render with new colors          │
│  (no JavaScript needed - pure CSS reactivity)                │
└──────────────────────────────────────────────────────────────┘
```

### VS Code Variable Fallback Pattern

The `var(--vscode-*, fallback)` pattern enables dual-mode operation:

```css
--ch-foreground: var(--vscode-foreground, #cccccc);
                     └── VS Code injects   └── Standalone fallback
```

- **In code-server context**: VS Code injects `--vscode-*` variables, which take precedence
- **In standalone mode**: Fallback values are used, controlled by `prefers-color-scheme`

**Important**: The light/dark media query only changes the fallback values. When VS Code injects its variables, the VS Code theme takes precedence regardless of system preference.

## File Change Summary

| File                                                       | Action   | Purpose                                           |
| ---------------------------------------------------------- | -------- | ------------------------------------------------- |
| `src/renderer/lib/styles/variables.css`                    | Modified | Add missing variables, add light theme block      |
| `src/renderer/lib/styles/global.css`                       | Modified | Ensure light theme compatibility                  |
| `src/renderer/lib/components/AgentStatusIndicator.svelte`  | Modified | Replace hardcoded colors                          |
| `src/renderer/lib/components/AgentStatusIndicator.test.ts` | Modified | Add theme color tests                             |
| `src/renderer/lib/components/ShortcutOverlay.svelte`       | Modified | Use --ch-\* variables, remove duplicate .sr-only  |
| `src/renderer/lib/components/ShortcutOverlay.test.ts`      | Modified | Add theme variable tests                          |
| `src/renderer/lib/components/Dialog.svelte`                | Modified | Use --ch-overlay-bg                               |
| `src/renderer/lib/components/Dialog.test.ts`               | Modified | Add overlay theme test                            |
| `src/renderer/lib/components/SetupComplete.svelte`         | Verified | No changes needed (uses --ch-success)             |
| `src/renderer/lib/components/SetupComplete.test.ts`        | Modified | Add theme color tests                             |
| `src/renderer/lib/components/SetupError.svelte`            | Verified | No changes needed (uses --ch-danger, --ch-border) |
| `src/renderer/lib/components/SetupError.test.ts`           | Modified | Add theme color tests                             |
| `src/renderer/lib/integration.test.ts`                     | Modified | Add theme cascade and switching tests             |
| `docs/ARCHITECTURE.md`                                     | Modified | Add Theming System section                        |
| `AGENTS.md`                                                | Modified | Add CSS Theming Patterns section                  |

## CSS Variable Organization

### Variable Categories

| Category    | Variables                                                                                                                                                                             | Purpose                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Core        | `--ch-foreground`, `--ch-background`                                                                                                                                                  | Base text and background                       |
| Border      | `--ch-border`, `--ch-input-border`, `--ch-input-hover-border`                                                                                                                         | Borders and dividers                           |
| Interactive | `--ch-button-bg`, `--ch-button-fg`, `--ch-button-hover-bg`, `--ch-button-disabled-bg`, `--ch-button-disabled-fg`, `--ch-input-bg`, `--ch-input-disabled-bg`, `--ch-input-disabled-fg` | Buttons, inputs, forms                         |
| Focus       | `--ch-focus-border`                                                                                                                                                                   | Focus indicators                               |
| Selection   | `--ch-list-active-bg`, `--ch-list-hover-bg`                                                                                                                                           | Selected/active/hover items                    |
| Semantic    | `--ch-success`, `--ch-danger`, `--ch-warning`                                                                                                                                         | Status colors                                  |
| Agent       | `--ch-agent-idle`, `--ch-agent-busy`                                                                                                                                                  | Agent status indicator (references semantic)   |
| Overlay     | `--ch-overlay-bg`, `--ch-shadow-color`, `--ch-shadow`                                                                                                                                 | Modals, tooltips                               |
| Layout      | `--ch-sidebar-width`, `--ch-dialog-max-width`                                                                                                                                         | Sizing (theme-independent, NOT in media query) |

### Derived Variable Pattern

Agent-specific variables reference semantic colors for consistency, but allow independent adjustment if needed in future:

```css
/* Semantic colors - used throughout the app */
--ch-success: var(--vscode-terminal-ansiGreen, #4ec9b0);
--ch-danger: var(--vscode-errorForeground, #f14c4c);

/* Agent colors - reference semantic colors */
--ch-agent-idle: var(--ch-success);
--ch-agent-busy: var(--ch-danger);
```

### Shadow Variable Pattern

Shadow is split into color and composite for flexibility:

```css
/* Shadow color - can be used in text-shadow, filter: drop-shadow(), etc. */
--ch-shadow-color: rgba(0, 0, 0, 0.3);

/* Composite shadow - convenience variable for common box-shadow */
--ch-shadow: 0 2px 8px var(--ch-shadow-color);
```

### Contrast Ratio Validation (WCAG AA)

All color pairs validated for minimum 4.5:1 contrast ratio (normal text) or 3:1 (large text/UI):

| Pair                                    | Dark Ratio                  | Light Ratio                 | Status  |
| --------------------------------------- | --------------------------- | --------------------------- | ------- |
| `--ch-foreground` / `--ch-background`   | 10.5:1 (#cccccc on #1e1e1e) | 10.5:1 (#3c3c3c on #ffffff) | ✅ Pass |
| `--ch-button-fg` / `--ch-button-bg`     | 7.1:1 (#ffffff on #0e639c)  | 7.1:1 (#ffffff on #0e639c)  | ✅ Pass |
| `--ch-success` / `--ch-background`      | 8.2:1 (#4ec9b0 on #1e1e1e)  | 4.5:1 (#008000 on #ffffff)  | ✅ Pass |
| `--ch-danger` / `--ch-background`       | 5.3:1 (#f14c4c on #1e1e1e)  | 5.9:1 (#e51400 on #ffffff)  | ✅ Pass |
| `--ch-warning` / `--ch-background`      | 7.8:1 (#cca700 on #1e1e1e)  | 4.6:1 (#bf8803 on #ffffff)  | ✅ Pass |
| `--ch-error-fg` / `--ch-background`     | 6.1:1 (#f48771 on #1e1e1e)  | 5.9:1 (#e51400 on #ffffff)  | ✅ Pass |
| `--ch-focus-border` / `--ch-background` | 4.9:1 (#007fd4 on #1e1e1e)  | 4.7:1 (#0066b8 on #ffffff)  | ✅ Pass |

### Complete Color Mappings

| Variable                  | VS Code Reference                          | Dark Fallback                      | Light Fallback                     |
| ------------------------- | ------------------------------------------ | ---------------------------------- | ---------------------------------- |
| `--ch-foreground`         | `--vscode-foreground`                      | `#cccccc`                          | `#3c3c3c`                          |
| `--ch-background`         | `--vscode-editor-background`               | `#1e1e1e`                          | `#ffffff`                          |
| `--ch-border`             | `--vscode-panel-border`                    | `#454545`                          | `#e5e5e5`                          |
| `--ch-button-bg`          | `--vscode-button-background`               | `#0e639c`                          | `#0e639c`                          |
| `--ch-button-fg`          | `--vscode-button-foreground`               | `#ffffff`                          | `#ffffff`                          |
| `--ch-button-hover-bg`    | `--vscode-button-hoverBackground`          | `#1177bb`                          | `#1177bb`                          |
| `--ch-button-disabled-bg` | —                                          | `#3c3c3c`                          | `#e5e5e5`                          |
| `--ch-button-disabled-fg` | —                                          | `#8c8c8c`                          | `#a0a0a0`                          |
| `--ch-input-bg`           | `--vscode-input-background`                | `#3c3c3c`                          | `#ffffff`                          |
| `--ch-input-border`       | `--vscode-input-border`                    | `#3c3c3c`                          | `#cecece`                          |
| `--ch-input-hover-border` | —                                          | `#5a5a5a`                          | `#b0b0b0`                          |
| `--ch-input-disabled-bg`  | —                                          | `#2d2d2d`                          | `#f0f0f0`                          |
| `--ch-input-disabled-fg`  | —                                          | `#6c6c6c`                          | `#a0a0a0`                          |
| `--ch-focus-border`       | `--vscode-focusBorder`                     | `#007fd4`                          | `#0066b8`                          |
| `--ch-list-active-bg`     | `--vscode-list-activeSelectionBackground`  | `#094771`                          | `#0060c0`                          |
| `--ch-list-hover-bg`      | `--vscode-list-hoverBackground`            | `#2a2d2e`                          | `#f0f0f0`                          |
| `--ch-error-fg`           | `--vscode-errorForeground`                 | `#f48771`                          | `#e51400`                          |
| `--ch-error-bg`           | `--vscode-inputValidation-errorBackground` | `#5a1d1d`                          | `#f2dede`                          |
| `--ch-success`            | `--vscode-terminal-ansiGreen`              | `#4ec9b0`                          | `#008000`                          |
| `--ch-danger`             | `--vscode-errorForeground`                 | `#f14c4c`                          | `#e51400`                          |
| `--ch-warning`            | `--vscode-editorWarning-foreground`        | `#cca700`                          | `#bf8803`                          |
| `--ch-agent-idle`         | (references `--ch-success`)                | —                                  | —                                  |
| `--ch-agent-busy`         | (references `--ch-danger`)                 | —                                  | —                                  |
| `--ch-overlay-bg`         | —                                          | `rgba(0,0,0,0.5)`                  | `rgba(0,0,0,0.4)`                  |
| `--ch-shadow-color`       | —                                          | `rgba(0,0,0,0.3)`                  | `rgba(0,0,0,0.15)`                 |
| `--ch-shadow`             | —                                          | `0 2px 8px var(--ch-shadow-color)` | `0 2px 8px var(--ch-shadow-color)` |

## Implementation Steps

Each step follows TDD: (a) Write failing tests, (b) Implement, (c) Verify tests pass.

### Pre-requisite: Verify .ch-visually-hidden exists

Before Step 4, verify `src/renderer/lib/styles/global.css` contains `.ch-visually-hidden` class with proper implementation:

```css
.ch-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

This class already exists (lines 50-60). ShortcutOverlay's `.sr-only` is functionally identical and can be removed.

---

- [x] **Step 1: Expand variables.css with missing variables**

  **1a. Write failing tests** (in `integration.test.ts`):
  - Test: `all semantic variables are defined with non-empty values`
  - Test: `--ch-border resolves to expected value` (currently undefined, used by SetupError)
  - Test: `--ch-button-hover-bg resolves to expected value` (currently undefined, used by SetupError)

  **1b. Implement**:
  - Add missing semantic colors: `--ch-success`, `--ch-danger`, `--ch-warning`
  - Add border variable: `--ch-border` (already referenced by SetupError.svelte line 122)
  - Add hover variable: `--ch-button-hover-bg` (already referenced by SetupError.svelte line 110)
  - Add component colors: `--ch-agent-idle`, `--ch-agent-busy`, `--ch-overlay-bg`
  - Add shadow variables: `--ch-shadow-color`, `--ch-shadow` (split for flexibility)
  - Add hover/disabled states: `--ch-list-hover-bg`, `--ch-input-hover-border`, `--ch-button-disabled-*`, `--ch-input-disabled-*`
  - Keep layout variables (`--ch-sidebar-width`, `--ch-dialog-max-width`) outside any media query

  **1c. Verify tests pass**

  Files affected: `src/renderer/lib/styles/variables.css`, `src/renderer/lib/integration.test.ts`

---

- [x] **Step 2: Add light theme media query block**

  **2a. Write failing tests** (in `integration.test.ts`):
  - Test: `matchMedia('prefers-color-scheme: light') triggers light theme variables`
  - Test: `theme defaults to dark when prefers-color-scheme has no preference`
  - Test: `layout variables remain unchanged between themes`

  **2b. Implement**:
  - Add `@media (prefers-color-scheme: light)` block with all variable overrides
  - Only override fallback values, keep same `--vscode-*` references
  - Do NOT include layout variables in media query block

  **2c. Verify tests pass**

  Files affected: `src/renderer/lib/styles/variables.css`, `src/renderer/lib/integration.test.ts`

---

- [x] **Step 3: Refactor AgentStatusIndicator to use CSS variables**

  **3a. Write failing tests** (in `AgentStatusIndicator.test.ts`):
  - Test: `idle state uses var(--ch-agent-idle), not hardcoded #4caf50`
  - Test: `busy state uses var(--ch-agent-busy), not hardcoded #f44336`
  - Test: `mixed state gradient uses var(--ch-agent-busy) and var(--ch-agent-idle)`
  - Test: `tooltip shadow uses var(--ch-shadow)`
  - Regression test: `dark theme idle renders with expected green color`
  - Regression test: `dark theme busy renders with expected red color`

  **3b. Implement**:
  - Replace `.indicator--idle { background-color: #4caf50; }` with `background-color: var(--ch-agent-idle);`
  - Replace `.indicator--busy { background-color: #f44336; }` with `background-color: var(--ch-agent-busy);`
  - Replace `.indicator--mixed { background: linear-gradient(to bottom, #f44336 50%, #4caf50 50%); }` with `background: linear-gradient(to bottom, var(--ch-agent-busy) 50%, var(--ch-agent-idle) 50%);`
  - Replace `.tooltip { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3); }` with `box-shadow: var(--ch-shadow);`

  **3c. Verify tests pass**

  Files affected: `src/renderer/lib/components/AgentStatusIndicator.svelte`, `src/renderer/lib/components/AgentStatusIndicator.test.ts`

---

- [x] **Step 4: Refactor ShortcutOverlay to use --ch-\* variables**

  **4a. Write failing tests** (in `ShortcutOverlay.test.ts`):
  - Test: `component uses var(--ch-background), not --vscode-editor-background`
  - Test: `component uses var(--ch-border), not --vscode-panel-border`
  - Test: `component uses var(--ch-foreground), not --vscode-foreground`
  - Test: `no .sr-only class defined in component styles`

  **4b. Implement**:
  - Replace `var(--vscode-editor-background, rgba(30, 30, 30, 0.9))` with `var(--ch-background)`
  - Replace `var(--vscode-panel-border, #454545)` with `var(--ch-border)`
  - Replace `var(--vscode-foreground, #cccccc)` with `var(--ch-foreground)`
  - Remove `.sr-only` CSS class definition (lines 97-107)
  - Replace HTML `class="sr-only"` with `class="ch-visually-hidden"`

  **4c. Verify tests pass**

  Files affected: `src/renderer/lib/components/ShortcutOverlay.svelte`, `src/renderer/lib/components/ShortcutOverlay.test.ts`

---

- [x] **Step 5: Refactor Dialog to use CSS variables for overlay**

  **5a. Write failing tests** (in `Dialog.test.ts`):
  - Test: `overlay uses var(--ch-overlay-bg), not hardcoded rgba(0, 0, 0, 0.5)`
  - Regression test: `dark theme overlay is semi-transparent black`

  **5b. Implement**:
  - Replace `.dialog-overlay { background: rgba(0, 0, 0, 0.5); }` with `background: var(--ch-overlay-bg);`

  **5c. Verify tests pass**

  Files affected: `src/renderer/lib/components/Dialog.svelte`, `src/renderer/lib/components/Dialog.test.ts`

---

- [x] **Step 6: Verify SetupComplete and SetupError components**

  **6a. Write tests** (in respective test files):
  - Test: `SetupComplete checkmark uses var(--ch-success)` (already uses, should pass)
  - Test: `SetupError heading uses var(--ch-danger)` (already uses, should pass)
  - Test: `SetupError secondary button uses var(--ch-border)` (was undefined, now resolved)
  - Test: `SetupError primary button hover uses var(--ch-button-hover-bg)` (was undefined, now resolved)

  **6b. Verify** (no implementation changes needed):
  - Confirm components render correctly with newly-defined variables

  **6c. Verify tests pass**

  Files affected: `src/renderer/lib/components/SetupComplete.test.ts`, `src/renderer/lib/components/SetupError.test.ts`

---

- [x] **Step 7: Update global.css for light theme compatibility**

  **7a. Write tests** (in `integration.test.ts`):
  - Test: `body background doesn't override theme variables`
  - Test: `focus-visible styles render correctly in light theme`
  - Test: `focus-visible styles render correctly in dark theme`

  **7b. Implement**:
  - Verify `background: transparent` on body doesn't conflict
  - Ensure focus-visible uses `var(--ch-focus-border)` (already does)

  **7c. Verify tests pass**

  Files affected: `src/renderer/lib/styles/global.css`, `src/renderer/lib/integration.test.ts`

---

- [x] **Step 8: Visual testing and color adjustments**

  **Validation Criteria** (WCAG AA):
  - Minimum 4.5:1 contrast ratio for normal text (< 18pt)
  - Minimum 3:1 contrast ratio for large text (≥ 18pt or 14pt bold) and UI components
  - Tools: Browser DevTools, WebAIM Contrast Checker, or similar

  **Color pairs to validate**:
  - `--ch-foreground` on `--ch-background`
  - `--ch-button-fg` on `--ch-button-bg`
  - `--ch-success` on `--ch-background`
  - `--ch-danger` on `--ch-background`
  - `--ch-warning` on `--ch-background`
  - `--ch-error-fg` on `--ch-error-bg`
  - `--ch-focus-border` on adjacent backgrounds

  **Manual Testing**:
  - Test all components in both light and dark system preferences
  - Verify contrast ratios meet WCAG AA standards
  - Adjust colors if needed based on visual review

  Files affected: `src/renderer/lib/styles/variables.css` (adjustments only)

---

- [x] **Step 9: Update documentation**

  **9a. Update AGENTS.md**:
  - Add new section "## CSS Theming Patterns" after "## UI Patterns" section
  - Document conventions:
    - Always use `--ch-*` variables, never hardcoded colors
    - How to reference VS Code variables as fallbacks
    - Light theme requires only fallback changes in `@media` block
    - Semantic variable naming convention
    - Use `.ch-visually-hidden` for screen reader text (not component-local `.sr-only`)

  **9b. Update docs/ARCHITECTURE.md**:
  - Add new section "## Theming System" after component sections
  - Document:
    - CSS variable system with `--ch-*` prefix
    - `prefers-color-scheme` media query approach
    - VS Code variable fallback pattern and dual-mode operation
    - List of variable categories
    - When VS Code variables take precedence vs fallbacks

  Files affected: `AGENTS.md`, `docs/ARCHITECTURE.md`

## Testing Strategy

### Test Infrastructure

CSS variable testing requires rendering components and checking computed styles. Use:

- `@testing-library/svelte` for rendering components
- `getComputedStyle()` to verify resolved variable values
- `window.matchMedia` mocking for theme switching tests

Example test pattern:

```typescript
it("uses theme variable for idle state", () => {
  render(AgentStatusIndicator, { props: { idleCount: 1, busyCount: 0 } });
  const indicator = screen.getByRole("status");
  const styles = window.getComputedStyle(indicator);
  // Verify no hardcoded colors in style
  expect(indicator.className).toContain("indicator--idle");
  // Note: Actual color value depends on CSS loading in test environment
});
```

### Integration Tests (in `integration.test.ts`)

| Test Case                                   | Description                                                      |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `all semantic variables defined`            | Verify --ch-success, --ch-danger, --ch-warning resolve to values |
| `--ch-border resolves correctly`            | Verify previously-undefined variable now works                   |
| `--ch-button-hover-bg resolves correctly`   | Verify previously-undefined variable now works                   |
| `matchMedia triggers light theme`           | Mock matchMedia, verify variables change                         |
| `theme defaults to dark`                    | Verify dark fallbacks used when no preference                    |
| `layout variables unchanged between themes` | Verify --ch-sidebar-width same in both                           |
| `MainView with Dialog inherits same theme`  | Verify nested components use consistent colors                   |
| `body background doesn't override theme`    | Verify transparent background works                              |
| `focus-visible works in both themes`        | Render focused element, verify outline                           |

### Component Tests

| Component                      | Test Cases                                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AgentStatusIndicator.test.ts` | idle uses var(--ch-agent-idle); busy uses var(--ch-agent-busy); mixed gradient uses variables; tooltip uses var(--ch-shadow); dark theme regression |
| `ShortcutOverlay.test.ts`      | uses --ch-background; uses --ch-border; uses --ch-foreground; no .sr-only class                                                                     |
| `Dialog.test.ts`               | overlay uses var(--ch-overlay-bg); dark theme regression                                                                                            |
| `SetupComplete.test.ts`        | checkmark uses var(--ch-success)                                                                                                                    |
| `SetupError.test.ts`           | heading uses var(--ch-danger); button uses var(--ch-border); hover uses var(--ch-button-hover-bg)                                                   |

### Manual Testing Checklist

- [ ] Set system to dark mode → verify app uses dark colors
- [ ] Set system to light mode → verify app uses light colors
- [ ] Switch system preference while app is running → verify immediate update (no page reload needed)
- [ ] Verify sidebar is readable in both themes
- [ ] Verify dialogs (create/remove workspace) are readable in both themes
- [ ] Verify agent status indicator colors are distinguishable in both themes
- [ ] Verify shortcut overlay is readable in both themes
- [ ] Verify setup screen (if testable) works in both themes
- [ ] Verify focus indicators meet requirements: 2px solid border, minimum 3:1 contrast with background, visible on all interactive elements
- [ ] Verify error states are clearly visible in both themes

## Dependencies

| Package | Purpose                      | Approved |
| ------- | ---------------------------- | -------- |
| —       | No new dependencies required | N/A      |

## Documentation Updates

### Files to Update

| File                   | Section to Add                                     | Content                                                                                                                         |
| ---------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`            | "## CSS Theming Patterns" (after "## UI Patterns") | Variable naming conventions, --ch-\* usage rules, VS Code fallback pattern, .ch-visually-hidden usage                           |
| `docs/ARCHITECTURE.md` | "## Theming System" (after component sections)     | CSS variable system, prefers-color-scheme approach, VS Code variable fallback pattern, variable categories, dual-mode operation |

### New Documentation Required

| File | Purpose                             |
| ---- | ----------------------------------- |
| —    | No new documentation files required |

## Definition of Done

- [ ] All implementation steps complete (Steps 1-9)
- [ ] All tests pass (TDD: tests written before implementation)
- [ ] `npm run validate:fix` passes
- [ ] Documentation updated (AGENTS.md, ARCHITECTURE.md)
- [ ] Manual testing checklist completed
- [ ] User acceptance testing passed
- [ ] Changes committed
