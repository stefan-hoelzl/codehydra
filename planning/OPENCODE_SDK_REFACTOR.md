---
status: COMPLETED
last_updated: 2025-01-12
reviewers: [review-typescript, review-arch, review-testing, review-senior, review-docs]
---

# OPENCODE_SDK_REFACTOR

## Overview

- **Problem**: OpenCodeClient manually implements HTTP requests and SSE handling via custom network interfaces (HttpClient, SseClient). This duplicates functionality already provided by the official `@opencode-ai/sdk` package, which is maintained by the OpenCode team.
- **Solution**: Refactor OpenCodeClient to use the SDK internally, keeping our callback-based API but delegating HTTP/SSE to the SDK. Remove now-unused SSE infrastructure from the network layer.
- **Risks**:
  - SDK behavior may differ from our implementation (reconnection timing, error handling)
  - SDK is a runtime dependency that could introduce breaking changes
  - Unit tests need significant rewrite to mock SDK instead of network interfaces
  - **Breaking change**: `connect()` signature changes from sync to async
- **Alternatives Considered**:
  - Keep current implementation: Rejected - maintains duplicate code, our SSE implementation may drift from OpenCode's expectations
  - Use SDK directly without wrapper: Rejected - loses our root session filtering and status aggregation logic

## SDK Verification (Step 0 - Completed)

The SDK exists and provides the APIs we need:

```typescript
// Installation
npm install @opencode-ai/sdk

// Client-only mode (what we need - connects to existing server)
import { createOpencodeClient } from "@opencode-ai/sdk"
const client = createOpencodeClient({ baseUrl: "http://localhost:4096" })

// Session APIs
await client.session.list()           // GET /session
await client.session.get({ path: { id } })

// Event subscription (SSE)
const events = await client.event.subscribe()
for await (const event of events.stream) {
  console.log(event.type, event.properties)
}

// Types are exported
import type { Session, Message } from "@opencode-ai/sdk"
```

**SDK Package**: `@opencode-ai/sdk` (NOT `opencode-ai` which is CLI only)

## Architecture

### Current Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        OpenCodeClient                                │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    Business Logic                            │    │
│  │  • Root session filtering                                    │    │
│  │  • Status aggregation (any busy = busy)                      │    │
│  │  • Callback management                                       │    │
│  │  • currentStatus tracking                                    │    │
│  └──────────────────────┬──────────────────────────────────────┘    │
│                         │                                            │
│  ┌──────────────────────┴──────────────────────────────────────┐    │
│  │              Network Layer (injected)                        │    │
│  │                                                              │    │
│  │  HttpClient ───────► fetch() ───────► HTTP requests          │    │
│  │  SseClient ────────► createSseConnection() ──► SSE stream    │    │
│  │                                                              │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### New Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        OpenCodeClient                                │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    Business Logic                            │    │
│  │  • Root session filtering         (KEEP - our logic)        │    │
│  │  • Status aggregation             (KEEP - our logic)        │    │
│  │  • Callback management            (KEEP - our API)          │    │
│  │  • currentStatus tracking         (KEEP - our logic)        │    │
│  └──────────────────────┬──────────────────────────────────────┘    │
│                         │                                            │
│  ┌──────────────────────┴──────────────────────────────────────┐    │
│  │                  @opencode-ai/sdk                            │    │
│  │                                                              │    │
│  │  client.session.list() ────────► GET /session                │    │
│  │  client.event.subscribe() ─────► SSE /event                  │    │
│  │                                                              │    │
│  │  (SDK handles HTTP, SSE, reconnection internally)            │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Network Layer Changes

```
┌─────────────────────────────────────────────────────────────────────┐
│                    DefaultNetworkLayer                               │
│                                                                      │
│  BEFORE                              AFTER                           │
│  ──────                              ─────                           │
│  ┌─────────────────────┐            ┌─────────────────────┐         │
│  │ HttpClient          │            │ HttpClient          │ KEEP    │
│  │ • fetch()           │            │ • fetch()           │         │
│  └─────────────────────┘            └─────────────────────┘         │
│                                                                      │
│  ┌─────────────────────┐                                            │
│  │ SseClient           │            REMOVE                          │
│  │ • createSseConn()   │            (SDK handles SSE)               │
│  └─────────────────────┘                                            │
│                                                                      │
│  ┌─────────────────────┐            ┌─────────────────────┐         │
│  │ PortManager         │            │ PortManager         │ KEEP    │
│  │ • findFreePort()    │            │ • findFreePort()    │         │
│  │ • getListeningPorts │            │ • getListeningPorts │         │
│  └─────────────────────┘            └─────────────────────┘         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

Removed Components:
  • SseClient interface
  • SseConnection interface
  • SseConnectionOptions interface
  • DefaultSseConnection class (~110 lines)
  • createSseConnection() method
  • createEventSource() method
```

