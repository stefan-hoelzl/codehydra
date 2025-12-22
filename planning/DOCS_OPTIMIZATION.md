---
status: COMPLETED
last_updated: 2024-12-23
reviewers: [review-docs, review-arch]
---

# DOCS_OPTIMIZATION

## Overview

- **Problem**: Documentation is not optimized for AI agent consumption. AGENTS.md is too long (1445 lines), critical rules are buried at the bottom, and implementation patterns are mixed with essential instructions.
- **Solution**: Restructure documentation with agent-optimized format - critical rules first, shorter AGENTS.md (~600 lines ±50), extracted patterns in new docs/PATTERNS.md
- **Risks**:
  - Breaking existing agent workflows by changing file structure → Mitigate by keeping AGENTS.md as primary entry point
  - Missing important content during extraction → Mitigate by systematic extraction with checklist and verification step
  - Content duplication between PATTERNS.md and ARCHITECTURE.md → Mitigate by clear boundary: ARCHITECTURE.md for high-level system design, PATTERNS.md for implementation details with code examples
- **Alternatives Considered**:
  - Single large AGENTS.md with better organization → Rejected: still too long for context windows
  - Multiple AGENTS-\*.md files → Rejected: harder to discover, AGENTS.md should remain primary

## Architecture

```
BEFORE:
┌─────────────────────────────────────────────────────────────────┐
│ AGENTS.md (1445 lines)                                          │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Project Overview                                            │ │
│ │ Key Concepts                                                │ │
│ │ VS Code Assets                                              │ │
│ │ Binary Distribution                                         │ │
│ │ ... (800+ lines of patterns) ...                            │ │
│ │ Development Workflow                                        │ │
│ │ Code Quality                                                │ │
│ │ CRITICAL RULES (buried at line 1369!)                       │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘

AFTER:
┌─────────────────────────────────────────────────────────────────┐
│ AGENTS.md (~600 lines) - PRIMARY ENTRY POINT                    │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ CRITICAL RULES (lines 1-80)                                 │ │
│ │   - No Ignore Comments                                      │ │
│ │   - API/IPC Interface Changes                               │ │
│ │   - New Boundary Interfaces                                 │ │
│ │   - External System Access Rules                            │ │
│ │ Quick Start (lines 81-120)                                  │ │
│ │   - Tech stack, key commands, key docs                      │ │
│ │ Project Overview (lines 121-200)                            │ │
│ │ Key Concepts (lines 201-280)                                │ │
│ │ Essential Patterns - brief + links (lines 281-450)          │ │
│ │ Development Workflow (lines 451-550)                        │ │
│ │ Validation Commands (lines 551-600)                         │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
          │
          │ "Full details": docs/PATTERNS.md
          ▼
┌─────────────────────────────────────────────────────────────────┐
│ docs/PATTERNS.md (~800 lines) - IMPLEMENTATION DETAILS          │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ (Code examples, mock factories, detailed usage)             │ │
│ │ VSCode Elements Patterns                                    │ │
│ │ UI Patterns                                                 │ │
│ │ CSS Theming Patterns                                        │ │
│ │ Service Layer Patterns                                      │ │
│ │ IPC Patterns (detailed)                                     │ │
│ │ OpenCode Integration                                        │ │
│ │ Plugin Interface                                            │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ docs/ARCHITECTURE.md - HIGH-LEVEL SYSTEM DESIGN (with TOC)      │
│ (Component relationships, data flows, NO code examples)         │
│                                                                 │
│ docs/TESTING.md - TESTING STRATEGY (with quick ref)             │
│ (Test utilities stay here - not moved to PATTERNS.md)           │
│                                                                 │
│ docs/USER_INTERFACE.md - USER FLOWS (unchanged)                 │
└─────────────────────────────────────────────────────────────────┘
```

### Content Boundary Clarification

