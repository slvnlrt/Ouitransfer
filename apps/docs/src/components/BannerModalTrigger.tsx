"use client";

import type { ReactNode } from "react";

/** Dispatches a custom DOM event that V1BetaModal listens to, opening the modal. */
export function BannerModalTrigger({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("open-v1-beta-modal"))}
      className="cursor-pointer rounded-full bg-white/80 px-4 py-0.5 dark:bg-black/65"
    >
      {children}
    </button>
  );
}