## Implementation Steps

### Phase 0: Prerequisites

- [x] **Step 0.1: Install SDK as runtime dependency**
  - Run: `npm install @opencode-ai/sdk`
  - Verify it moves to `dependencies` (not `devDependencies`)
  - Pin to exact version (no `^` prefix) to prevent breaking changes
  - Files affected: `package.json`, `package-lock.json`
  - Test criteria: `npm ls @opencode-ai/sdk` shows package in dependencies

### Phase 1: Test Infrastructure (TDD - Red Phase)

- [x] **Step 1.1: Create SDK mock utilities**
  - Create `src/services/opencode/sdk-test-utils.ts`
  - Implement `createMockSdkClient()` with configurable responses
  - Implement `createMockEventStream(events[])` for async iterable testing
  - Document SDK types being mocked
  - Files affected: `src/services/opencode/sdk-test-utils.ts` (new)
  - Test criteria: Mock utilities have their own tests

- [x] **Step 1.2: Write failing tests for new OpenCodeClient**
  - Write tests expecting SDK-based constructor
  - Write tests expecting async `connect()` returning `Promise<void>`
  - Write tests for SDK error → OpenCodeError mapping
  - Keep all business logic tests (filtering, aggregation, callbacks)
  - Files affected: `src/services/opencode/opencode-client.test.ts`
  - Test criteria: Tests fail (RED phase)

### Phase 2: SDK Integration (TDD - Green Phase)

