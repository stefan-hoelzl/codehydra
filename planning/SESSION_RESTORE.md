---
status: COMPLETED
last_updated: 2025-12-27
reviewers: [review-typescript, review-arch, review-testing, review-docs]
---

# SESSION_RESTORE

> **Note**: Agent mode restoration was removed after implementation because `opencode attach`
> does not support the `--agent` flag. Only session restoration (`--session` flag) is performed.
> The agent restoration code, tests, and documentation were removed in a subsequent cleanup.

## Overview

- **Problem**: Session restoration was accidentally removed when switching from ports.json to env var approach (commit `1ceb3bd`). The AGENTS.md still documents the feature as working, but it doesn't work. Additionally, when restoring a session, the agent mode (e.g., "plan", "code") is not restored.
- **Solution**: Re-add session restoration to the opencode wrapper script, and extend it to also detect and restore the agent mode from the session's most recent message.
- **Actual Implementation**: Only session restoration was kept. Agent restoration was removed because `opencode attach` doesn't support `--agent` flag.
- **Risks**:
  - HTTP request adds latency (~100-200ms) before attach - acceptable tradeoff for session continuity
  - If session/message fetch fails, gracefully fall back to no restoration (new session with default agent)
  - Agent field might be missing in older sessions - handle gracefully
- **Alternatives Considered**:
  - Only restore session without agent (rejected: incomplete restoration, user expects same mode)
  - Store agent mode in workspace metadata (rejected: duplicates data that's already in OpenCode)
  - Use OpenCode's `--continue` flag (rejected: continues last session globally, not per-workspace)

**Note**: AGENTS.md currently documents session restoration as working, but this is inaccurate. This plan will implement the feature to match the documentation, then update documentation to also cover agent mode restoration.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  User runs `opencode` in terminal                                           │
│                              │                                              │
│                              ▼                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  opencode.cjs (generated Node.js script)                              │  │
│  │                                                                        │  │
│  │  1. Read CODEHYDRA_OPENCODE_PORT env var                              │  │
│  │  2. Validate port                                                      │  │
│  │  3. GET http://127.0.0.1:<port>/session ─────────────────────┐        │  │
│  │  4. Filter: directory match, no parentID                      │        │  │
│  │  5. Sort by time.updated, pick most recent ◄─────────────────┘        │  │
│  │  6. If session found:                                                  │  │
│  │     │  GET http://127.0.0.1:<port>/session/<id>/message ─────┐        │  │
│  │     │  Find most recent UserMessage                           │        │  │
│  │     │  Extract agent field ◄─────────────────────────────────┘        │  │
│  │  7. Build args: ["attach", url]                                        │  │
│  │     + ["--session", sessionId] if session found                        │  │
│  │     + ["--agent", agent] if agent found                                │  │
│  │  8. spawnSync(opencode, args)                                          │  │
│  │  9. Exit with child's exit code                                        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  (Errors logged to stderr only when they occur)                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
GET /session
    │
    ▼
[
  { id: "ses-1", directory: "/workspace/a", parentID: null, time: { updated: 1000 } },
  { id: "ses-2", directory: "/workspace/a", parentID: "ses-1", ... },  // sub-agent, skip
  { id: "ses-3", directory: "/workspace/b", ... },                      // wrong dir, skip
  { id: "ses-4", directory: "/workspace/a", parentID: null, time: { updated: 2000 } }  // ✓ newest
]
    │
    ▼ Filter + Sort
    │
Session: { id: "ses-4", ... }
    │
    ▼
GET /session/ses-4/message
    │
    ▼
[
  { info: { role: "user", agent: "code", ... }, parts: [...] },
  { info: { role: "assistant", mode: "code", ... }, parts: [...] },
  { info: { role: "user", agent: "plan", ... }, parts: [...] },  // ← most recent user msg
  { info: { role: "assistant", mode: "plan", ... }, parts: [...] }
]
    │
    ▼ Find last UserMessage
    │
Agent: "plan"
    │
    ▼
opencode attach http://127.0.0.1:PORT --session ses-4 --agent plan
```

### Expected Types

Session response structure:

```typescript
interface SessionResponse {
  id: string;
  directory: string; // Absolute workspace path
  parentID: string | null; // null for root sessions, set for sub-agents
  time: { updated: number }; // Unix timestamp in milliseconds
}
```

Message response structure:

```typescript
interface MessageResponse {
  info: {
    role: "user" | "assistant";
    agent?: string; // Only on user messages (e.g., "plan", "code")
    mode?: string; // Only on assistant messages
  };
  parts: unknown[];
}
```

## Implementation Steps

- [x] **Step 1: Add HTTP helper functions to generated script**
  - Add `httpGet(url, timeout)` function using Node.js built-in `http` module (servers are localhost HTTP only)
  - Returns Promise that resolves to parsed JSON or null on any error
  - Define timeout constants at top of generated script:
    - `SESSION_LIST_TIMEOUT_MS = 3000` (3 seconds for session list)
    - `MESSAGE_LIST_TIMEOUT_MS = 2000` (2 seconds for messages)
  - Files affected: `src/services/vscode-setup/bin-scripts.ts`
  - Test criteria: Unit tests verify generated script includes `httpGet` function definition, timeout constants, and error handling patterns

- [x] **Step 2: Add session finding logic**
  - Add `findMatchingSession(sessions, directory)` function
  - Add `normalizePath(p)` helper function:
    ```javascript
    function normalizePath(p) {
      const normalized = require("path").normalize(p);
      return process.platform === "win32" ? normalized.toLowerCase() : normalized;
    }
    ```
  - Filter: exclude sessions with `parentID` (sub-agent sessions) - check both `null` and `undefined`
  - Filter: match normalized directory using `normalizePath()` on both session.directory and current workspace
  - Sort by `time.updated` descending, handling missing/invalid `time.updated` gracefully (treat as 0)
  - Return most recent session or null
  - Files affected: `src/services/vscode-setup/bin-scripts.ts`
  - Test criteria: Unit tests verify generated script includes `normalizePath` and `findMatchingSession` function definitions with correct logic patterns

- [x] **Step 3: Add agent detection logic**
  - Add `findAgentFromMessages(messages)` function
  - Messages array contains `{ info: { role, agent?, ... }, parts: [...] }` objects
  - Find most recent where `info.role === "user"` (iterate from end of array)
  - Return `info.agent ?? null` (use nullish coalescing to handle undefined and preserve empty string if valid)
  - Handle edge cases: missing `info` object, non-string `agent` field
  - Files affected: `src/services/vscode-setup/bin-scripts.ts`
  - Test criteria: Unit tests verify generated script includes `findAgentFromMessages` function definition

- [x] **Step 4: Update main script logic**
  - Convert main script to async IIFE pattern with proper error handling:
    ```javascript
    (async () => {
      try {
        // ... async logic
      } catch (error) {
        console.error("Error:", error instanceof Error ? error.message : error);
        process.exit(1);
      }
    })();
    ```
  - After port validation:
    1. Get current workspace directory (use `process.cwd()`)
    2. Fetch sessions from `GET /session`
    3. Find matching session using `findMatchingSession(sessions, cwd)`
    4. If session found, fetch messages from `GET /session/{id}/message`
    5. Extract agent using `findAgentFromMessages(messages)`
  - Build args array:
    ```javascript
    const args = ["attach", url];
    if (sessionId) args.push("--session", sessionId);
    if (agent) args.push("--agent", agent);
    ```
  - Graceful degradation paths:
    - Session fetch fails → no `--session` flag, no `--agent` flag
    - Message fetch fails → use `--session` without `--agent`
    - Agent field missing → use `--session` without `--agent`
  - Files affected: `src/services/vscode-setup/bin-scripts.ts`
  - Test criteria: Unit tests verify generated script includes async IIFE, try/catch, args building logic, and all fallback paths

- [x] **Step 5: Add unit tests for generated script**
  - These tests verify the **generation logic** - that `generateOpencodeNodeScript()` produces correct JavaScript patterns
  - Test generated script is valid JavaScript syntax (use `new vm.Script(content)`)
  - Test generated script includes required function definitions (`httpGet`, `normalizePath`, `findMatchingSession`, `findAgentFromMessages`)
  - Test generated script includes timeout constants
  - Test generated script includes async IIFE with try/catch
  - Test generated script includes `--session` and `--agent` flag logic
  - Test generated script includes all fallback paths
  - Files affected: `src/services/vscode-setup/bin-scripts.test.ts`
  - Test criteria: All code patterns verified via string matching and syntax validation

- [x] **Step 6: Add boundary tests for HTTP fetching**
  - Create `src/services/vscode-setup/bin-scripts.boundary-test-utils.ts` with:
    - `createMockOpencodeServer(config)` returning `{ port, setSessions, setMessages, start, stop }`
    - Use `http.createServer()` in `beforeAll`/`afterAll` hooks
    - Implement `GET /session` and `GET /session/:id/message` endpoints with configurable responses
  - Tests spawn real process running `opencode.cjs` and verify it makes correct HTTP requests to mock server
  - Test cases:
    - `fetches sessions and restores with --session` - full session restore flow
    - `fetches messages and restores with --agent` - full agent restore flow
    - `handles session fetch timeout gracefully` - uses no flags
    - `handles empty sessions array` - uses no flags
    - `handles message fetch failure` - uses `--session` without `--agent`
    - `handles missing agent field in messages` - uses `--session` without `--agent`
    - `handles HTTP 404 from /session endpoint` - uses no flags
    - `handles HTTP 500 from /session endpoint` - uses no flags
    - `handles connection refused` - uses no flags
    - `handles malformed session structure (missing time.updated)` - handles gracefully
    - `handles malformed message structure (missing info.role)` - handles gracefully
    - `handles non-string agent field` - handles gracefully
    - `completes within acceptable latency (<500ms with mock server)` - timing test
  - Files affected: `src/services/vscode-setup/bin-scripts.boundary.test.ts`, `src/services/vscode-setup/bin-scripts.boundary-test-utils.ts`
  - Test criteria: Real HTTP requests and process spawning work correctly

- [x] **Step 7: Update AGENTS.md documentation**
  - Update Session Restoration section (lines 229-233) to add: "and restores the agent mode from the session's most recent user message"
  - Remove the `OPENCODE_DEBUG=1` line (debug mode removed for simplicity)
  - Files affected: `AGENTS.md`
  - Test criteria: Documentation accurately describes both session and agent restoration

## Testing Strategy

### Unit Tests (vitest)

These tests verify **generation logic** - that the generated script contains correct patterns.

| Test Case                                                  | Description                                      | File                |
| ---------------------------------------------------------- | ------------------------------------------------ | ------------------- |
| `generated script is valid JavaScript`                     | Syntax validation with vm.Script                 | bin-scripts.test.ts |
| `generated script includes httpGet function`               | HTTP helper present                              | bin-scripts.test.ts |
| `generated script includes timeout constants`              | SESSION_LIST_TIMEOUT_MS, MESSAGE_LIST_TIMEOUT_MS | bin-scripts.test.ts |
| `generated script includes normalizePath function`         | Path normalization helper                        | bin-scripts.test.ts |
| `generated script handles Windows paths`                   | Case-insensitive on win32                        | bin-scripts.test.ts |
| `generated script includes findMatchingSession function`   | Session filtering logic                          | bin-scripts.test.ts |
| `generated script excludes sessions with parentID`         | Sub-agent filtering                              | bin-scripts.test.ts |
| `generated script sorts by time.updated`                   | Most recent selection                            | bin-scripts.test.ts |
| `generated script handles missing time.updated`            | Treats as 0                                      | bin-scripts.test.ts |
| `generated script includes findAgentFromMessages function` | Agent extraction logic                           | bin-scripts.test.ts |
| `generated script uses nullish coalescing for agent`       | Handles undefined/null                           | bin-scripts.test.ts |
| `generated script uses async IIFE pattern`                 | Async structure                                  | bin-scripts.test.ts |
| `generated script includes try/catch error handling`       | Error handling                                   | bin-scripts.test.ts |
| `generated script includes --session flag logic`           | Session flag building                            | bin-scripts.test.ts |
| `generated script includes --agent flag logic`             | Agent flag building                              | bin-scripts.test.ts |
| `generated script includes session fetch fallback`         | No flags on error                                | bin-scripts.test.ts |
| `generated script includes message fetch fallback`         | Session without agent                            | bin-scripts.test.ts |

### Boundary Tests

These tests verify **script execution behavior** by spawning real processes with mock HTTP server.

| Test Case                                          | Description                     | File                         |
| -------------------------------------------------- | ------------------------------- | ---------------------------- |
| `fetches sessions and restores with --session`     | Full session restore flow       | bin-scripts.boundary.test.ts |
| `fetches messages and restores with --agent`       | Full agent restore flow         | bin-scripts.boundary.test.ts |
| `handles session fetch timeout gracefully`         | Uses no flags                   | bin-scripts.boundary.test.ts |
| `handles empty sessions array`                     | Uses no flags                   | bin-scripts.boundary.test.ts |
| `handles message fetch failure`                    | Uses session without agent      | bin-scripts.boundary.test.ts |
| `handles missing agent field in messages`          | Uses session without agent      | bin-scripts.boundary.test.ts |
| `handles HTTP 404 from /session`                   | Uses no flags                   | bin-scripts.boundary.test.ts |
| `handles HTTP 500 from /session`                   | Uses no flags                   | bin-scripts.boundary.test.ts |
| `handles connection refused`                       | Uses no flags                   | bin-scripts.boundary.test.ts |
| `handles malformed session (missing time.updated)` | Graceful degradation            | bin-scripts.boundary.test.ts |
| `handles malformed message (missing info.role)`    | Graceful degradation            | bin-scripts.boundary.test.ts |
| `handles non-string agent field`                   | Graceful degradation            | bin-scripts.boundary.test.ts |
| `handles all sessions having parentID`             | No root sessions, uses no flags | bin-scripts.boundary.test.ts |
| `handles all messages being assistant messages`    | No user messages, no agent flag | bin-scripts.boundary.test.ts |
| `handles empty agent string`                       | Uses session without agent      | bin-scripts.boundary.test.ts |
| `completes within acceptable latency (<500ms)`     | Performance check               | bin-scripts.boundary.test.ts |

### Manual Testing Checklist

- [ ] Start workspace, run `opencode`, create a session with some messages
- [ ] Exit opencode (Ctrl+C), run `opencode` again in same terminal
- [ ] Verify same session is restored (check session ID in TUI)
- [ ] Switch to different agent mode (e.g., `/agent plan`)
- [ ] Exit and restart opencode
- [ ] Verify agent mode is restored (should start in plan mode)
- [ ] Test in a workspace with no prior sessions - should start fresh
- [ ] Test with sub-agent sessions present - should only restore root sessions
- [ ] Test with multiple workspaces in same project - verify directory filtering works
- [ ] Test with session that has no messages - should restore session without agent
- [ ] Test with very long session list (>100 sessions) - should still work
- [ ] Test with OpenCode server not running (CODEHYDRA_OPENCODE_PORT set but server down) - graceful error
- [ ] Test on Windows with backslash paths in session.directory - should match correctly

## Dependencies

No new dependencies required. Uses Node.js built-in `http` module.

## Documentation Updates

### Files to Update

| File      | Changes Required                                                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AGENTS.md | Update Session Restoration section (line 230) to add: "and restores the agent mode from the session's most recent user message." Remove `OPENCODE_DEBUG=1` line (line 233). |

### New Documentation Required

None.

## Definition of Done

- [ ] All implementation steps complete
- [ ] `npm run validate:fix` passes
- [ ] Documentation updated
- [ ] User acceptance testing passed
- [ ] Changes committed
