"use client";

import { AlertTriangle, Check, Download, File, Mail, UploadCloud } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Animated per-member quota bars (one runs hot in amber). */
export function QuotaBars() {
  const rm = useReducedMotion();
  const rows = [
    { id: "AM", pct: 82, warn: true },
    { id: "JD", pct: 64, warn: false },
    { id: "TL", pct: 38, warn: false },
  ];
  return (
    <div className="mt-5 space-y-2.5">
      {rows.map((r, i) => (
        <div key={r.id} className="flex items-center gap-2.5">
          <span className="flex size-6 items-center justify-center rounded-full bg-brand/10 text-[10px] font-medium text-brand ring-1 ring-brand/20">
            {r.id}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-fd-secondary">
            <motion.div
              className={cn("h-full rounded-full", r.warn ? "bg-amber-500" : "bg-gradient-brand")}
              initial={rm ? false : { width: 0 }}
              whileInView={{ width: `${r.pct}%` }}
              viewport={{ once: true }}
              transition={{ duration: 0.9, delay: i * 0.12, ease: EASE }}
            />
          </div>
          <span className="w-9 text-right font-mono text-[11px] text-fd-muted-foreground">
            {r.pct}%
          </span>
        </div>
      ))}
    </div>
  );
}

/** Staggered, log-style audit feed with a live indicator. */
export function AuditFeed() {
  const rm = useReducedMotion();
  const lines = [
    { t: "09:42", a: "download", d: "ip 10.0.0.4" },
    { t: "09:41", a: "access", d: "user@corp" },
    { t: "09:38", a: "login", d: "2FA ✓" },
  ];
  return (
    <div className="mt-5 space-y-1.5">
      {lines.map((l, i) => (
        <motion.div
          key={l.a}
          className="flex items-center gap-2 rounded-md border border-fd-border bg-fd-background/60 px-2 py-1 font-mono text-[11px]"
          initial={rm ? false : { opacity: 0, x: -8 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: i * 0.15, ease: EASE }}
        >
          <span className="text-fd-muted-foreground/60">{l.t}</span>
          <span className="rounded bg-brand/10 px-1.5 text-brand">{l.a}</span>
          <span className="truncate text-fd-muted-foreground">{l.d}</span>
        </motion.div>
      ))}
    </div>
  );
}

/** Directory → users sync with dots flowing along the wire. */
export function SyncFlow() {
  const rm = useReducedMotion();
  const avatars = ["bg-brand", "bg-brand-from", "bg-brand-to"];
  return (
    <div className="mt-6 flex items-center gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-fd-border bg-fd-background/60 font-mono text-xs font-medium text-fd-muted-foreground">
        AD
      </div>
      <div className="relative h-px flex-1 bg-fd-border">
        {!rm &&
          [0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-brand"
              initial={{ left: "0%", opacity: 0 }}
              animate={{ left: "100%", opacity: [0, 1, 1, 0] }}
              transition={{
                duration: 1.8,
                delay: i * 0.6,
                repeat: Number.POSITIVE_INFINITY,
                ease: "linear",
              }}
            />
          ))}
      </div>
      <div className="flex -space-x-2">
        {avatars.map((c, i) => (
          <motion.span
            key={c}
            className={cn("size-6 rounded-full ring-2 ring-fd-card", c)}
            initial={rm ? false : { scale: 0, opacity: 0 }}
            whileInView={{ scale: 1, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.4 + i * 0.15, type: "spring", stiffness: 320, damping: 20 }}
          />
        ))}
      </div>
    </div>
  );
}

/** A small stack of notifications sliding in. */
export function NotificationStack() {
  const rm = useReducedMotion();
  const items = [Mail, Download, AlertTriangle];
  return (
    <div className="mt-5 space-y-2">
      {items.map((Icon, i) => (
        <motion.div
          key={Icon.displayName ?? i}
          className="flex items-center gap-2.5 rounded-lg border border-fd-border bg-fd-background/60 p-2"
          initial={rm ? false : { opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: i * 0.12, ease: EASE }}
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
            <Icon className="size-3.5" />
          </span>
          <div className="flex-1 space-y-1">
            <div className="h-1.5 w-2/3 rounded-full bg-fd-secondary" />
            <div className="h-1.5 w-1/3 rounded-full bg-fd-secondary/60" />
          </div>
        </motion.div>
      ))}
    </div>
  );
}

/** A reverse-share drop zone with a bobbing upload arrow and a landed file. */
export function ReverseUpload() {
  const rm = useReducedMotion();
  return (
    <div className="mt-5">
      <div className="flex items-center justify-center rounded-xl border border-dashed border-brand/40 bg-brand/5 py-4">
        <motion.div
          animate={rm ? undefined : { y: [0, -4, 0] }}
          transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        >
          <UploadCloud className="size-6 text-brand" />
        </motion.div>
      </div>
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-fd-border bg-fd-background/60 p-2">
        <File className="size-4 shrink-0 text-fd-muted-foreground" />
        <div className="h-1.5 flex-1 rounded-full bg-fd-secondary" />
        <Check className="size-3.5 shrink-0 text-emerald-500" />
      </div>
    </div>
  );
}
