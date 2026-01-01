<section class="features">
  <div class="container">
    <div class="feature-grid">
      <div class="feature-card">
        <h3><span class="feature-icon">🔀</span> Parallel Workspaces</h3>
        <p>Run multiple AI agents simultaneously, each in its own isolated workspace</p>
      </div>
      <div class="feature-card">
        <h3><span class="feature-icon">🌿</span> Git Worktrees</h3>
        <p>Each workspace is a git worktree — lightweight, isolated, shares history</p>
      </div>
      <div class="feature-card">
        <h3><span class="feature-icon">📊</span> Real-time Status</h3>
        <p>Monitor agent status (idle/busy/waiting) with visual indicators and app badge</p>
      </div>
      <div class="feature-card">
        <h3><span class="feature-icon">⌨️</span> Keyboard Driven</h3>
        <p>Alt+X shortcut mode for lightning-fast workspace navigation</p>
      </div>
      <div class="feature-card">
        <h3><span class="feature-icon">💻</span> VS Code Powered</h3>
        <p>Full code-server integration with extensions, themes, and settings</p>
      </div>
      <div class="feature-card">
        <h3><span class="feature-icon">🎙️</span> Voice Dictation</h3>
        <p>Built-in speech-to-text extension for hands-free coding</p>
      </div>
    </div>
    <div class="platform-row">
      <span class="platform-badge">
        <img src="/linux.svg" alt="" class="platform-icon" aria-hidden="true" />
        Linux
      </span>
      <span class="platform-badge">
        <img src="/windows.svg" alt="" class="platform-icon" aria-hidden="true" />
        Windows
      </span>
    </div>
  </div>
</section>

<style>
  .features {
    background: var(--site-bg-primary);
  }

  .feature-icon {
    font-size: 1.25rem;
  }

  .platform-row {
    display: flex;
    justify-content: center;
    gap: 1.5rem;
    margin-top: 2rem;
    padding-top: 2rem;
    border-top: 1px solid var(--site-border);
  }

  .platform-badge {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--site-text-secondary);
    font-size: 1rem;
  }

  .platform-icon {
    width: 24px;
    height: 24px;
    filter: invert(1);
  }
</style>
