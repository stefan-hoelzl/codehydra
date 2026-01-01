---
status: APPROVED
last_updated: 2026-01-01
reviewers: [review-ui, review-arch, review-docs]
---

# README_AND_LANDING_PAGE

## Overview

- **Problem**: CodeHydra lacks public-facing documentation - no README.md for GitHub visitors and no landing page for discovery/marketing.
- **Solution**: Create a comprehensive README.md for the repository root and a single-page landing site using Vite + Svelte in `site/`, deployed via GitHub Pages to codehydra.dev.
- **Risks**:
  - Screenshots not yet available (mitigated by placeholder section - intentionally deferred to future iteration)
  - No binary releases yet (mitigated by focusing on developer setup)
- **Alternatives Considered**:
  - Plain HTML/CSS: Rejected - too much manual work for styling
  - Jekyll: Rejected - Ruby dependency, team uses Node.js/Svelte
  - Astro: Rejected - adds another framework when Svelte already available
  - SvelteKit: Rejected - overkill for single page, complex integration
  - **Vite + Svelte: Selected** - reuses existing dependencies, familiar patterns, easy integration

## Architecture

```
Repository Structure
│
├── README.md                        # NEW: Project README
│
├── AGENTS.md                        # MODIFIED: Add site scripts, README/landing page info
│
├── package.json                     # MODIFIED: Add site:dev, site:build, site:preview, site:check
│
├── site/                            # NEW: Landing page source
│   ├── vite.config.ts               # Vite config for landing site
│   ├── svelte.config.ts             # Svelte preprocessing config
│   ├── tsconfig.json                # TypeScript config (extends ../tsconfig.web.json)
│   ├── index.html                   # Entry HTML (with meta tags, favicon)
│   ├── src/
│   │   ├── main.ts                  # Mount point
│   │   ├── App.svelte               # Landing page root
│   │   ├── components/
│   │   │   ├── Header.svelte        # <nav> - Navigation header
│   │   │   ├── Hero.svelte          # <section> - Hero with logo/tagline
│   │   │   ├── Features.svelte      # <section> - Feature grid
│   │   │   ├── Screenshot.svelte    # <section> - Screenshot placeholder
│   │   │   ├── QuickStart.svelte    # <section> - Code block with copy button
│   │   │   └── Footer.svelte        # <footer> - Footer with links
│   │   └── styles/
│   │       └── site.css             # Self-contained CSS variables + styles
│   ├── public/
│   │   ├── logo.png                 # Copy of resources/icon.png (also used as favicon)
│   │   └── CNAME                    # Custom domain: codehydra.dev
│   └── dist/                        # Build output (gitignored via existing dist/ pattern)
│
├── .github/workflows/
│   └── ci.yaml                      # MODIFIED: Add independent pages job
│
├── eslint.config.js                 # EXISTING: Already covers site/** files
├── .prettierrc                      # EXISTING: Already covers site/** files
└── svelte.config.js                 # EXISTING: Root config (site has its own)
```

**Key Design Decisions:**

- **Self-contained CSS**: Site has its own CSS variables, no imports from main app (avoids VS Code-specific variables)
- **CSS over JS**: Smooth scroll via CSS `scroll-behavior`, reduced motion via CSS media query
- **Existing tooling**: ESLint/Prettier configs already apply to `site/**` via glob patterns
- **Semantic HTML**: All components use proper HTML5 semantic elements
- **Accessibility-first**: ARIA labels, skip links, live regions, focus management
- **Custom domain**: codehydra.dev with CNAME file, base path is `/`
- **Favicon**: Uses logo.png (no separate favicon file needed)

**Build & Deploy Flow:**

```
npm run site:build
        │
        ▼
site/dist/                    GitHub Actions (pages job in ci.yaml)
    ├── index.html    ──────────────────────►  GitHub Pages
    ├── assets/                               https://codehydra.dev
    ├── logo.png                              (also: stefanhoelzl.github.io/codehydra/)
    └── CNAME
```

## UI Design

