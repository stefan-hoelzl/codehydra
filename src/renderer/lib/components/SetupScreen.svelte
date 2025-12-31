<script lang="ts">
  /**
   * Setup screen component displayed during first-run setup or service loading.
   * Shows a customizable message with an indeterminate progress bar.
   */
  import Logo from "./Logo.svelte";

  interface Props {
    /** Main heading message (default: "Setting up CodeHydra") */
    message?: string;
    /** Subtitle message (default: "This is only required on first startup.") */
    subtitle?: string;
  }

  let {
    message = "Setting up CodeHydra",
    subtitle = "This is only required on first startup.",
  }: Props = $props();
</script>

<div class="setup-screen">
  <Logo animated={true} />
  <h1>{message}</h1>
  {#if subtitle}
    <p class="step-message" aria-live="polite">{subtitle}</p>
  {/if}
  <vscode-progress-bar class="progress-bar" indeterminate={true} aria-label={message}
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
