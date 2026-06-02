"use client";

import { Check, Copy, FileArchive, Link2, Lock, UploadCloud } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import type { SiteContent } from "@/lib/content-i18n";

type Phase = "uploading" | "ready";

/**
 * Self-looping mockup of an OUITRANSFER upload: a file streams up, the
 * progress bar fills, then a shareable link appears — the product's core
 * promise, animated. Pauses on `prefers-reduced-motion` (shows the end state).
 */
export function TransferCard({ demo }: { demo: SiteContent["home"]["demo"] }) {
  const reduceMotion = useReducedMotion();
  const [progress, setProgress] = useState(reduceMotion ? 100 : 0);
  const [phase, setPhase] = useState<Phase>(reduceMotion ? "ready" : "uploading");

  useEffect(() => {
    if (reduceMotion) return;

    let raf = 0;
    let value = 0;
    let mode: Phase = "uploading";
    let readyAt = 0;

    const tick = (now: number) => {
      if (mode === "uploading") {
        value = Math.min(100, value + 1.25);
        setProgress(value);
        if (value >= 100) {
          mode = "ready";
          readyAt = now;
          setPhase("ready");
        }
      } else if (now - readyAt > 2800) {
        value = 0;
        mode = "uploading";
        setProgress(0);
        setPhase("uploading");
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduceMotion]);

  const rounded = Math.round(progress);

  return (
    <div className="relative w-full max-w-md">
      {/* Slowly rotating conic halo behind the card */}
      <div
        aria-hidden
        className="absolute -inset-10 -z-10 animate-spin-slow rounded-full opacity-30 blur-2xl"
        style={{
          background:
            "conic-gradient(from 0deg, var(--brand-from), var(--brand-via), var(--brand-to), var(--brand-from))",
        }}
      />

      <div className="rounded-2xl border border-white/15 bg-fd-card/70 p-5 shadow-2xl shadow-black/10 backdrop-blur-xl dark:shadow-black/40">
        {/* Window chrome */}
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="size-3 rounded-full bg-red-400/80" />
            <span className="size-3 rounded-full bg-amber-400/80" />
            <span className="size-3 rounded-full bg-emerald-400/80" />
          </div>
          <span className="font-mono text-xs text-fd-muted-foreground">{demo.label}</span>
        </div>

        {/* File row */}
        <div className="flex items-center gap-3 rounded-xl border border-fd-border bg-fd-background/60 p-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-gradient-brand text-white">
            <FileArchive className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-fd-foreground">{demo.file}</p>
            <p className="text-xs text-fd-muted-foreground">{demo.size}</p>
          </div>
          <span className="flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2 py-1 text-[11px] font-medium text-brand">
            <Lock className="size-3" />
            {demo.encrypted}
          </span>
        </div>

        {/* Progress */}
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-medium text-fd-foreground">
              {phase === "uploading" ? (
                <UploadCloud className="size-3.5 text-brand" />
              ) : (
                <Check className="size-3.5 text-emerald-500" />
              )}
              {phase === "uploading" ? demo.uploading : demo.ready}
            </span>
            <span className="font-mono text-fd-muted-foreground">{rounded}%</span>
          </div>
          <div className="relative h-2 overflow-hidden rounded-full bg-fd-secondary">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-brand transition-[width] duration-100 ease-linear"
              style={{ width: `${progress}%` }}
            />
            {phase === "uploading" && !reduceMotion && (
              <div className="absolute inset-y-0 left-0 w-1/3 animate-shimmer bg-gradient-to-r from-transparent via-white/50 to-transparent" />
            )}
          </div>
        </div>

        {/* Result link */}
        <div className="mt-4 min-h-[3.25rem]">
          <AnimatePresence mode="wait">
            {phase === "ready" ? (
              <motion.div
                key="link"
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3 }}
                className="flex items-center gap-2 rounded-xl border border-brand/30 bg-brand/5 p-2 pl-3"
              >
                <Link2 className="size-4 shrink-0 text-brand" />
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-fd-foreground">
                  {demo.link}
                </span>
                <button
                  type="button"
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-brand px-3 py-1.5 text-xs font-medium text-white"
                >
                  <Copy className="size-3.5" />
                  {demo.copy}
                </button>
              </motion.div>
            ) : (
              <motion.p
                key="expires"
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="pt-3 text-center text-xs text-fd-muted-foreground"
              >
                {demo.expires}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
