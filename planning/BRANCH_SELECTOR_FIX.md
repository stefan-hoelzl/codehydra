---
status: COMPLETED
last_updated: 2025-12-10
reviewers:
  - review-ui
  - review-typescript
  - review-electron
  - review-arch
  - review-senior
  - review-testing
  - review-docs
---

# BRANCH_SELECTOR_FIX

## Overview

- **Problem**: The BranchDropdown component in CreateWorkspaceDialog has two bugs:
  1. **Click selection broken**: Clicking on a dropdown option doesn't select it - only keyboard navigation (Arrow keys + Enter) works
  2. **Dropdown overflow clipped**: The dropdown list is clipped by the Dialog's `overflow-y: auto`, causing a scrollbar to appear in the dialog instead of the dropdown showing its full list

- **Solution**:
  1. Handle selection directly in `onmousedown` with `preventDefault()` - this prevents blur and selects in one handler
  2. Change dropdown to `position: fixed` with dynamically calculated coordinates to escape the dialog's overflow clipping
  3. Remove redundant `onkeydown` handlers from list items (input already handles keyboard)

- **Risks**:
  - `position: fixed` requires calculating screen coordinates, adding complexity
  - Fixed positioning needs to handle window resize and scroll events
  - Low-medium risk - more complex than originally planned but more robust

- **Alternatives Considered**:
  1. **`overflow: visible` on dialog-content**: Rejected - doesn't work because `.dialog` parent has `overflow-y: auto` which still clips absolutely-positioned descendants
  2. **Portal-based dropdown**: Similar to our solution but requires Svelte portal library - we achieve the same with `position: fixed`
  3. **Delay blur handling**: `setTimeout` to delay closing. Rejected - creates race conditions
  4. **Constrain dropdown to dialog**: Keep dropdown inside dialog with scroll. Rejected - poor UX for long branch lists

## Architecture

```
Before (broken):
  Dialog (overflow-y: auto) ◄── clips all descendants
    └─ dialog-content
       └─ BranchDropdown
          ├─ input
          └─ listbox (position: absolute) ◄── gets clipped!

After (fixed):
  Dialog (overflow-y: auto)
    └─ dialog-content
       └─ BranchDropdown
          ├─ input ◄── reference for positioning
          └─ listbox (position: fixed) ◄── escapes clipping context
```

**Key insight**: `position: fixed` positions relative to the viewport, completely escaping any ancestor's overflow clipping.

## Root Cause Analysis

### Issue 1: Click Selection Broken

**Event sequence when clicking an option:**

```
1. mousedown on <li>     → input blur fires (dropdown closes!)
2. mouseup on <li>       → (dropdown already gone)
3. click on <li>         → fires on closed dropdown (no effect)
```

This occurs because `mousedown` fires before `click` in the browser's event model, and blur is triggered during the mousedown phase.

**Fix**: Handle selection directly in `mousedown` with `preventDefault()`:

```
1. mousedown on <li>     → preventDefault() stops blur, selectBranch() called
2. (dropdown already closed by selectBranch)
```

### Issue 2: Dropdown Overflow Clipped

**Current CSS chain:**

```css
.dialog {
  overflow-y: auto;
  max-height: 90vh;
} /* CLIPS all descendants */
.dialog-content {
  /* inherits clipping from parent */
}
.branch-listbox {
  position: absolute;
  z-index: 100;
} /* Still clipped! */
```

`position: absolute` only escapes the immediate positioned ancestor, but `overflow: auto/hidden/scroll` on ANY ancestor creates a clipping context.

**Fix**: Use `position: fixed` which positions relative to the viewport, completely bypassing all ancestor overflow contexts.

## Implementation Steps

### Phase 1: Click Selection Fix (TDD)