- [x] **Step 2.1: Refactor OpenCodeClient with DI**
  - Keep dependency injection for testability:

    ```typescript
    import { createOpencodeClient, type Client } from "@opencode-ai/sdk";

    export type SdkClientFactory = (baseUrl: string) => Client;

    const defaultFactory: SdkClientFactory = (baseUrl) => createOpencodeClient({ baseUrl });

    export class OpenCodeClient implements IDisposable {
      private readonly sdk: Client;
      private abortController: AbortController | undefined;

      constructor(port: number, sdkFactory: SdkClientFactory = defaultFactory) {
        this.baseUrl = `http://localhost:${port}`;
        this.sdk = sdkFactory(this.baseUrl);
      }
    }
    ```

  - Files affected: `src/services/opencode/opencode-client.ts`
  - Test criteria: Constructor tests pass

- [x] **Step 2.2: Implement async connect() with error handling**
  - Change signature: `connect(): void` → `async connect(): Promise<void>`
  - Add timeout parameter with default (5000ms)
  - Add AbortController for cancellation
  - Add proper error handling with logging:

    ```typescript
    async connect(timeoutMs = 5000): Promise<void> {
      if (this.disposed || this.eventSubscription) return

      this.abortController = new AbortController()

      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Connect timeout')), timeoutMs)
        )

        const events = await Promise.race([
          this.sdk.event.subscribe(),
          timeoutPromise
        ])

        this.eventSubscription = events

        // Process events in background with error handling
        this.processEvents(events.stream).catch((err) => {
          if (!this.disposed) {
            console.error('Event processing error:', err)
          }
        })

        // Sync initial status with error handling
        try {
          const result = await this.getStatus()
          if (result.ok) this.updateCurrentStatus(result.value)
        } catch (err) {
          console.error('Failed to fetch initial status:', err)
        }
      } catch (err) {
        console.error('Failed to connect:', err)
        throw err
      }
    }
    ```

  - Files affected: `src/services/opencode/opencode-client.ts`
  - Test criteria: connect() tests pass

- [x] **Step 2.3: Implement event processing with proper cleanup**

  ```typescript
  private async processEvents(stream: AsyncIterable<SdkEvent>): Promise<void> {
    try {
      for await (const event of stream) {
        if (this.disposed) break
        this.handleSdkEvent(event)
      }
    } catch (error) {
      if (this.disposed) return // Expected during shutdown
      console.error('Event stream error:', error)
      throw error // Re-throw for .catch() handler
    }
  }

  private handleSdkEvent(event: SdkEvent): void {
    // Map SDK event to our internal types
    switch (event.type) {
      case 'session.status':
        this.handleSessionStatus(event.properties)
        break
      case 'session.created':
        this.handleSessionCreated(event.properties)
        break
      // ... etc
    }
  }
  ```

  - Files affected: `src/services/opencode/opencode-client.ts`
  - Test criteria: Event handling tests pass

- [x] **Step 2.4: Implement SDK error → OpenCodeError mapping**
  - Create adapter layer for SDK errors:
    ```typescript
    private mapSdkError(error: unknown): OpenCodeError {
      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          return new OpenCodeError('Request timeout', 'TIMEOUT')
        }
        if (error.message.includes('ECONNREFUSED')) {
          return new OpenCodeError('Connection refused', 'CONNECTION_REFUSED')
        }
        return new OpenCodeError(error.message, 'REQUEST_FAILED')
      }
      return new OpenCodeError('Unknown error', 'REQUEST_FAILED')
    }
    ```
  - Files affected: `src/services/opencode/opencode-client.ts`
  - Test criteria: Error mapping tests pass

- [x] **Step 2.5: Update disconnect() and dispose()**

  ```typescript
  disconnect(): void {
    this.abortController?.abort()
    this.eventSubscription = undefined
  }

  dispose(): void {
    this.disposed = true
    this.disconnect()
    this.listeners.clear()
    this.permissionListeners.clear()
    this.statusListeners.clear()
  }
  ```

  - Files affected: `src/services/opencode/opencode-client.ts`
  - Test criteria: Lifecycle tests pass

- [x] **Step 2.6: Update getStatus() and fetchRootSessions()**
  - Use SDK methods instead of HttpClient
  - Wrap SDK calls with error mapping
  - Files affected: `src/services/opencode/opencode-client.ts`
  - Test criteria: All unit tests pass (GREEN phase)

### Phase 3: Update Callers

- [x] **Step 3.1: Update AgentStatusManager**
  - Remove HttpClient/SseClient from constructor
  - Update OpenCodeClient instantiation
  - **Update connect() calls to await**:

    ```typescript
    // Before
    client.connect();

    // After
    await client.connect();
    // OR
    client.connect().catch((err) => console.error("Connect failed:", err));
    ```

  - Files affected: `src/services/opencode/agent-status-manager.ts`
  - Test criteria: Manager creates clients correctly, awaits connect

- [x] **Step 3.2: Update AgentStatusManager Tests**
  - Use new SDK mock utilities
  - Test async connect() behavior
  - Test connect failure handling
  - Files affected: `src/services/opencode/agent-status-manager.test.ts`
  - Test criteria: All tests pass

- [x] **Step 3.3: Update Main Process Wiring**
  - Remove HttpClient/SseClient injection for OpenCode
  - Update service instantiation in `src/services/index.ts`
  - Update `src/main/index.ts` if needed
  - Files affected: `src/services/index.ts`, `src/main/index.ts`
  - Test criteria: App starts correctly

### Phase 4: Network Layer Cleanup

- [x] **Step 4.1: Remove SSE Implementation (before interfaces)**
  - Remove DefaultSseConnection class
  - Remove createSseConnection() from DefaultNetworkLayer
  - Remove createEventSource() from DefaultNetworkLayer
  - Files affected: `src/services/platform/network.ts`
  - Test criteria: No compile errors

- [x] **Step 4.2: Remove SSE Interfaces**
  - Remove SseClient interface
  - Remove SseConnection interface
  - Remove SseConnectionOptions interface
  - Files affected: `src/services/platform/network.ts`
  - Test criteria: No compile errors, ~150 lines removed

- [x] **Step 4.3: Remove SSE Test Utilities**
  - Remove createMockSseClient()
  - Remove createMockSseConnection()
  - Files affected: `src/services/platform/network.test-utils.ts`
  - Test criteria: No compile errors

- [x] **Step 4.4: Remove SSE Unit Tests**
  - Remove SSE-related tests from network.test.ts
  - Files affected: `src/services/platform/network.test.ts`
  - Test criteria: Remaining tests pass

- [x] **Step 4.5: Update SSE Boundary Tests**
  - Keep minimal boundary tests that verify SDK's SSE works with real OpenCode
  - Refactor to test via SDK instead of custom SSE
  - Files affected: `src/services/platform/network.boundary.test.ts`
  - Test criteria: Boundary tests pass

### Phase 5: Documentation Updates

- [x] **Step 5.1: Update AGENTS.md**
  - Rewrite NetworkLayer Pattern section (lines 298-354)
  - Remove SseClient interface documentation
  - Remove SSE connection lifecycle section (lines 438-461)
  - Remove SSE wire format section (lines 453-461)
  - Remove SseClient mock factory documentation
  - Add SDK client usage pattern with examples
  - Files affected: `AGENTS.md`
  - Test criteria: Documentation accurate

- [x] **Step 5.2: Update docs/ARCHITECTURE.md**
  - Remove SseClient row from interface table (lines 193-197)
  - Remove SSE Auto-Reconnection section (lines 211-237)
  - Remove SseClient mock factory row (lines 239-263)
  - Add new section "SDK-Based OpenCode Client"
  - Files affected: `docs/ARCHITECTURE.md`
  - Test criteria: Documentation accurate

### Phase 6: Boundary Tests (Optional - Can be separate plan)

- [ ] **Step 6.1: Create minimal boundary test**
  - Single test connecting to real OpenCode server
  - Verify SDK event subscription works
  - Files affected: `src/services/opencode/opencode-client.boundary.test.ts` (new)
  - Test criteria: Test passes with real opencode serve

- [ ] **Step 6.2: Add additional boundary tests as needed**
  - Only if time permits
  - Consider deferring to separate plan
  - Files affected: `src/services/opencode/opencode-client.boundary.test.ts`
  - Test criteria: Tests pass

## Testing Strategy

### Unit Tests (Keep - Business Logic)

| Test Category          | Description                             | Why Keep             |
| ---------------------- | --------------------------------------- | -------------------- |
| Root session filtering | Only emit for sessions without parentID | Our logic, not SDK's |
| Status aggregation     | Any busy/retry = overall busy           | Our logic            |
| currentStatus tracking | Deduplicate, only fire on change        | Our logic            |
| Callback management    | Subscribe, unsubscribe, dispose         | Our API              |
| Type guards            | Validate event structures               | Our code             |
| Error mapping          | SDK error → OpenCodeError               | Our adapter          |
| Async connect()        | Timeout, cancellation, error handling   | New behavior         |

### Unit Tests (Remove - SDK Handles)

| Test Category               | Why Remove  |
| --------------------------- | ----------- |
| HTTP error handling details | SDK handles |
| URL construction            | SDK handles |
| SSE reconnection timing     | SDK handles |
| Response JSON parsing       | SDK handles |

### SDK Mock Utilities

```typescript
// src/services/opencode/sdk-test-utils.ts

