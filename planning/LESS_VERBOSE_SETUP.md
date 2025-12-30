---
status: COMPLETED
last_updated: 2025-12-30
reviewers: [review-ui, review-typescript, review-arch, review-testing, review-docs]
---

# LESS_VERBOSE_SETUP

## Overview

- **Problem**: The current setup screen shows verbose, changing progress messages that provide unnecessary detail. Additionally, the layout uses `display: contents` which centers each element individually rather than centering the whole content group as a unit.
- **Solution**: Simplify the setup UI to show a single static message with an indeterminate loading bar, fix centering to group all elements together, and remove all unused progress-tracking code.
- **Risks**: None - this is a pure UI simplification with no behavioral changes.
- **Alternatives Considered**:
  - Remove all intermediate screens (rejected - success/error feedback is valuable)
  - Keep progress messages but simplify them (rejected - user wants fully static message)

## Architecture

No architecture changes. This is a UI-only simplification with dead code removal.

```
Current Flow:
┌─────────────┐    ┌─────────────────────────┐    ┌──────────────┐    ┌─────────┐
│ Initializing│───►│ Progress (changing msg) │───►│ Complete     │───►│ Ready   │
│ "Loading..."│    │ "Installing X..."       │    │ ✓ Setup done │    │ MainView│
└─────────────┘    │ "Configuring Y..."      │    └──────────────┘    └─────────┘
                   └─────────────────────────┘
                              │
                              ▼ (on error)
                   ┌─────────────────────────┐
                   │ Error                   │
                   │ Retry / Quit            │
                   └─────────────────────────┘

Simplified Flow:
┌─────────────────────────────┐    ┌──────────────┐    ┌─────────┐
│ Setup Screen (static)       │───►│ Complete     │───►│ Ready   │
│ "Setting up CodeHydra"      │    │ ✓ Setup done │    │ MainView│
│ "Only required on first run"│    └──────────────┘    └─────────┘
└─────────────────────────────┘
              │
              ▼ (on error)
   ┌─────────────────────────┐
   │ Error                   │
   │ Retry / Quit            │
   └─────────────────────────┘
```

## UI Design

```
┌────────────────────────────────────────┐
│                                        │
│                                        │
│              ┌────────────────┐        │
│              │    [Logo]      │        │
│              │                │        │
│              │ Setting up     │        │
│              │  CodeHydra     │        │
│              │                │        │
│              │ This is only   │        │
│              │ required on    │        │
│              │ first startup. │        │
│              │                │        │
│              │ ══════════════ │        │
│              └────────────────┘        │
│                 ▲                      │
│                 │                      │
│         Whole group centered           │
│                                        │
└────────────────────────────────────────┘
```

### User Interactions

- None - the setup screen is passive (no user interaction until error or completion)

## Implementation Steps

- [x] **Step 1: Simplify SetupScreen component**
  - Remove `currentStep` prop and `Props` interface (no props needed)
  - Remove `$props()` destructuring
  - Change heading from "Setting up VSCode..." to "Setting up CodeHydra"
  - Replace dynamic `{currentStep}` paragraph with static text: "This is only required on first startup."
  - Keep `aria-live="polite"` on the paragraph for screen reader announcement on mount
  - Update aria-label on progress bar to "Setting up CodeHydra"
  - Fix centering: change from `display: contents` to `display: flex; flex-direction: column; align-items: center`
  - Remove child element margins (logo margin-bottom) and use flex `gap` instead for consistent spacing
  - Files affected: `src/renderer/lib/components/SetupScreen.svelte`
  - Test criteria: Component renders without props, shows correct static text, content is centered as a group

- [x] **Step 2: Update App.svelte - remove currentStep and progress subscription**
  - Remove `currentStep` prop from both `<SetupScreen>` usages (lines 197 and 212)
  - Remove `getCurrentStepMessage()` helper function entirely
  - Remove the `setup:progress` event subscription `$effect` block (lines 97-106) - no longer needed
  - Remove `updateProgress` from the setup store imports
  - Files affected: `src/renderer/App.svelte`
  - Test criteria: App renders setup screen without passing currentStep, no progress subscription exists

