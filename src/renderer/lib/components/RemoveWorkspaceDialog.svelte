<script lang="ts">
  import Dialog from "./Dialog.svelte";
  import { removeWorkspace, isWorkspaceDirty } from "$lib/api";
  import { closeDialog } from "$lib/stores/dialogs.svelte.js";

  interface RemoveWorkspaceDialogProps {
    open: boolean;
    workspacePath: string;
  }

  let { open, workspacePath }: RemoveWorkspaceDialogProps = $props();

  // Form state
  let keepBranch = $state(false);
  let submitError = $state<string | null>(null);
  let isSubmitting = $state(false);
  let isDirty = $state(false);
  let isCheckingDirty = $state(true);

  // Extract workspace name from path
  const workspaceName = $derived(workspacePath.split("/").pop() ?? workspacePath);

  // Check dirty status on mount
  $effect(() => {
    if (!open) return;

    isCheckingDirty = true;
    isDirty = false;

    isWorkspaceDirty(workspacePath)
      .then((dirty) => {
        isDirty = dirty;
      })
      .catch(() => {
        // Assume clean on error
        isDirty = false;
      })
      .finally(() => {
        isCheckingDirty = false;
      });
  });

  // Handle form submission
  async function handleSubmit(): Promise<void> {
    if (isSubmitting) return;

    submitError = null;
    isSubmitting = true;

    try {
      await removeWorkspace(workspacePath, !keepBranch);
      closeDialog();
    } catch (error) {
      submitError = error instanceof Error ? error.message : "Failed to remove workspace";
      isSubmitting = false;
    }
  }

  // Handle cancel
  function handleCancel(): void {
    closeDialog();
  }

  // Handle checkbox change (standard change event from vscode-checkbox)
  function handleCheckboxChange(event: Event): void {
    const target = event.target as HTMLElement & { checked: boolean };
    keepBranch = target.checked;
  }

  // IDs for accessibility
  const titleId = "remove-workspace-title";
  const descriptionId = "remove-workspace-desc";
</script>

<Dialog
  {open}
  onClose={handleCancel}
  busy={isSubmitting}
  {titleId}
  {descriptionId}
  initialFocusSelector="vscode-button"
>
  {#snippet title()}
    <h2 id={titleId}>Remove Workspace</h2>
  {/snippet}

  {#snippet content()}
    <p id={descriptionId}>
      Remove workspace "{workspaceName}"?
    </p>

    {#if isCheckingDirty}
      <div class="status-message" role="status">Checking for uncommitted changes...</div>
    {:else if isDirty}
      <div class="warning-box" role="alert">
        <span class="warning-icon">⚠</span>
        This workspace has uncommitted changes that will be lost.
      </div>
    {/if}

    <div class="checkbox-row">
      <vscode-checkbox
        checked={keepBranch}
        onchange={handleCheckboxChange}
        disabled={isSubmitting}
        label="Keep branch"
      ></vscode-checkbox>
    </div>

    {#if submitError}
      <div class="submit-error" role="alert">
        {submitError}
      </div>
    {/if}
  {/snippet}

  {#snippet actions()}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <vscode-button onclick={handleSubmit} disabled={isSubmitting}>
      {isSubmitting ? "Removing..." : "Remove"}
    </vscode-button>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <vscode-button secondary={true} onclick={handleCancel} disabled={isSubmitting}>
      Cancel
    </vscode-button>
  {/snippet}
</Dialog>

<style>
  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--ch-foreground);
  }

  p {
    margin: 0 0 16px 0;
    font-size: 13px;
    color: var(--ch-foreground);
  }

  .status-message {
    margin-bottom: 16px;
    font-size: 13px;
    color: var(--ch-foreground);
    opacity: 0.8;
  }

  .warning-box {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 16px;
    padding: 10px 12px;
    background: var(--ch-error-bg);
    border-radius: 2px;
    font-size: 13px;
    color: var(--ch-error-fg);
  }

  .warning-icon {
    flex-shrink: 0;
  }

  .checkbox-row {
    margin-bottom: 16px;
  }

  .submit-error {
    margin-bottom: 16px;
    padding: 8px;
    background: var(--ch-error-bg);
    color: var(--ch-error-fg);
    border-radius: 2px;
    font-size: 13px;
  }
</style>
