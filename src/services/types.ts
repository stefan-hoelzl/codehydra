/**
 * Shared type definitions for the services layer.
 */

/**
 * Interface for resources that need cleanup.
 * Used by services, managers, and other long-lived objects.
 */
export interface IDisposable {
  dispose(): void | Promise<void>;
}

/**
 * Function to unsubscribe from an event or callback.
 */
export type Unsubscribe = () => void;
