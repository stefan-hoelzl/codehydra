<script lang="ts">
  const CODE = `# Clone the repository
git clone https://github.com/stefanhoelzl/codehydra.git
cd codehydra

# Install dependencies
pnpm install

# Run in development mode
pnpm dev`;

  let copied = $state(false);

  async function copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(CODE);
      copied = true;
      setTimeout(() => {
        copied = false;
      }, 2000);
    } catch {
      // Clipboard API not available or permission denied
      // Fail silently - user can manually copy
    }
  }
</script>

<section id="quickstart" class="quickstart" tabindex="-1">
  <div class="container">
    <h2>Get Started</h2>
    <div class="code-block">
      <pre><code>{CODE}</code></pre>
      <button class="copy-button" onclick={copyCode} aria-label="Copy installation code">
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
    <div role="status" aria-live="polite" class="visually-hidden">
      {copied ? "Code copied to clipboard" : ""}
    </div>
  </div>
</section>

<style>
  .quickstart {
    background: var(--site-bg-primary);
  }

  .quickstart:focus {
    outline: none;
  }

  .quickstart h2 {
    text-align: center;
    font-size: 2rem;
    margin: 0 0 2rem 0;
    background: linear-gradient(135deg, var(--site-gradient-start), var(--site-gradient-end));
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .code-block {
    max-width: 700px;
    margin: 0 auto;
    position: relative;
  }

  .code-block pre {
    padding: 1.5rem;
    padding-right: 5rem;
  }

  .code-block code {
    line-height: 1.7;
  }

  .copy-button {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    padding: 0.5rem 1rem;
    background: var(--site-bg-card);
    color: var(--site-text-primary);
    border: 1px solid var(--site-border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    font-family: inherit;
    transition:
      background-color 0.2s,
      border-color 0.2s;
  }

  .copy-button:hover {
    background: var(--site-bg-secondary);
    border-color: var(--site-focus);
  }

  .copy-button:focus-visible {
    outline: 2px solid var(--site-focus);
    outline-offset: 2px;
  }
</style>