### Landing Page Layout (Mobile-First, Responsive)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              <nav> HEADER                                    │
│  [Skip to content]                                                          │
│  [Logo] CodeHydra                                              [GitHub ↗]   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                         <section> HERO SECTION                              │
│                                                                             │
│                    <img alt="CodeHydra Logo">                               │
│                                                                             │
│                   Multi-Workspace IDE for                                   │
│                  Parallel AI Agent Development                              │
│                                                                             │
│           Run multiple AI coding assistants simultaneously                  │
│              in isolated git worktrees with real-time                       │
│                        status monitoring.                                   │
│                                                                             │
│              <a href="#quickstart">Get Started</a>  [View on GitHub ↗]      │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                        <section> FEATURES SECTION                           │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │  🔀 Parallel    │  │  🌿 Git         │  │  📊 Real-time   │             │
│  │  Workspaces     │  │  Worktrees      │  │  Status         │             │
│  │                 │  │                 │  │                 │             │
│  │ Run multiple AI │  │ Each workspace  │  │ Monitor agent   │             │
│  │ agents in       │  │ is an isolated  │  │ status across   │             │
│  │ parallel        │  │ git worktree    │  │ all workspaces  │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │  ⌨️ Keyboard    │  │  💻 VS Code     │  │  🎙️ Voice       │             │
│  │  Driven         │  │  Powered        │  │  Dictation      │             │
│  │                 │  │                 │  │                 │             │
│  │ Alt+X shortcut  │  │ Full code-      │  │ Built-in speech │             │
│  │ mode for fast   │  │ server with     │  │ to text for     │             │
│  │ navigation      │  │ all extensions  │  │ hands-free      │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────┐           │
│  │  [Linux Logo] Linux    [Windows Logo] Windows               │           │
│  └─────────────────────────────────────────────────────────────┘           │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                      <section> SCREENSHOT SECTION                           │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  │                    [Screenshot Placeholder]                         │   │
│  │                    "Screenshots coming soon"                        │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│               <section id="quickstart"> QUICK START SECTION                 │
│                              tabindex="-1"                                  │
│                                                                             │
│                          Get Started                                        │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────┐          │
│   │  <pre><code>                                                │  [Copy]  │
│   │  # Clone the repository                                     │          │
│   │  git clone https://github.com/stefanhoelzl/codehydra.git   │          │
│   │                                                             │          │
│   │  # Install dependencies                                     │          │
│   │  npm install                                                │          │
│   │                                                             │          │
│   │  # Run in development mode                                  │          │
│   │  npm run dev                                                │          │
│   │  </code></pre>                                              │          │
│   └─────────────────────────────────────────────────────────────┘          │
│   <div role="status" aria-live="polite" class="visually-hidden">           │
│     {copied ? 'Code copied to clipboard' : ''}                             │
│   </div>                                                                    │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                            <footer> FOOTER                                  │
│                                                                             │
│                    MIT License · GitHub                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Color Scheme (Self-Contained Dark Theme)

The landing page has its own CSS variables - no imports from the main app:

```css
/* site/src/styles/site.css */

/* Dark theme - no light mode, no VS Code variables */
:root {
  /* Brand gradient (from logo) */
  --site-gradient-start: #00d4ff; /* Cyan/turquoise */
  --site-gradient-end: #0066ff; /* Blue */

  /* Dark backgrounds */
  --site-bg-primary: #0d1117; /* GitHub dark */
  --site-bg-secondary: #161b22; /* Slightly lighter */
  --site-bg-card: #21262d; /* Card backgrounds */
  --site-bg-code: #1e1e2e; /* Code blocks */

  /* Text */
  --site-text-primary: #e6edf3; /* Main text */
  --site-text-secondary: #8b949e; /* Muted text */

  /* Borders & accents */
  --site-border: #30363d;
  --site-focus: #58a6ff; /* Focus rings */
}

/* Smooth scroll with reduced motion support (CSS-only) */
html {
  scroll-behavior: smooth;
}

@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }
}

/* Visually hidden (for screen readers) */
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Skip link (visible on focus) */
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  padding: 8px 16px;
  background: var(--site-bg-card);
  color: var(--site-text-primary);
  z-index: 100;
}

.skip-link:focus {
  top: 0;
}
```

### Responsive Breakpoints (Mobile-First with min-width)

```css
/* Mobile (default) - single column */
.feature-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
}

/* Tablet and up */
@media (min-width: 640px) {
  .feature-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* Desktop and up */
@media (min-width: 1024px) {
  .feature-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
```

### User Interactions

| Interaction    | Implementation                                           | Notes        |
| -------------- | -------------------------------------------------------- | ------------ |
| Smooth scroll  | CSS `scroll-behavior: smooth` + `<a href="#quickstart">` | No JS needed |
| Reduced motion | CSS `@media (prefers-reduced-motion: reduce)`            | Automatic    |
| Copy button    | Svelte `$state` + `navigator.clipboard` with try/catch   | Minimal JS   |
| Copy feedback  | ARIA live region + visual "Copied!" text                 | Accessible   |
| External links | `target="_blank" rel="noopener noreferrer"`              | Secure       |
| Skip link      | First focusable element, visible on focus                | Keyboard nav |

