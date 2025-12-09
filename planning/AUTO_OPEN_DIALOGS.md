---
status: COMPLETED
last_updated: 2025-12-09
reviewers: [review-ui, review-typescript, review-arch, review-senior, review-testing, review-docs]
---

# AUTO_OPEN_DIALOGS

## Overview

- **Problem**: When the app starts with no projects, users must manually click "Open Project". When a project is opened without workspaces, users must manually click "+" to create one. This adds friction to the onboarding flow.
- **Solution**: Auto-trigger the project picker on app start when no projects exist, and auto-open the create workspace dialog when a project is opened with zero workspaces.
- **Risks**: Minimal - uses existing dialog/picker APIs, just changes trigger timing
- **Alternatives Considered**:
  - Welcome wizard dialog: Rejected - adds complexity, native folder picker is sufficient
  - Re-opening on cancel: Rejected - too aggressive, let user control their flow
  - Using `$effect` for auto-open: Rejected - would re-trigger on every store update; `onMount` is correct for one-time initialization

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      MainView.svelte                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  onMount (one-time initialization):                             │
│    ├─ await listProjects() → setProjects() → setLoaded()        │
│    │                                                             │
│    │   [NEW] After setLoaded():                                 │
│    │   └─ if projects.length === 0 → handleOpenProject()        │
│    │                                                             │
│    └─ setupDomainEvents(api, stores, hooks)                     │
│                                                                  │
│  [MODIFIED] setupDomainEvents with onProjectOpenedHook:         │
│    └─ onProjectOpened(project)                                  │
│        ├─ stores.addProject(project)                            │
│        └─ hooks.onProjectOpenedHook?.(project)                  │
│            └─ if project.workspaces.length === 0                │
│               AND dialogState.value.type === "closed"           │
│                 → openCreateDialog(project.path, null)          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Sequential Auto-Open Flow (Intentional)**:
When starting with no projects, the folder picker auto-opens. If the selected project has no workspaces, the create dialog will auto-open immediately after. This creates a smooth onboarding flow: Open Project → Create First Workspace.

## Implementation Steps

- [x] **Step 1: Refactor MainView initialization to use onMount**
  - Move `listProjects()` and `getAllAgentStatuses()` calls from `$effect` to `onMount`
  - Use `await` for proper sequencing instead of `.then()` chains
  - Add auto-open check after `setLoaded()`: if `projects.length === 0`, call `handleOpenProject()`
  - Files affected: `src/renderer/lib/components/MainView.svelte`
  - Test criteria: Initialization only runs once on mount, not on reactive updates

- [x] **Step 2: Extend setupDomainEvents to accept hooks**
  - Add optional `DomainEventHooks` interface with `onProjectOpenedHook?: (project: Project) => void`
  - Call hook after `stores.addProject(project)` in the `onProjectOpened` handler
  - Files affected: `src/renderer/lib/utils/domain-events.ts`
  - Test criteria: Hook is called when project:opened event fires

- [x] **Step 3: Add auto-open create dialog hook in MainView**
  - Pass `onProjectOpenedHook` to `setupDomainEvents` that checks:
    - `project.workspaces.length === 0`
    - `dialogState.value.type === "closed"` (guard against concurrent dialogs)
  - If both conditions met, call `openCreateDialog(project.path, null)`
  - Files affected: `src/renderer/lib/components/MainView.svelte`
  - Test criteria: Create dialog opens when project has no workspaces

- [x] **Step 4: Update unit tests for MainView**
  - Test: auto-opens project picker on mount when projects array is empty
  - Test: does NOT auto-open picker when projects exist
  - Test: auto-opens create dialog when project:opened has no workspaces
  - Test: does NOT auto-open dialog when project has workspaces
  - Test: does NOT auto-open dialog when another dialog is already open
  - Files affected: `src/renderer/lib/components/MainView.test.ts`
  - Test criteria: All auto-open scenarios covered

- [x] **Step 5: Update unit tests for domain-events**
  - Test: hook is called after addProject when provided
  - Test: hook is not called when not provided (backward compatible)
  - Files affected: `src/renderer/lib/utils/domain-events.test.ts` (new file)
  - Test criteria: Hook mechanism works correctly

- [x] **Step 6: Add integration test for onboarding flow**
  - Test complete sequence: empty state → auto-open picker → select folder → project opened with 0 workspaces → auto-open create dialog
  - Files affected: `src/renderer/lib/integration.test.ts`
  - Test criteria: Full onboarding flow works end-to-end

- [x] **Step 7: Update USER_INTERFACE.md documentation**
  - Update "First Launch" section to document auto-open picker behavior
  - Update "Opening a Project" section to document auto-open create dialog behavior
  - Files affected: `docs/USER_INTERFACE.md`
  - Test criteria: Documentation accurately reflects new behavior

## Testing Strategy

### Unit Tests (vitest)

| Test Case                                             | Description                                                                                        | File                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------- |
| auto-opens project picker on mount when empty         | `expect(api.selectFolder).toHaveBeenCalledOnce()` after mount with `projects=[]`                   | MainView.test.ts      |
| does not auto-open picker when projects exist         | `expect(api.selectFolder).not.toHaveBeenCalled()` when `projects.length > 0`                       | MainView.test.ts      |
| returns to EmptyState when picker cancelled           | Verify EmptyState shown after `selectFolder` returns `null`                                        | MainView.test.ts      |
| auto-opens create dialog for empty project            | `expect(openCreateDialog).toHaveBeenCalledWith(project.path, null)` when `workspaces.length === 0` | MainView.test.ts      |
| does not auto-open dialog when project has workspaces | `expect(openCreateDialog).not.toHaveBeenCalled()` when `workspaces.length > 0`                     | MainView.test.ts      |
| does not auto-open dialog when dialog already open    | Guard check prevents concurrent dialogs                                                            | MainView.test.ts      |
| handles rapid project:opened events                   | Only one dialog opens for multiple rapid events                                                    | MainView.test.ts      |
| hook called after addProject                          | Verifies hook mechanism in setupDomainEvents                                                       | domain-events.test.ts |
| hook optional (backward compatible)                   | setupDomainEvents works without hooks                                                              | domain-events.test.ts |

### Integration Tests

| Test Case                | Description                                           | File                |
| ------------------------ | ----------------------------------------------------- | ------------------- |
| complete onboarding flow | Empty → picker → select empty project → create dialog | integration.test.ts |

### Manual Testing Checklist

- [ ] Start app with no persisted projects → folder picker opens automatically
- [ ] Cancel folder picker → EmptyState shown, can click "Open Project" manually
- [ ] Quickly click "Open Project" before auto-open triggers → only one picker opens (no race)
- [ ] Open a project that has no worktrees → create workspace dialog opens automatically
- [ ] Cancel create dialog → project shown in sidebar without workspaces
- [ ] Open a project that already has worktrees → no dialog, workspaces shown normally
- [ ] Restart app with existing projects → no auto-open picker, normal startup
- [ ] Full flow: no projects → auto picker → select empty project → auto create dialog

## Dependencies

None - uses existing APIs only.

## Documentation Updates

### Files to Update

| File                   | Changes Required                                                           |
| ---------------------- | -------------------------------------------------------------------------- |
| docs/USER_INTERFACE.md | Add auto-open behaviors to "First Launch" and "Opening a Project" sections |

### New Documentation Required

None.

## Definition of Done

- [ ] All implementation steps complete
- [ ] `npm run validate:fix` passes
- [ ] Documentation updated
- [ ] User acceptance testing passed
- [ ] Changes committed