import type { Client } from "@opencode-ai/sdk";

export interface MockSdkOptions {
  sessions?: Session[];
  eventStream?: AsyncIterable<SdkEvent>;
  throwOnSubscribe?: Error;
}

export function createMockSdkClient(options: MockSdkOptions = {}): Client {
  return {
    session: {
      list: vi.fn().mockResolvedValue(options.sessions ?? []),
      get: vi.fn(),
      // ... other methods
    },
    event: {
      subscribe: options.throwOnSubscribe
        ? vi.fn().mockRejectedValue(options.throwOnSubscribe)
        : vi.fn().mockResolvedValue({ stream: options.eventStream ?? createEmptyStream() }),
    },
    // ... other namespaces
  } as unknown as Client;
}

export async function* createMockEventStream(events: SdkEvent[]): AsyncIterable<SdkEvent> {
  for (const event of events) {
    yield event;
  }
}

export function createEmptyStream(): AsyncIterable<SdkEvent> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => new Promise(() => {}), // Never resolves
    }),
  };
}
```

### Coverage Verification

Before and after refactor, run:

```bash
npm run test -- --coverage --reporter=json
```

Verify:

- No decrease in coverage for `opencode-client.ts` business logic
- Document removed test categories in commit message

## Dependencies

| Package            | Purpose                  | Approved |
| ------------------ | ------------------------ | -------- |
| `@opencode-ai/sdk` | Official OpenCode client | [x]      |

**Installation**:

```bash
npm install @opencode-ai/sdk --save-exact
```

**Note**: Use `--save-exact` to pin version and prevent automatic breaking changes.

## Definition of Done

- [ ] SDK installed as runtime dependency (exact version pinned)
- [ ] SDK mock utilities created and tested
- [ ] OpenCodeClient refactored with DI for testability
- [ ] `connect()` is async with timeout and cancellation
- [ ] Error mapping from SDK to OpenCodeError
- [ ] All callers updated to await connect()
- [ ] SSE code removed from network layer (~150 lines)
- [ ] Unit tests updated with SDK mocks
- [ ] Coverage maintained for business logic
- [ ] AGENTS.md updated (NetworkLayer section rewritten)
- [ ] docs/ARCHITECTURE.md updated
- [ ] `npm run validate:fix` passes
- [ ] User acceptance testing passed
- [ ] Changes committed

## Code Examples

### OpenCodeClient Constructor (Before)

```typescript
constructor(
  port: number,
  private readonly httpClient: HttpClient,
  private readonly sseClient: SseClient
) {
  this.baseUrl = `http://localhost:${port}`;
}
```

### OpenCodeClient Constructor (After)

```typescript
import { createOpencodeClient, type Client } from "@opencode-ai/sdk"