| File                   | Contains                                                                        | Does NOT Contain                                    |
| ---------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------- |
| `AGENTS.md`            | Critical rules, quick start, brief pattern summaries with links                 | Detailed code examples, mock factories              |
| `docs/PATTERNS.md`     | Implementation patterns with full code examples, mock factories, detailed usage | High-level architecture, test utilities             |
| `docs/ARCHITECTURE.md` | System design, component relationships, data flows                              | Implementation code examples (defer to PATTERNS.md) |
| `docs/TESTING.md`      | Test strategy, test utilities, boundary test helpers                            | Implementation patterns (defer to PATTERNS.md)      |

## Implementation Steps

- [x] **Step 1: Create docs/PATTERNS.md**
  - Create new file with table of contents:

    ```markdown
    # CodeHydra Implementation Patterns

    ## Table of Contents

    - [VSCode Elements Patterns](#vscode-elements-patterns)
    - [UI Patterns](#ui-patterns)
    - [CSS Theming Patterns](#css-theming-patterns)
    - [Service Layer Patterns](#service-layer-patterns)
    - [IPC Patterns](#ipc-patterns)
    - [OpenCode Integration](#opencode-integration)
    - [Plugin Interface](#plugin-interface)
    ```

  - Extract VSCode Elements Patterns from AGENTS.md lines 520-618
  - Extract UI Patterns from AGENTS.md lines 620-743
  - Extract CSS Theming Patterns from AGENTS.md lines 744-810
  - Extract Service Layer Patterns from AGENTS.md lines 844-1143
  - Extract detailed IPC Patterns from AGENTS.md lines 397-518
  - Extract OpenCode Integration from AGENTS.md lines 812-843, 1144-1196
  - Extract Plugin Interface from AGENTS.md lines 1198-1289
  - Files affected: `docs/PATTERNS.md` (new)
  - Test criteria: File exists, all 7 sections present with correct header names, TOC links work

- [x] **Step 1.5: Verify Extraction Completeness**
  - Before proceeding to Step 2, verify each section extracted to PATTERNS.md:
    - [x] VSCode Elements Patterns - component table, event handling, property binding, focus management, exceptions
    - [x] UI Patterns - mousedown pattern, fixed positioning, FilterableDropdown
    - [x] CSS Theming Patterns - variable naming, VS Code fallback, semantic colors
    - [x] Service Layer Patterns - DI pattern, NetworkLayer, ProcessRunner, FileSystemLayer with mock examples
    - [x] IPC Patterns - fire-and-forget, API layer, ID generation, v2 API usage
    - [x] OpenCode Integration - agent status store, SDK integration, callback pattern
    - [x] Plugin Interface - architecture, connection lifecycle, message protocol
  - Test criteria: Each bullet point above has corresponding content in PATTERNS.md

- [x] **Step 2: Restructure AGENTS.md - Add Critical Rules and Quick Start at Top**
  - Add new `## CRITICAL RULES` section at the very top (after title), containing:
    1. "No Ignore Comments" section (from lines 1369-1382)
    2. "API/IPC Interface Changes" section (from lines 1384-1407)
    3. "New Boundary Interfaces" section (from lines 1409-1430)
    4. "External System Access Rules" table (from lines 1089-1096) - immediately after the three rules above
  - Add new `## Quick Start` section after CRITICAL RULES (~20 lines):
    - Tech stack table (keep existing)
    - Essential commands: `npm run dev`, `npm run validate:fix`, `npm test`
    - Key documents table (updated to include PATTERNS.md)
  - Target: Critical rules + Quick Start within first 120 lines
  - Files affected: `AGENTS.md`
  - Test criteria: CRITICAL RULES header at line ~10, Quick Start at line ~85, all 4 critical sections present

- [x] **Step 3: Restructure AGENTS.md - Remove Extracted Content and Add Summaries**
  - For each extracted section, replace with a brief summary (2-3 sentences, 40-60 words) that:
    1. States what problem the pattern solves
    2. Lists 2-3 key points or rules
    3. Ends with: `**Full details**: docs/PATTERNS.md → [Exact Section Name]`
  - Sections to replace with summaries:
    - VSCode Elements Patterns → summary + link to "VSCode Elements Patterns"
    - UI Patterns → summary + link to "UI Patterns"
    - CSS Theming Patterns → summary + link to "CSS Theming Patterns"
    - Service Layer Patterns → summary + link to "Service Layer Patterns"
    - IPC Patterns (detailed examples) → summary + link to "IPC Patterns"
    - OpenCode Integration → summary + link to "OpenCode Integration"
    - Plugin Interface → summary + link to "Plugin Interface"
  - Files affected: `AGENTS.md`
  - Test criteria:
    - File is 550-650 lines (target 600 ±50)
    - Each removed section has exactly one reference to PATTERNS.md
    - Reference section names match PATTERNS.md headers exactly (verify with grep)