- [x] **Step 1: Write failing test for mousedown selection**
  - Add test that verifies `onmousedown` prevents default and selects the branch
  - Files affected: `src/renderer/lib/components/BranchDropdown.test.ts`
  - Test criteria: Test fails (mousedown handler doesn't exist yet)

- [x] **Step 2: Implement mousedown handler with selection**
  - Replace `onclick` with `onmousedown` handler that calls `preventDefault()` and `selectBranch()`
  - Use inline arrow function: `onmousedown={(e: MouseEvent) => { e.preventDefault(); selectBranch(branch.name); }}`
  - Remove redundant `onkeydown` handlers from `<li>` elements (input already handles keyboard via `handleKeyDown`)
  - Files affected: `src/renderer/lib/components/BranchDropdown.svelte`
  - Test criteria: New test passes, existing click test still passes

- [x] **Step 3: Add explanatory comment to existing click test**
  - Add comment above "clicking an option selects it" test in the "selection" describe block
  - Explain that `fireEvent.click()` doesn't replicate browser's blur-before-click timing
  - Files affected: `src/renderer/lib/components/BranchDropdown.test.ts`
  - Test criteria: Comment clearly explains the mousedown pattern

### Phase 2: Overflow Fix (TDD)

- [x] **Step 4: Write failing test for fixed positioning**
  - Add test that verifies `.branch-listbox` has `position: fixed` when open
  - Files affected: `src/renderer/lib/components/BranchDropdown.test.ts`
  - Test criteria: Test fails (still using `position: absolute`)

- [x] **Step 5: Implement fixed positioning for dropdown**
  - Add `inputRef` to track the input element for position calculation
  - Add `dropdownPosition` state to store calculated `{ top, left, width }` coordinates
  - Calculate position using `inputRef.getBoundingClientRect()` when dropdown opens
  - Change `.branch-listbox` to `position: fixed` with dynamic `top`, `left`, `width` styles
  - Files affected: `src/renderer/lib/components/BranchDropdown.svelte`
  - Test criteria: Dropdown appears at correct position, escapes dialog clipping

- [x] **Step 6: Add window resize handler**
  - Recalculate dropdown position on window resize while open
  - Clean up resize listener when dropdown closes or component unmounts
  - Files affected: `src/renderer/lib/components/BranchDropdown.svelte`
  - Test criteria: Dropdown repositions correctly on window resize

### Phase 3: Cleanup & Documentation

- [x] **Step 7: Verify RemoveWorkspaceDialog still works**
  - Visual verification that RemoveWorkspaceDialog displays correctly
  - No code changes expected
  - Test criteria: Dialog renders normally, no visual regressions

- [x] **Step 8: Document mousedown pattern in AGENTS.md**
  - Add "UI Patterns" section if not exists
  - Document the blur-prevention mousedown pattern for future dropdown components
  - Files affected: `AGENTS.md`
  - Test criteria: Pattern is documented with explanation and example

## Testing Strategy

### Unit Tests (vitest)

| Test Case                                         | Description                                                   | File                             |
| ------------------------------------------------- | ------------------------------------------------------------- | -------------------------------- |
| mousedown on option prevents blur and selects     | Verify mousedown handler calls preventDefault and onSelect    | BranchDropdown.test.ts (new)     |
| selecting an option via mousedown works correctly | Renamed test with explanatory comment about mousedown pattern | BranchDropdown.test.ts (renamed) |
| dropdown uses fixed positioning when open         | Verify computed style is position: fixed                      | BranchDropdown.test.ts (new)     |
| dropdown position updates on window resize        | Verify position recalculates                                  | BranchDropdown.test.ts (new)     |

### Integration Tests

| Test Case                                            | Description                                         | File                          |
| ---------------------------------------------------- | --------------------------------------------------- | ----------------------------- |
| branch dropdown click selection works within dialog  | Full CreateWorkspaceDialog mousedown selection test | CreateWorkspaceDialog.test.ts |
| branch dropdown is visible and not clipped by dialog | Verify fixed positioning styles in dialog context   | CreateWorkspaceDialog.test.ts |

### Manual Testing Checklist

- [ ] Open CreateWorkspaceDialog
- [ ] Focus the branch dropdown input
- [ ] Click on a branch option with the mouse
- [ ] Verify the option is selected (appears in input)
- [ ] Verify the dropdown closes after selection
- [ ] Verify the full dropdown list is visible (no scrollbar in dialog)
- [ ] Verify dropdown extends below dialog bounds if needed
- [ ] Verify keyboard navigation (Arrow keys + Enter) still works
- [ ] Verify typing to filter still works
- [ ] Test with both local and remote branches
- [ ] Resize window while dropdown is open - verify it repositions correctly
- [ ] Open RemoveWorkspaceDialog - verify it displays normally (regression check)
- [ ] Test dialog with very long content (>90vh) to verify scrolling still works

## Dependencies

None - this fix uses only existing browser APIs and CSS.

## Documentation Updates

### Files to Update

| File      | Changes Required                                                 |
| --------- | ---------------------------------------------------------------- |
| AGENTS.md | Add "UI Patterns" section with mousedown blur-prevention pattern |

### New Documentation Required

None required.

## Definition of Done

- [ ] All implementation steps complete
- [ ] All new tests pass
- [ ] `npm run validate:fix` passes
- [ ] AGENTS.md updated with mousedown pattern
- [ ] User acceptance testing passed
- [ ] Changes committed
