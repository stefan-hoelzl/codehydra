---
status: COMPLETED
last_updated: 2025-12-28
reviewers: [review-ui, review-docs]
---

# CODICONS_MIGRATION

## Overview

- **Problem**: The codebase uses inconsistent Unicode characters and HTML entities for icons (⚠, ✓, ✗, ×, +, ▸) instead of the already-installed `@vscode/codicons` package. This leads to visual inconsistency and potential accessibility issues.
- **Solution**: Create a reusable `Icon` component wrapping `<vscode-icon>` and migrate all custom icons to codicons for consistent VS Code-style iconography.
- **Risks**:
  - Font loading issues in Electron (mitigated by proper CSS setup with timing considerations)
  - Visual differences from current Unicode icons (mitigated by careful size/color matching and verification)
- **Alternatives Considered**:
  - Direct `<vscode-icon>` usage without wrapper - rejected for consistency and easier testing
  - SVG icons - rejected because codicons are already available and match VS Code style
  - Keep Unicode icons - rejected due to inconsistency and accessibility concerns

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Renderer Process                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  vscode-elements-setup.ts (MODIFIED)                            │
│  ├─ Import codicon.css URL using Vite's ?url suffix             │
│  ├─ Create <link id="vscode-codicon-stylesheet"> dynamically    │
│  └─ Append to document.head BEFORE vscode-elements import       │
│                                                                  │
│  Icon.svelte (NEW)                                               │
│  ├─ Wraps <vscode-icon> from @vscode-elements/elements          │
│  ├─ Props: name, size?, label?, action?, spin?, class?          │
│  ├─ Decorative by default (aria-hidden="true")                  │
│  └─ Semantic when label provided (removes aria-hidden)          │
│                                                                  │
│  Components using icons:                                         │
│  ├─ Sidebar.svelte (chevron, add, close, warning)               │
│  ├─ DeletionProgressView.svelte (check, close, circle, warning) │
│  ├─ RemoveWorkspaceDialog.svelte (warning)                      │
│  ├─ SetupComplete.svelte (check)                                │
│  └─ CloseProjectDialog.svelte (warning - restructured)          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