- [x] **Step 4: Update Key Documents Table in AGENTS.md**
  - Add docs/PATTERNS.md to the Key Documents table:
    ```markdown
    | Document | Location         | Purpose                               |
    | -------- | ---------------- | ------------------------------------- |
    | Patterns | docs/PATTERNS.md | Implementation patterns with examples |
    ```
  - Update existing descriptions to reflect new structure
  - Files affected: `AGENTS.md`
  - Test criteria: Key Documents table includes PATTERNS.md with correct path and description

- [x] **Step 5: Update docs/ARCHITECTURE.md - Add Navigation and Remove Overlap**
  - Add "Quick Navigation" table at top (after title) with these sections:

    ```markdown
    ## Quick Navigation

    | Section                                           | Description               |
    | ------------------------------------------------- | ------------------------- |
    | [System Overview](#system-overview)               | High-level architecture   |
    | [Core Concepts](#core-concepts)                   | Project, Workspace, Views |
    | [Component Architecture](#component-architecture) | Main components           |
    | [API Layer](#api-layer-architecture)              | ICodeHydraApi design      |
    | [Theming System](#theming-system)                 | CSS variables             |
    | [Logging](#logging)                               | Log levels and files      |
    ```

  - Verify ARCHITECTURE.md does NOT duplicate the three CRITICAL rules sections (these are exclusive to AGENTS.md)
  - If any service pattern sections overlap with PATTERNS.md, add a reference: "See docs/PATTERNS.md for implementation examples"
  - Files affected: `docs/ARCHITECTURE.md`
  - Test criteria: Quick Navigation table present at top, no duplicate CRITICAL rules content

- [x] **Step 6: Update docs/TESTING.md - Add Quick Reference**
  - Add "Quick Reference" table after the Overview section:

    ```markdown
    ## Quick Reference

    | Task                   | Command                 | Section                                           |
    | ---------------------- | ----------------------- | ------------------------------------------------- |
    | Run all tests          | `npm test`              | [Test Commands](#test-commands)                   |
    | Run unit tests only    | `npm run test:unit`     | [Test Commands](#test-commands)                   |
    | Run boundary tests     | `npm run test:boundary` | [Test Commands](#test-commands)                   |
    | Pre-commit validation  | `npm run validate`      | [Test Commands](#test-commands)                   |
    | Decide which test type | See decision guide      | [Decision Guide](#decision-guide)                 |
    | Create test git repo   | `createTestGitRepo()`   | [Test Helpers](#test-helpers)                     |
    | Test async code        | Use fake timers         | [Async Testing Patterns](#async-testing-patterns) |
    ```

  - Files affected: `docs/TESTING.md`
  - Test criteria: Quick Reference table present after Overview, all links valid

- [x] **Step 7: Update .opencode/agent/feature.md - Add Documentation Context**
  - File exists at: `.opencode/agent/feature.md` (verified)
  - Add "Project Documentation" subsection inside the existing "Information Gathering" section (after "When to Use webfetch Directly"):

    ```markdown
    ### Project Documentation

    Key documentation files for planning:

    | Document               | Purpose                                    | When to Read                               |
    | ---------------------- | ------------------------------------------ | ------------------------------------------ |
    | `AGENTS.md`            | Critical rules, essential patterns         | Always - contains rules you MUST follow    |
    | `docs/PATTERNS.md`     | Implementation patterns with code examples | When planning implementation details       |
    | `docs/ARCHITECTURE.md` | System design, component relationships     | When understanding how components interact |
    | `docs/TESTING.md`      | Testing strategy and utilities             | When planning test approach                |
    ```

  - Files affected: `.opencode/agent/feature.md`
  - Test criteria: Project Documentation section present with all 4 docs listed