- [x] **Step 3: Simplify setup store - remove unused progress state**
  - Remove `progress` type from `SetupStateValue` discriminated union (only keep `loading | complete | error`)
  - Remove `updateProgress()` action function entirely
  - Update any code that checks for `type === "progress"` (should be none after Step 2)
  - Files affected: `src/renderer/lib/stores/setup.svelte.ts`
  - Test criteria: Store only has loading/complete/error states, no updateProgress function

- [x] **Step 4: Fix centering in SetupComplete and SetupError**
  - Apply same centering fix: change `display: contents` to `display: flex; flex-direction: column; align-items: center`
  - Remove child element margins and use flex `gap` for spacing
  - Update SetupError terminology: change "Failed to install VSCode extensions" to "Setup could not be completed" for consistency with CodeHydra branding
  - Files affected: `src/renderer/lib/components/SetupComplete.svelte`, `src/renderer/lib/components/SetupError.svelte`
  - Test criteria: All setup screens center their content as a group

- [x] **Step 5: Update documentation**
  - Update `docs/USER_INTERFACE.md` section "VS Code Setup (First Run Only)":
    - Change heading in mockup from "Setting up VSCode..." to "Setting up CodeHydra"
    - Replace "Installing extensions..." with "This is only required on first startup."
    - Update error screen mockup: "Failed to install VSCode extensions" → "Setup could not be completed"
  - Files affected: `docs/USER_INTERFACE.md`
  - Test criteria: Documentation reflects new static UI text

## Testing Strategy

### UI Integration Tests

| #   | Test Case                               | Category | Component     | Behavior Verified                                    |
| --- | --------------------------------------- | -------- | ------------- | ---------------------------------------------------- |
| 1   | SetupScreen displays static heading     | Pure-UI  | SetupScreen   | Shows "Setting up CodeHydra" heading                 |
| 2   | SetupScreen displays first-startup info | Pure-UI  | SetupScreen   | Shows "This is only required on first startup." text |
| 3   | SetupScreen renders without props       | Pure-UI  | SetupScreen   | Component mounts successfully with no props          |
| 4   | SetupComplete displays success message  | Pure-UI  | SetupComplete | Shows checkmark icon and "Setup complete!" text      |
| 5   | SetupError displays error with buttons  | Pure-UI  | SetupError    | Shows error message, Retry and Quit buttons          |
| 6   | App renders SetupScreen in setup mode   | Pure-UI  | App           | SetupScreen rendered when lifecycle state is "setup" |

### Manual Testing Checklist

- [ ] Start app with fresh app-data (trigger setup)
- [ ] Verify logo + text + progress bar are centered as a group
- [ ] Verify "Setting up CodeHydra" heading is shown
- [ ] Verify "This is only required on first startup." subtitle is shown
- [ ] Verify indeterminate progress bar is shown
- [ ] Verify setup completes and shows success screen (also centered as group)
- [ ] Verify transition to main app works after success screen
- [ ] Verify error screen is centered as group (can test by disconnecting network)
- [ ] Verify error screen shows "Setup could not be completed" message
- [ ] Verify logo, heading, subtitle, and progress bar move as a group when resizing window

## Dependencies

No new dependencies required.

## Documentation Updates

### Files to Update

| File                     | Changes Required                                                       |
| ------------------------ | ---------------------------------------------------------------------- |
| `docs/USER_INTERFACE.md` | Update VS Code Setup section mockups and text to reflect new static UI |

### New Documentation Required

None.

## Definition of Done

- [ ] All implementation steps complete
- [ ] `npm run validate:fix` passes
- [ ] Documentation updated
- [ ] User acceptance testing passed
- [ ] Changes committed