## Implementation Steps

### Phase 1: Core Site (ends with user review checkpoint)

- [x] **Step 1: Create site directory structure and configs**
  - Create `site/` folder structure
  - Create `site/vite.config.ts` with `base: "/"` (custom domain)
  - Create `site/svelte.config.ts` with vitePreprocess
  - Create `site/tsconfig.json` extending `../tsconfig.web.json`
  - Create `site/index.html` with meta tags, favicon link (`<link rel="icon" href="/logo.png">`), viewport, theme-color
  - Create `site/src/main.ts` mount point
  - Copy logo to `site/public/logo.png`
  - Create `site/public/CNAME` containing `codehydra.dev`
  - Add npm scripts to `package.json`: `site:dev`, `site:build`, `site:preview`, `site:check`
  - Files affected: `site/` (new directory), `package.json`
  - Test criteria: `npm run site:dev` starts without errors, `npm run site:check` passes

- [x] **Step 2: Create landing page components with semantic HTML**
  - Create `site/src/styles/site.css` with self-contained CSS variables
  - Create `site/src/App.svelte` with `<main id="main-content">` wrapper
  - Create `site/src/components/Header.svelte` with `<nav>`, skip link (`<a href="#main-content" class="skip-link">`), logo, GitHub link
  - Create `site/src/components/Hero.svelte` with `<section>`, logo image with `alt="CodeHydra Logo"`, CTA links
  - Create `site/src/components/Features.svelte` with `<section>`, feature grid (6 features + platform row with 🐧 Linux and 🪟 Windows logos)
  - Create `site/src/components/Screenshot.svelte` with `<section>`, placeholder
  - Create `site/src/components/QuickStart.svelte` with `<section id="quickstart" tabindex="-1">`, `<pre><code>`
  - Create `site/src/components/Footer.svelte` with `<footer>`, license, GitHub link
  - All external links use `target="_blank" rel="noopener noreferrer"`
  - All images have `alt` attributes
  - Files affected: `site/src/App.svelte`, `site/src/components/*.svelte`, `site/src/styles/site.css`
  - Test criteria: Page renders with all sections, semantic HTML structure correct

- [x] **Step 3: Implement responsive layout**
  - Mobile-first CSS with min-width breakpoints (640px, 1024px)
  - Feature grid: 1 col → 2 col → 3 col
  - Smooth scroll via CSS (no JS)
  - Reduced motion support via CSS media query
  - Files affected: `site/src/styles/site.css`
  - Test criteria: Layouts correct at 320px, 768px, 1200px; smooth scroll works; reduced motion respected

- [ ] **Step 4: USER REVIEW CHECKPOINT**
  - Run `npm run site:dev` and review the site
  - Run `npm run site:check` to verify TypeScript/Svelte
  - Run `npm run lint` to verify ESLint passes for site/
  - Run `npm run format:check` to verify Prettier passes for site/
  - Check: overall look and feel, colors, layout, content, responsiveness, accessibility
  - Provide feedback before proceeding to Phase 2
  - **STOP HERE FOR USER REVIEW**

### Phase 2: Polish & Deploy (after user approval)

- [ ] **Step 5: Add copy button interactivity**
  - Add copy button with `aria-label="Copy installation code"`
  - Use Svelte 5 `$state` rune for copied status
  - Use try/catch for `navigator.clipboard.writeText()` errors
  - Add ARIA live region for screen reader announcement
  - Show "Copied!" feedback for 2 seconds
  - Files affected: `site/src/components/QuickStart.svelte`
  - Test criteria: Copy works, shows feedback, errors handled gracefully, screen reader announces

- [ ] **Step 6: Add Open Graph meta tags**
  - Add `<meta name="description">` for SEO
  - Add Open Graph tags: `og:title`, `og:description`, `og:image`, `og:url`
  - Add `<meta name="theme-color" content="#0d1117">`
  - Files affected: `site/index.html`
  - Test criteria: Social preview shows correctly (test with opengraph.xyz)