Data flow:
┌──────────────┐     ┌──────────────┐     ┌─────────────────┐
│ @vscode/     │────▶│ vscode-      │────▶│ Icon.svelte     │
│ codicons     │ CSS │ elements     │ Web │ (wrapper)       │
│ (font+css)   │     │ <vscode-icon>│ Cmp │                 │
└──────────────┘     └──────────────┘     └─────────────────┘
```

## Icon Size Constants

Define standard sizes for consistency across the application:

| Constant            | Value | Usage                                     |
| ------------------- | ----- | ----------------------------------------- |
| `ICON_SIZE_SMALL`   | 12px  | Compact indicators (chevrons)             |
| `ICON_SIZE_DEFAULT` | 16px  | Default size, matches vscode-icon default |
| `ICON_SIZE_MEDIUM`  | 14px  | Action buttons in lists                   |
| `ICON_SIZE_LARGE`   | 48px  | Hero/success states                       |

These will be defined as CSS custom properties in `variables.css` for use across components.

## Implementation Steps

- [x] **Step 1: Setup codicons stylesheet loading**
  - Modify `src/renderer/lib/vscode-elements-setup.ts` to dynamically create the codicon stylesheet link
  - Add at the TOP of the file, BEFORE the `@vscode-elements/elements` import:

    ```typescript
    // Import codicon CSS URL (Vite resolves this to the bundled asset path)
    import codiconCssUrl from "@vscode/codicons/dist/codicon.css?url";

    // Create stylesheet link required by vscode-icon component
    // Must be created before vscode-elements are used
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.id = "vscode-codicon-stylesheet";
    link.href = codiconCssUrl;
    document.head.appendChild(link);
    ```

  - Then import vscode-elements as before
  - Files affected: `src/renderer/lib/vscode-elements-setup.ts`
  - Test criteria:
    - Browser DevTools shows `<link id="vscode-codicon-stylesheet">` in `<head>`
    - `<vscode-icon name="check">` displays visible checkmark glyph
    - No font loading errors in console
    - Computed font-family includes 'codicon'

- [x] **Step 2: Add icon size CSS variables**
  - Add to `src/renderer/lib/styles/variables.css`:
    ```css
    --ch-icon-size-small: 12px;
    --ch-icon-size-default: 16px;
    --ch-icon-size-medium: 14px;
    --ch-icon-size-large: 48px;
    ```
  - Files affected: `src/renderer/lib/styles/variables.css`
  - Test criteria: Variables available in browser DevTools computed styles

- [x] **Step 3: Create Icon component**
  - Create `src/renderer/lib/components/Icon.svelte`
  - Wraps `<vscode-icon>` from @vscode-elements/elements (already imported globally via vscode-elements-setup.ts)
  - Full Svelte 5 implementation:

    ```svelte
    <script lang="ts">
      interface IconProps {
        /** Codicon name (e.g., "check", "warning", "close") */
        name: string;
        /** Icon size in pixels (default 16, matches vscode-icon default) */
        size?: number;
        /** Accessibility label - makes icon semantic (announced by screen readers) */
        label?: string;
        /** Makes icon behave like a button with hover/focus states */
        action?: boolean;
        /** Enables rotation animation */
        spin?: boolean;
        /** Additional CSS classes */
        class?: string;
      }

      let {
        name,
        size = 16,
        label,
        action = false,
        spin = false,
        class: className = "",
      }: IconProps = $props();

      // Decorative icons (no label) should be hidden from screen readers
      // Action icons with labels are semantic and should be announced
      const isDecorative = $derived(!label);
    </script>

    <vscode-icon
      {name}
      {size}
      {spin}
      action-icon={action || undefined}
      label={action ? label : undefined}
      class={className}
      aria-hidden={isDecorative ? "true" : undefined}
    ></vscode-icon>
    ```

  - Key behaviors:
    - **Decorative by default**: Icons without `label` have `aria-hidden="true"`
    - **Semantic with label**: Icons with `label` are announced by screen readers
    - **Action mode**: Setting `action={true}` enables button-like behavior (hover/focus states, keyboard accessible via vscode-icon internal button)
    - **Class forwarding**: `class` prop passes through to vscode-icon element
    - **Color inheritance**: Icons use `currentColor` - set color via CSS on parent or Icon
  - Files affected: `src/renderer/lib/components/Icon.svelte` (new)
  - Test criteria: Component renders codicons with correct props and accessibility attributes

- [x] **Step 4: Create Icon component tests**
  - Create `src/renderer/lib/components/Icon.test.ts`
  - Test cases:
    - Renders vscode-icon with required name prop
    - Passes size prop to vscode-icon
    - Default size is 16 when not specified
    - Action mode sets `action-icon` attribute
    - Action mode with label sets both `action-icon` and `label` attributes
    - Spin mode sets `spin` attribute
    - Additional classes are applied via class prop
    - Decorative icons (no label) have `aria-hidden="true"`
    - Semantic icons (with label) do NOT have `aria-hidden`
  - Files affected: `src/renderer/lib/components/Icon.test.ts` (new)
  - Test criteria: All test cases pass

- [x] **Step 5: Migrate Sidebar.svelte icons**
  - **Pattern**: Keep native `<button>` elements, put `<Icon>` inside them
    - Native buttons provide the click target and existing hover styles
    - Icon component provides the visual glyph
  - Replacements:
    - `&#9656;` (▸) chevron → `<Icon name="chevron-right" size={12} />`
    - `+` in add button → `<Icon name="add" size={14} />`
    - `&times;` in close buttons → `<Icon name="close" size={14} />`
    - `⚠` deletion error → `<Icon name="warning" size={14} />`
  - Update `.action-btn` CSS to center icon content
  - Verification:
    - Compare icon sizes to original characters using DevTools
    - Ensure color inherits from button text color
    - Test hover/focus states still work
  - Files affected: `src/renderer/lib/components/Sidebar.svelte`
  - Test criteria: Visual appearance matches original, buttons remain clickable with proper states

- [x] **Step 6: Migrate DeletionProgressView.svelte icons**
  - Replace `getStatusIcon()` function to return icon names:
    ```typescript
    function getStatusIconName(status: DeletionOperationStatus): string | null {
      switch (status) {
        case "done":
          return "check";
        case "error":
          return "close";
        case "pending":
          return "circle-large"; // or "circle" - verify visually
        default:
          return null;
      }
    }
    ```
  - Update template to use Icon component:
    ```svelte
    {#if operation.status === "in-progress"}
      <vscode-progress-ring class="spinner"></vscode-progress-ring>
    {:else}
      {@const iconName = getStatusIconName(operation.status)}
      {#if iconName}
        <Icon name={iconName} />
      {/if}
    {/if}
    ```
  - Replace `&#9888;` (⚠) error box icon → `<Icon name="warning" />`
  - Verification:
    - Confirm `circle-large` matches original ○ appearance (if not, try `circle`)
    - Ensure status colors apply correctly via `.status-done`, `.status-error` CSS
  - Files affected: `src/renderer/lib/components/DeletionProgressView.svelte`
  - Test criteria: Status indicators display with correct icons and colors

