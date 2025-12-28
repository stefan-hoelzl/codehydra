<script lang="ts">
  import Dialog from "./Dialog.svelte";

  interface OpenProjectErrorDialogProps {
    open: boolean;
    errorMessage: string;
    onRetry: () => void;
    onClose: () => void;
  }

  let { open, errorMessage, onRetry, onClose }: OpenProjectErrorDialogProps = $props();

  // IDs for accessibility
  const titleId = "open-project-error-title";
  const descriptionId = "open-project-error-desc";
</script>

<Dialog
  {open}
  {onClose}
  busy={false}
  {titleId}
  {descriptionId}
  initialFocusSelector="vscode-button"
>
  {#snippet title()}
    <h2 id={titleId}>Could Not Open Project</h2>
  {/snippet}

  {#snippet content()}
    <div id={descriptionId} class="error-box" role="alert">
      {errorMessage}
    </div>
  {/snippet}

  {#snippet actions()}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <vscode-button onclick={onRetry}>Select Different Folder</vscode-button>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <vscode-button secondary={true} onclick={onClose}>Cancel</vscode-button>
  {/snippet}
</Dialog>

<style>
  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--ch-foreground);
  }

  .error-box {
    padding: 10px 12px;
    background: var(--ch-error-bg);
    border-radius: 2px;
    font-size: 13px;
    color: var(--ch-error-fg);
  }
</style>