- [x] **Step 8: Update .opencode/agent/review-\*.md - Add Pattern References**
  - Files exist at: `.opencode/agent/review-arch.md`, `.opencode/agent/review-typescript.md`, `.opencode/agent/review-ui.md`, `.opencode/agent/review-docs.md` (verified)
  - For each file, update the "Context" section to include:
    - `docs/PATTERNS.md` - Implementation patterns (for review-arch, review-typescript, review-ui)
    - Updated doc list (for review-docs)
  - **review-arch.md**: Add to Context section:
    ```markdown
    - `docs/PATTERNS.md` - Implementation patterns to check for consistency
    ```
  - **review-typescript.md**: Add to Context section:
    ```markdown
    - `docs/PATTERNS.md` - TypeScript patterns and examples
    ```
  - **review-ui.md**: Add to Context section:
    ```markdown
    - `docs/PATTERNS.md` - UI and VSCode Elements patterns
    ```
  - **review-docs.md**: Update the Context table to include:
    ```markdown
    | `docs/PATTERNS.md` | Implementation patterns with code examples | Pattern examples or code conventions change |
    ```
  - Files affected: `.opencode/agent/review-arch.md`, `.opencode/agent/review-typescript.md`, `.opencode/agent/review-ui.md`, `.opencode/agent/review-docs.md`
  - Test criteria: Each review agent file references docs/PATTERNS.md appropriately

- [x] **Step 9: Audit and Update Cross-References**
  - Search all docs/\*.md files for references to AGENTS.md sections that may have moved
  - Search for any hardcoded line number references (these will be invalid after restructure)
  - Update any stale references to point to correct new locations
  - Files affected: `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/USER_INTERFACE.md`
  - Test criteria: No references to moved/removed sections, no hardcoded line numbers

## Testing Strategy

### Manual Testing Checklist

- [ ] AGENTS.md is 550-650 lines (target 600 ±50, was 1445)
- [ ] CRITICAL RULES section appears within first 20 lines of AGENTS.md
- [ ] Quick Start section appears within first 120 lines of AGENTS.md
- [ ] docs/PATTERNS.md exists with all 7 sections (verify TOC)
- [ ] All references from AGENTS.md to PATTERNS.md use exact section names (grep verify)
- [ ] docs/ARCHITECTURE.md has Quick Navigation table at top
- [ ] docs/TESTING.md has Quick Reference table after Overview
- [ ] .opencode/agent/feature.md has Project Documentation section
- [ ] All 4 review agent files reference docs/PATTERNS.md
- [ ] No broken internal links in any documentation file
- [ ] Run `git diff --stat` to verify ~850 lines removed from AGENTS.md, ~800 lines added to PATTERNS.md

## Dependencies

| Package | Purpose                    | Approved |
| ------- | -------------------------- | -------- |
| (none)  | This is documentation-only | N/A      |

## Documentation Updates

### Files to Update

| File                          | Changes Required                                            |
| ----------------------------- | ----------------------------------------------------------- |
| `AGENTS.md`                   | Major restructure - critical rules to top, extract patterns |
| `docs/ARCHITECTURE.md`        | Add Quick Navigation table, remove overlap with PATTERNS.md |
| `docs/TESTING.md`             | Add Quick Reference table                                   |
| `.opencode/agent/feature.md`  | Add Project Documentation section                           |
| `.opencode/agent/review-*.md` | Add PATTERNS.md references (4 files)                        |

### New Documentation Required

| File               | Purpose                                                   |
| ------------------ | --------------------------------------------------------- |
| `docs/PATTERNS.md` | Detailed implementation patterns extracted from AGENTS.md |

## Definition of Done

- [ ] All implementation steps complete (Steps 1-9)
- [ ] AGENTS.md is 550-650 lines with critical rules at top
- [ ] docs/PATTERNS.md contains all 7 extracted pattern sections
- [ ] All doc files have proper navigation aids
- [ ] .opencode/agent files reference new structure
- [ ] Manual testing checklist passes (all items checked)
- [ ] No broken cross-references between docs
- [ ] Changes committed