- [ ] **Step 7: Create README.md**
  - Create README.md at repository root using content from **Appendix A** below
  - Files affected: `README.md` (new)
  - Test criteria: Headers render as headers, code blocks have syntax highlighting, badges display (no broken images), tables formatted correctly, all links work (docs/ARCHITECTURE.md, docs/PATTERNS.md, LICENSE), emoji icons render correctly

- [ ] **Step 8: Update AGENTS.md**
  - Add `site:*` scripts to Essential Commands table
  - Add new "Public Documentation" section after "Project Overview"
  - Files affected: `AGENTS.md`
  - Test criteria: New section is clear and follows existing document style

- [ ] **Step 9: Add pages job to ci.yaml**
  - Add independent `pages` job to `.github/workflows/ci.yaml`
  - Runs on ubuntu-latest, only on main branch
  - Builds site and deploys to GitHub Pages
  - Files affected: `.github/workflows/ci.yaml`
  - Test criteria: Workflow syntax valid, (after merge) deployment succeeds, site accessible at https://codehydra.dev

## Testing Strategy

### Integration Tests

No automated tests required - this is static documentation/marketing content.

### Manual Testing Checklist

**Phase 1 Checkpoint (Step 4):**

- [ ] `npm run site:dev` starts dev server without errors
- [ ] `npm run site:check` passes (no TypeScript/Svelte errors)
- [ ] `npm run lint` passes for `site/**` files
- [ ] `npm run format:check` passes for `site/**` files
- [ ] Page loads without console errors
- [ ] Logo displays with correct alt text ("CodeHydra Logo")
- [ ] Favicon displays in browser tab (logo.png)
- [ ] Dark theme applied (background is #0d1117, no white/light backgrounds)
- [ ] All 6 feature cards render with emoji icons and text
- [ ] Platform row shows 🐧 Linux and 🪟 Windows (no macOS)
- [ ] Screenshot placeholder displays with "Screenshots coming soon"
- [ ] Code block uses `<pre><code>` and is readable
- [ ] Skip link appears on focus (Tab key from page load)
- [ ] "Get Started" link scrolls to Quick Start section (CSS smooth scroll)
- [ ] Smooth scroll disabled when `prefers-reduced-motion: reduce` is set
- [ ] GitHub links open in new tab
- [ ] Responsive: mobile (320px) - single column features
- [ ] Responsive: tablet (768px) - 2 column features
- [ ] Responsive: desktop (1200px) - 3 column features
- [ ] Semantic HTML: inspect shows `<nav>`, `<main>`, `<section>`, `<footer>`

**Phase 2 Final Testing:**

- [ ] `npm run site:build` produces output in `site/dist/`
- [ ] `npm run site:preview` serves built site correctly
- [ ] CNAME file exists in `site/dist/` with content `codehydra.dev`
- [ ] Copy button has visible focus state
- [ ] Copy button copies text to clipboard
- [ ] Copy button shows "Copied!" feedback for ~2 seconds
- [ ] Copy failure doesn't crash (test by revoking clipboard permission)
- [ ] Screen reader announces "Code copied to clipboard" (test with VoiceOver/NVDA)
- [ ] README.md renders correctly on GitHub:
  - [ ] Logo displays at 128x128
  - [ ] CI badge links to Actions
  - [ ] License badge displays
  - [ ] Platform badge shows "Linux | Windows" (no macOS)
  - [ ] Headers are styled as headers (not plain text)
  - [ ] Code blocks have syntax highlighting
  - [ ] Tables are formatted as tables
  - [ ] Link to docs/ARCHITECTURE.md works
  - [ ] Link to docs/PATTERNS.md works
  - [ ] Link to LICENSE works
  - [ ] Emoji icons (🔀, 🌿, etc.) render correctly
- [ ] AGENTS.md updates are correct and follow existing style
- [ ] Lighthouse accessibility score > 90
- [ ] Open Graph preview works (test at opengraph.xyz or similar)
- [ ] (After merge) GitHub Pages deployment succeeds
- [ ] (After merge) Site accessible at https://codehydra.dev
- [ ] (After merge) Site also accessible at https://stefanhoelzl.github.io/codehydra/

## Dependencies

No new dependencies required. The landing site reuses existing devDependencies:

- `svelte` (already in devDependencies)
- `vite` (already in devDependencies)
- `@sveltejs/vite-plugin-svelte` (already in devDependencies)
- `typescript` (already in devDependencies)

Existing tooling automatically applies:

- `eslint.config.js` - glob patterns cover `site/**/*.svelte` and `site/**/*.ts`
- `.prettierrc` - applies to all files including `site/**`
- `svelte-check` - can be run via new `site:check` script

## Documentation Updates

### Files to Update

| File                        | Changes Required                                                           |
| --------------------------- | -------------------------------------------------------------------------- |
| `package.json`              | Add `site:dev`, `site:build`, `site:preview`, `site:check` scripts         |
| `AGENTS.md`                 | Add site scripts to Essential Commands, add "Public Documentation" section |
| `.github/workflows/ci.yaml` | Add independent `pages` job                                                |

### New Documentation Required

| File                       | Purpose                                               |
| -------------------------- | ----------------------------------------------------- |
| `README.md`                | Project overview, features, quick start, contributing |
| `site/` (entire directory) | Landing page source                                   |

## Definition of Done

- [ ] All implementation steps complete
- [ ] `npm run validate:fix` passes
- [ ] `npm run site:build` succeeds
- [ ] `npm run site:check` passes
- [ ] Documentation updated (README.md, AGENTS.md)
- [ ] User acceptance testing passed
- [ ] CI passed
- [ ] Merged to main

---

## Appendix A: README.md Content

````markdown
<div align="center">
  <img src="resources/icon.png" alt="CodeHydra Logo" width="128" height="128">
  <h1>CodeHydra</h1>
  <p><strong>Multi-workspace IDE for parallel AI agent development</strong></p>

[![CI](https://github.com/stefanhoelzl/codehydra/actions/workflows/ci.yaml/badge.svg)](https://github.com/stefanhoelzl/codehydra/actions/workflows/ci.yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows-lightgrey)

</div>

---

Run multiple AI coding assistants simultaneously in isolated git worktrees
with real-time status monitoring.

## Features

- 🔀 **Parallel Workspaces** — Run multiple AI agents simultaneously, each in its own workspace
- 🌿 **Git Worktrees** — Each workspace is an isolated git worktree, not a separate clone
- 📊 **Real-time Status** — Monitor agent status (idle/busy/waiting) across all workspaces
- ⌨️ **Keyboard Driven** — Alt+X shortcut mode for fast workspace navigation
- 💻 **VS Code Powered** — Full code-server integration with all your extensions
- 🎙️ **Voice Dictation** — Built-in speech-to-text for hands-free coding
- 🐧 **Linux** & 🪟 **Windows** — Native support for both platforms

## Screenshot

> 📸 Screenshots coming soon

## Quick Start

```bash
# Clone the repository
git clone https://github.com/stefanhoelzl/codehydra.git
cd codehydra

# Install dependencies
npm install

# Run in development mode
npm run dev
```
````

## How It Works

CodeHydra uses **git worktrees** to create isolated workspaces from a single repository:

| Concept       | Description                                                   |
| ------------- | ------------------------------------------------------------- |
| **Project**   | A git repository (the main directory)                         |
| **Workspace** | A git worktree — an isolated working copy with its own branch |

Each workspace gets its own VS Code instance (via code-server) and can run an independent
AI agent. Switch between workspaces instantly while each agent continues working.

## Development

### Prerequisites

- Node.js 20+
- npm 10+
- Git

### Commands

| Command                | Description                          |
| ---------------------- | ------------------------------------ |
| `npm run dev`          | Start in development mode            |
| `npm run build`        | Build for production                 |
| `npm test`             | Run all tests                        |
| `npm run validate:fix` | Fix lint/format issues and run tests |
| `npm run dist`         | Create distributable for current OS  |

### Project Structure

```
src/
├── main/       # Electron main process
├── preload/    # Preload scripts
├── renderer/   # Svelte frontend
└── services/   # Node.js services
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture documentation.

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run `npm run validate:fix` to ensure all checks pass
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Development Guidelines

- Follow existing code patterns (see [docs/PATTERNS.md](docs/PATTERNS.md))
- Write tests for new functionality
- Update documentation as needed
- Keep commits focused and well-described

## License

[MIT](LICENSE) © 2025 CodeHydra

````

---

## Appendix B: Site Configuration Files

### site/vite.config.ts

```typescript
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "path";

export default defineConfig({
  plugins: [svelte()],
  root: resolve(__dirname),
  base: "/", // Custom domain (codehydra.dev) - no subdirectory needed
  build: {
    outDir: "dist",
    emptyDirFirst: true,
  },
});
````

### site/svelte.config.ts

```typescript
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
};
```

### site/tsconfig.json

```json
{
  "extends": "../tsconfig.web.json",
  "compilerOptions": {
    "composite": true,
    "baseUrl": ".",
    "paths": {}
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### site/public/CNAME

```
codehydra.dev
```

### package.json scripts (to add)

```json
{
  "scripts": {
    "site:dev": "vite --config site/vite.config.ts",
    "site:build": "vite build --config site/vite.config.ts",
    "site:preview": "vite preview --config site/vite.config.ts",
    "site:check": "svelte-check --tsconfig site/tsconfig.json"
  }
}
```

---

## Appendix C: CI Workflow Update

Add this job to `.github/workflows/ci.yaml` (independent of existing `ci` job):

```yaml
pages:
  name: Deploy Landing Page
  runs-on: ubuntu-latest
  if: github.ref == 'refs/heads/main'

  permissions:
    contents: read
    pages: write
    id-token: write

  environment:
    name: github-pages
    url: ${{ steps.deployment.outputs.page_url }}

  steps:
    - uses: actions/checkout@v4

    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: npm

    - run: npm ci --force

    - run: npm run site:build

    - uses: actions/configure-pages@v5

    - uses: actions/upload-pages-artifact@v3
      with:
        path: site/dist

    - id: deployment
      uses: actions/deploy-pages@v4
```

---

## Appendix D: AGENTS.md Updates

### Add to Essential Commands table:

| Command                | Purpose                           |
| ---------------------- | --------------------------------- |
| `npm run site:dev`     | Start landing page dev server     |
| `npm run site:build`   | Build landing page for production |
| `npm run site:preview` | Preview built landing page        |
| `npm run site:check`   | Type-check landing page           |

### Add new section after "Project Overview":

````markdown
## Public Documentation

### README.md

The repository README (`README.md`) is the primary entry point for GitHub visitors. It includes:

- Project description and features
- Quick start instructions
- Development commands
- Contributing guidelines

### Landing Page

The landing page at [codehydra.dev](https://codehydra.dev) is built with Vite + Svelte and deployed via GitHub Pages.

| Path                       | Purpose                                          |
| -------------------------- | ------------------------------------------------ |
| `site/`                    | Landing page source                              |
| `site/src/components/`     | Svelte components (Header, Hero, Features, etc.) |
| `site/src/styles/site.css` | Self-contained CSS (no main app imports)         |
| `site/public/`             | Static assets (logo, CNAME)                      |

**Development:**

```bash
npm run site:dev      # Start dev server at localhost:5173
npm run site:build    # Build to site/dist/
npm run site:check    # Type-check
```
````

The landing page is self-contained and does not import from the main app's source code.

```

---

## Appendix E: Feature Details for Landing Page

| Feature | Icon | Title | Description |
|---------|------|-------|-------------|
| Parallel | 🔀 | Parallel Workspaces | Run multiple AI agents simultaneously, each in its own isolated workspace |
| Worktrees | 🌿 | Git Worktrees | Each workspace is a git worktree — lightweight, isolated, shares history |
| Status | 📊 | Real-time Status | Monitor agent status (idle/busy/waiting) with visual indicators and app badge |
| Keyboard | ⌨️ | Keyboard Driven | Alt+X shortcut mode for lightning-fast workspace navigation |
| VS Code | 💻 | VS Code Powered | Full code-server integration with extensions, themes, and settings |
| Dictation | 🎙️ | Voice Dictation | Built-in speech-to-text extension for hands-free coding |
| Platform | 🐧 🪟 | Linux & Windows | Native support for both platforms |

**Note:** macOS is not listed as it has not been tested yet.

---

## Appendix F: Accessibility Checklist

| Feature | Implementation |
|---------|----------------|
| Skip link | `<a href="#main-content" class="skip-link">Skip to main content</a>` as first focusable element |
| Landmarks | `<nav>`, `<main id="main-content">`, `<section>`, `<footer>` |
| Image alt text | `<img src="logo.png" alt="CodeHydra Logo">` |
| Link purpose | GitHub links clearly labeled, external indicator (↗) |
| Focus visible | CSS `:focus-visible` with `--site-focus` color |
| Copy button | `<button aria-label="Copy installation code">` |
| Copy feedback | `<div role="status" aria-live="polite">` for screen reader |
| Reduced motion | `@media (prefers-reduced-motion: reduce) { scroll-behavior: auto; }` |
| Color contrast | Text colors meet WCAG AA against dark backgrounds |
| Keyboard nav | All interactive elements focusable and operable |
```
