<script lang="ts">
  /**
   * Setup screen component displayed during first-run setup.
   * Shows a static message with an indeterminate progress bar.
   */
  import Logo from "./Logo.svelte";
</script>

<div class="setup-screen">
  <Logo animated={true} />
  <h1>Setting up CodeHydra</h1>
  <p class="step-message" aria-live="polite">This is only required on first startup.</p>
  <vscode-progress-bar class="progress-bar" indeterminate={true} aria-label="Setting up CodeHydra"
  ></vscode-progress-bar>
</div>

<style>
  .setup-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  h1 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 500;
  }

  .step-message {
    margin: 0;
    font-size: 0.875rem;
    opacity: 0.8;
  }

  .progress-bar {
    width: 250px;
  }
</style>
