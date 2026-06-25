"use client";

import { useCallback, useRef, useState } from "react";

interface UseCopyToClipboardOptions {
  /** Time in milliseconds before `copied` resets to `false`. Defaults to 2000. */
  timeout?: number;
}

interface UseCopyToClipboardReturn {
  /** Whether the last copy operation succeeded and hasn't timed out yet. */
  copied: boolean;
  /** Copy the given text to the clipboard. Returns `true` on success. */
  copy: (text: string) => Promise<boolean>;
}

/**
 * Hook that wraps `navigator.clipboard.writeText` with a self-resetting
 * `copied` flag. Handles errors silently and cleans up timers on unmount.
 */
export function useCopyToClipboard(
  options: UseCopyToClipboardOptions = {},
): UseCopyToClipboardReturn {
  const { timeout = 2000 } = options;
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);

        // Clear any existing timer before starting a new one
        if (timerRef.current !== undefined) {
          clearTimeout(timerRef.current);
        }
        timerRef.current = setTimeout(() => {
          setCopied(false);
          timerRef.current = undefined;
        }, timeout);

        return true;
      } catch {
        // clipboard write failed — return false
        return false;
      }
    },
    [timeout],
  );

  return { copied, copy };
}
