"use client";

import { useCallback, useEffect, useRef } from "react";

export interface UseSyncPollingOptions {
  /** Polling interval in milliseconds (default: 3000) */
  intervalMs?: number;
  /** Safety timeout in milliseconds after which polling stops unconditionally (default: 5 minutes) */
  safetyTimeoutMs?: number;
  /**
   * Called on each poll tick. Should return `true` when the sync is complete
   * (which will stop polling), or `false` to keep polling. Any thrown error also stops polling.
   */
  onPoll: () => Promise<boolean>;
  /** Called after polling stops because sync completed (onPoll returned true). */
  onComplete: () => void;
}

export interface UseSyncPollingReturn {
  /** Start polling. Stops any previously active poll first. */
  startPolling: () => void;
  /** Stop polling immediately. In-flight requests are discarded via a ref guard. */
  stopPolling: () => void;
}

/**
 * Shared hook that encapsulates repeating poll-for-completion logic:
 * - setInterval at `intervalMs`
 * - A safety timeout at `safetyTimeoutMs`
 * - An `isPolling` ref guard that prevents stale in-flight responses from causing side-effects
 * - Automatic cleanup on unmount
 *
 * Usage:
 * ```ts
 * const { startPolling, stopPolling } = useSyncPolling({
 *   onPoll: async () => {
 *     const res = await getLdapStatus();
 *     return !res.data.syncInProgress; // true = done
 *   },
 *   onComplete: () => {
 *     queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
 *   },
 * });
 * ```
 */
export function useSyncPolling({
  intervalMs = 3_000,
  safetyTimeoutMs = 5 * 60 * 1_000,
  onPoll,
  onComplete,
}: UseSyncPollingOptions): UseSyncPollingReturn {
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Guard ref: set to true when polling starts, false when it stops.
   * Checked inside the async poll callback so any in-flight response received
   * after stopPolling() is a no-op (fixes PF-F-M-6).
   */
  const isPollingRef = useRef(false);

  const stopPolling = useCallback(() => {
    isPollingRef.current = false;

    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    // Stop any existing poll first
    stopPolling();

    isPollingRef.current = true;

    pollIntervalRef.current = setInterval(async () => {
      try {
        const done = await onPoll();
        // Discard result if polling was stopped while the request was in-flight
        if (!isPollingRef.current) return;
        if (done) {
          stopPolling();
          onComplete();
        }
      } catch {
        // On error, stop polling unconditionally
        if (isPollingRef.current) {
          stopPolling();
        }
      }
    }, intervalMs);

    // Safety timeout: stop polling after safetyTimeoutMs regardless of status
    pollTimeoutRef.current = setTimeout(() => stopPolling(), safetyTimeoutMs);
  }, [intervalMs, safetyTimeoutMs, onPoll, onComplete, stopPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return { startPolling, stopPolling };
}