- [x] **Step 7: Migrate RemoveWorkspaceDialog.svelte icons**
  - Replace `⚠` warning icon → `<Icon name="warning" />`
  - Update `.warning-icon` CSS if needed for alignment
  - Verification: Warning icon aligns properly with text in warning box
  - Files affected: `src/renderer/lib/components/RemoveWorkspaceDialog.svelte`
  - Test criteria: Warning box displays correctly with icon

- [x] **Step 8: Migrate SetupComplete.svelte icons**
  - Replace `&#10003;` (✓) checkmark → `<Icon name="check" size={48} />`
  - Update `.checkmark` CSS for icon styling (may need to adjust margins)
  - Verification: Large checkmark displays at correct size with green color
  - Files affected: `src/renderer/lib/components/SetupComplete.svelte`
  - Test criteria: Success checkmark displays at 48px with `--ch-success` color

- [x] **Step 9: Restructure CloseProjectDialog.svelte error display**
  - Current code embeds `⚠` in template string (line 71):
    ```typescript
    submitError = `⚠ Removed ${successCount} of ${results.length}...`;
    ```
  - **Decision**: Restructure to separate icon from text (icons can't render in strings)
  - New approach:
    ```svelte
    {#if submitError}
      <div class="error-message" role="alert">
        <Icon name="warning" />
        <span>{submitError}</span>
      </div>
    {/if}
    ```
  - Update the error assignment to remove the emoji:
    ```typescript
    submitError = `Removed ${successCount} of ${results.length}...`;
    ```
  - Add CSS for `.error-message` flexbox layout
  - Files affected: `src/renderer/lib/components/CloseProjectDialog.svelte`
  - Test criteria: Error messages display with icon and text properly aligned

- [x] **Step 10: Update AGENTS.md with codicon guidance**
  - Add new "Icon Usage" section after "VSCode Elements Patterns":

    ````markdown
    ## Icon Usage

    Use the `Icon` component for all icons. Never use Unicode characters or HTML entities.

    ### Icon Component API

    | Prop     | Type    | Default    | Description                               |
    | -------- | ------- | ---------- | ----------------------------------------- |
    | `name`   | string  | (required) | Codicon name                              |
    | `size`   | number  | 16         | Size in pixels                            |
    | `label`  | string  | undefined  | Screen reader label (makes icon semantic) |
    | `action` | boolean | false      | Button-like behavior with hover/focus     |
    | `spin`   | boolean | false      | Rotation animation                        |
    | `class`  | string  | ""         | Additional CSS classes                    |

    ### Usage Patterns

    ```svelte
    <!-- Decorative icon (hidden from screen readers) -->
    <Icon name="check" />

    <!-- Action icon (button-like, announced by screen readers) -->
    <Icon name="close" action label="Close dialog" />

    <!-- Icon inside native button (for complex click handling) -->
    <button onclick={handleClick} aria-label="Add item">
      <Icon name="add" />
    </button>

    <!-- Colored icon (inherits currentColor) -->
    <span class="success-text">
      <Icon name="check" /> Done
    </span>
    ```
    ````

    ### Common Icons

    | Icon | Name            | Usage                   |
    | ---- | --------------- | ----------------------- |
    | ✓    | `check`         | Success, done, complete |
    | ✗    | `close`         | Error, remove, dismiss  |
    | ⚠    | `warning`       | Warnings, alerts        |
    | +    | `add`           | Add new item            |
    | ›    | `chevron-right` | Expand indicator        |
    | ○    | `circle-large`  | Pending, empty state    |

    Full list: https://microsoft.github.io/vscode-codicons/dist/codicon.html

    ```

    ```

  - Files affected: `AGENTS.md`
  - Test criteria: Documentation is clear and includes all patterns

- [x] **Step 11: Update docs/PATTERNS.md VSCode Elements section**
  - Add Icon component to the VSCode Elements Patterns section
  - Add to component mapping table:
    ```markdown
    | Custom icon spans | `<Icon name="icon-name">` | Never - always use Icon component |
    ```
  - Include brief usage guidance and link to AGENTS.md for full reference
  - Files affected: `docs/PATTERNS.md`
  - Test criteria: Patterns doc reflects new Icon component

- [x] **Step 12: Run validation**
  - Run `npm run validate:fix`
  - Fix any linting or type errors
  - Verify all tests pass
  - Files affected: Multiple
  - Test criteria: `npm run validate:fix` passes

## Testing Strategy

### Integration Tests

Test behavior through component rendering with behavioral mocks.

| #   | Test Case               | Entry Point                                                   | Boundary Mocks | Behavior Verified                            |
| --- | ----------------------- | ------------------------------------------------------------- | -------------- | -------------------------------------------- |
| 1   | Icon renders with name  | `render(Icon, {name: "check"})`                               | None           | `<vscode-icon name="check">` in DOM          |
| 2   | Icon passes size        | `render(Icon, {name: "check", size: 24})`                     | None           | `size="24"` attribute present                |
| 3   | Default size is 16      | `render(Icon, {name: "check"})`                               | None           | `size="16"` attribute present                |
| 4   | Action icon attributes  | `render(Icon, {name: "close", action: true, label: "Close"})` | None           | `action-icon` and `label="Close"` attributes |
| 5   | Spin animation          | `render(Icon, {name: "sync", spin: true})`                    | None           | `spin` attribute present                     |
| 6   | Class forwarding        | `render(Icon, {name: "check", class: "my-class"})`            | None           | `class="my-class"` on element                |
| 7   | Decorative aria-hidden  | `render(Icon, {name: "check"})`                               | None           | `aria-hidden="true"` present                 |
| 8   | Semantic no aria-hidden | `render(Icon, {name: "check", label: "Success"})`             | None           | `aria-hidden` NOT present                    |

### UI Integration Tests

| #   | Test Case              | Category | Component             | Behavior Verified              |
| --- | ---------------------- | -------- | --------------------- | ------------------------------ |
| 1   | Sidebar action buttons | Pure-UI  | Sidebar               | Icon components inside buttons |
| 2   | Deletion status icons  | Pure-UI  | DeletionProgressView  | Correct icons for each status  |
| 3   | Warning dialog icon    | Pure-UI  | RemoveWorkspaceDialog | Warning icon in alert box      |

### Manual Testing Checklist

- [ ] Sidebar expand chevron visible and correctly oriented (points right)
- [ ] Add workspace button shows + icon, clickable with hover state
- [ ] Close project/workspace buttons show × icon, clickable with hover state
- [ ] Deletion progress shows ✓ for done, ✗ for error, ○ for pending
- [ ] Warning boxes show ⚠ icon aligned with text
- [ ] Setup complete shows large green checkmark (48px)
- [ ] CloseProjectDialog error shows warning icon separate from text
- [ ] Icons scale correctly at different zoom levels
- [ ] Icons inherit correct colors from CSS variables (check, error colors)
- [ ] Action icons have visible focus states (keyboard navigation)
- [ ] Screen reader announces action icon labels (test with VoiceOver/NVDA)
- [ ] No font loading flash (icons don't appear as boxes then change)

## Dependencies

| Package          | Purpose                                        | Approved |
| ---------------- | ---------------------------------------------- | -------- |
| @vscode/codicons | Already installed - provides icon font and CSS | [x]      |

**Note**: No new dependencies required. `@vscode/codicons` is already in package.json.

## Documentation Updates

### Files to Update

| File             | Changes Required                                             |
| ---------------- | ------------------------------------------------------------ |
| AGENTS.md        | Add "Icon Usage" section with component API and common icons |
| docs/PATTERNS.md | Add Icon to VSCode Elements Patterns section                 |

### New Documentation Required

| File | Purpose                                |
| ---- | -------------------------------------- |
| None | Icon component documented in AGENTS.md |

## Definition of Done

- [x] All implementation steps complete
- [x] `npm run validate:fix` passes
- [x] Documentation updated (AGENTS.md and PATTERNS.md)
- [ ] User acceptance testing passed
- [ ] Changes committed

## Notes

### Out-of-Scope Bug Fix: MainView.test.ts

During implementation, a pre-existing test failure was discovered in `MainView.test.ts`. The `switchToProject` mock factory call was missing the required `skipSwitch` argument. This was fixed by adding `skipSwitch: false` to the mock setup. This fix was necessary to make the test suite pass but was unrelated to the codicons migration itself.
