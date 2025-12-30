<!--
  WorkspaceLoadingOverlay.svelte
  
  Loading overlay shown while a workspace is initializing.
  Displays a progress ring and message while waiting for the
  OpenCode client to attach or the 10-second timeout.
  
  Uses the same positioning as DeletionProgressView to cover
  the workspace area while keeping the sidebar visible.
-->
<script lang="ts">
  // No props needed - this is a pure UI component
</script>

<div class="loading-overlay" role="status" aria-live="polite">
  <div class="loading-content">
    <vscode-progress-ring class="spinner"></vscode-progress-ring>
    <span class="loading-message">Loading workspace...</span>
  </div>
</div>

<style>
  .loading-overlay {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: var(--ch-sidebar-minimized-width, 20px);
    background: var(--ch-background);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 0;
    animation: fadeIn 150ms ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .loading-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .spinner {
    width: 32px;
    height: 32px;
  }

  .loading-message {
    font-size: 14px;
    color: var(--ch-foreground);
    opacity: 0.8;
  }

  @media (prefers-reduced-motion: reduce) {
    .loading-overlay {
      animation: none;
    }
  }
</style>