export type SdkClientFactory = (baseUrl: string) => Client

const defaultFactory: SdkClientFactory = (baseUrl) =>
  createOpencodeClient({ baseUrl })

// In class:
constructor(
  port: number,
  sdkFactory: SdkClientFactory = defaultFactory
) {
  this.baseUrl = `http://localhost:${port}`;
  this.sdk = sdkFactory(this.baseUrl);
}
```

### connect() Method (Before)

```typescript
connect(): void {
  if (this.disposed || this.sseConnection) return;

  this.sseConnection = this.sseClient.createSseConnection(`${this.baseUrl}/event`);

  this.sseConnection.onMessage((data: string) => {
    this.handleRawMessage(data);
  });

  this.sseConnection.onStateChange((connected: boolean) => {
    if (connected) {
      void this.getStatus().then((result) => {
        if (result.ok) this.updateCurrentStatus(result.value);
      });
    }
  });
}
```

### connect() Method (After)

```typescript
async connect(timeoutMs = 5000): Promise<void> {
  if (this.disposed || this.eventSubscription) return;

  this.abortController = new AbortController();

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connect timeout')), timeoutMs)
    );

    const events = await Promise.race([
      this.sdk.event.subscribe(),
      timeoutPromise
    ]);

    this.eventSubscription = events;

    // Process events in background with error handling
    this.processEvents(events.stream).catch((err) => {
      if (!this.disposed) {
        console.error('Event processing error:', err);
      }
    });

    // Sync initial status
    try {
      const result = await this.getStatus();
      if (result.ok) this.updateCurrentStatus(result.value);
    } catch (err) {
      console.error('Failed to fetch initial status:', err);
    }
  } catch (err) {
    console.error('Failed to connect:', err);
    throw err;
  }
}

private async processEvents(stream: AsyncIterable<SdkEvent>): Promise<void> {
  try {
    for await (const event of stream) {
      if (this.disposed) break;
      this.handleSdkEvent(event);
    }
  } catch (error) {
    if (this.disposed) return;
    console.error('Event stream error:', error);
    throw error;
  }
}
```

### Caller Update Example

```typescript
// AgentStatusManager - Before
this.client.connect();

// AgentStatusManager - After
await this.client.connect();
// OR for fire-and-forget with error handling:
this.client.connect().catch((err) => {
  console.error("Failed to connect OpenCode client:", err);
});
```

## Risks and Mitigations

| Risk                               | Mitigation                                                             |
| ---------------------------------- | ---------------------------------------------------------------------- |
| SDK reconnection differs from ours | Boundary tests verify reconnection works; document acceptance criteria |
| SDK breaking changes               | Pin exact version, test before updating, review changelog              |
| SDK event format differs           | Type guards validate event structure; add adapter if needed            |
| Performance regression             | Benchmark before/after                                                 |
| Breaking change to connect()       | Document in plan, update all call sites, integration tests             |

## Notes

- SDK package is `@opencode-ai/sdk` (confirmed via docs)
- SDK provides TypeScript types, reducing our type guard burden
- SDK handles EventSource polyfill for Node.js environment
- DI pattern preserved for testability
- Boundary tests can be deferred to separate plan to reduce scope
- Phase order follows TDD: test infrastructure → failing tests → implementation → cleanup
