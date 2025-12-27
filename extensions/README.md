# VS Code Extensions

This directory contains the source code for VS Code extensions used by CodeHydra.

## Directory Structure

```
extensions/
├── extensions.json           # Extension manifest (marketplace + bundled)
├── codehydra-sidekick/       # Custom sidekick extension source
│   ├── package.json          # Extension manifest
│   ├── extension.js          # Extension entry point
│   ├── api.d.ts              # TypeScript declarations for third-party use
│   └── esbuild.config.js     # Build configuration
└── README.md                 # This file
```

## Build Process

Extensions are built via the `build:extensions` npm script:

```bash
npm run build:extensions
```

This:

1. Installs dependencies for each extension
2. Builds the extension using esbuild
3. Packages the extension as a `.vsix` file
4. Outputs to `dist/extensions/`

The main `npm run build` command runs `build:extensions` before `electron-vite build`, ensuring the packaged extensions are available for bundling.

## Adding a New Extension

1. Create a new directory under `extensions/` (e.g., `extensions/my-extension/`)
2. Add required files:
   - `package.json` with VS Code extension manifest
   - `extension.js` or TypeScript source
   - `.vscodeignore` to exclude dev files from the package
3. Update `extensions/extensions.json` to include the extension in the `bundled` array
4. Update the `build:extensions` script in `package.json` to build the new extension

## Extension Manifest (extensions.json)

The `extensions.json` file defines which extensions to install:

```json
{
  "marketplace": ["publisher.extension-id"],
  "bundled": [
    {
      "id": "codehydra.sidekick",
      "version": "0.0.2",
      "vsix": "codehydra-sidekick-0.0.2.vsix"
    }
  ]
}
```

- `marketplace`: Extensions installed from the VS Code marketplace
- `bundled`: Extensions packaged with the application (built from this directory)
