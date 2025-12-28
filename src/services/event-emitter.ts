/**
 * Generic event emitter utility.
 *
 * Provides a simple publish-subscribe pattern for type-safe event handling.
 * Used to reduce boilerplate in services that need callback subscription patterns.
 */

import type { Unsubscribe } from "./types";

/**
 * Generic event emitter for a single event type.
 *
 * @example
 * ```typescript
 * // Define event type
 * type ServerStartedEvent = { port: number; workspacePath: string };
 *
 * // Create emitter
 * private readonly serverStarted = new EventEmitter<ServerStartedEvent>();
 *
 * // Subscribe
 * onServerStarted(callback: (event: ServerStartedEvent) => void): Unsubscribe {
 *   return this.serverStarted.subscribe(callback);
 * }
 *
 * // Emit
 * this.serverStarted.emit({ port: 8080, workspacePath: '/path' });
 * ```
 */
export class EventEmitter<T> {
  private readonly listeners = new Set<(value: T) => void>();

  /**
   * Subscribe to events.
   * @param callback Function to call when event is emitted
   * @returns Unsubscribe function to remove the listener
   */
  subscribe(callback: (value: T) => void): Unsubscribe {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Emit an event to all listeners.
   * @param value The event value to emit
   */
  emit(value: T): void {
    for (const listener of this.listeners) {
      listener(value);
    }
  }

  /**
   * Remove all listeners.
   */
  clear(): void {
    this.listeners.clear();
  }

  /**
   * Get the current number of listeners.
   */
  get listenerCount(): number {
    return this.listeners.size;
  }
}

/**
 * Simple event emitter for void events (no payload).
 *
 * @example
 * ```typescript
 * private readonly disposed = new VoidEventEmitter();
 *
 * onDisposed(callback: () => void): Unsubscribe {
 *   return this.disposed.subscribe(callback);
 * }
 *
 * // Emit
 * this.disposed.emit();
 * ```
 */
export class VoidEventEmitter {
  private readonly listeners = new Set<() => void>();

  /**
   * Subscribe to events.
   * @param callback Function to call when event is emitted
   * @returns Unsubscribe function to remove the listener
   */
  subscribe(callback: () => void): Unsubscribe {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Emit an event to all listeners.
   */
  emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  /**
   * Remove all listeners.
   */
  clear(): void {
    this.listeners.clear();
  }

  /**
   * Get the current number of listeners.
   */
  get listenerCount(): number {
    return this.listeners.size;
  }
}
