<section id="quickstart" class="quickstart" tabindex="-1">
  <div class="container">
    <h2>Get Started</h2>
    <div class="code-block">
      <pre><code
          ># Clone the repository
git clone https://github.com/stefanhoelzl/codehydra.git
cd codehydra

# Install dependencies
npm install

# Run in development mode
npm run dev</code
        ></pre>
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
  }

  .code-block pre {
    padding: 1.5rem;
  }

  .code-block code {
    line-height: 1.7;
  }
</style>
