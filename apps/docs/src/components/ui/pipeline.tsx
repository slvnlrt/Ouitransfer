import type { ReactNode } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type StepVariant = "default" | "trigger" | "warn" | "muted" | "success";

const stepCls: Record<StepVariant, string> = {
  default: "bg-card border border-border text-foreground shadow-sm",
  trigger:
    "bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 text-sky-900 dark:text-sky-100",
  warn: "bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-foreground",
  muted: "bg-muted border border-border text-muted-foreground",
  success:
    "bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200",
};

const accentCls: Record<StepVariant, string> = {
  default: "bg-indigo-500 dark:bg-indigo-400",
  trigger: "bg-sky-400 dark:bg-sky-500",
  warn: "bg-amber-400 dark:bg-amber-500",
  muted: "bg-muted-foreground/30",
  success: "bg-emerald-500 dark:bg-emerald-400",
};

const badgeCls: Record<StepVariant, string> = {
  default: "bg-muted text-muted-foreground",
  trigger: "bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300",
  warn: "bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300",
  muted: "bg-border text-muted-foreground",
  success:
    "bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300",
};

// ─── Pipeline ─────────────────────────────────────────────────────────────────

/**
 * Outer container — wraps to the width of its widest child.
 * Narrower children are automatically centered.
 */
export function Pipeline({ children }: { children: ReactNode }) {
  return (
    <div className="not-prose my-8 mx-auto flex w-fit max-w-full flex-col items-center">
      {children}
    </div>
  );
}

// ─── Arrow ────────────────────────────────────────────────────────────────────

/** Downward connector between steps */
export function PipelineArrow() {
  return (
    <div className="flex flex-col items-center py-1" aria-hidden="true">
      <div className="h-5 w-0.5 bg-border" />
      {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative */}
      <svg width="10" height="6" viewBox="0 0 10 6" className="fill-border">
        <path d="M5 6L0 0h10z" />
      </svg>
    </div>
  );
}

// ─── Step ─────────────────────────────────────────────────────────────────────

/**
 * A single pipeline step — auto-sized to its content.
 * Has a colored left accent stripe for visual identity.
 * Pass a lucide-react icon (or any ReactNode) via the `icon` prop.
 */
export function PipelineStep({
  children,
  badge,
  variant = "default",
  icon,
}: {
  children: ReactNode;
  badge?: string;
  variant?: StepVariant;
  icon?: ReactNode;
}) {
  return (
    <div
      className={`flex min-w-[200px] items-stretch overflow-hidden rounded-xl ${stepCls[variant]}`}
    >
      {/* left accent stripe */}
      <div className={`w-1 shrink-0 ${accentCls[variant]}`} />
      <div className="flex flex-1 items-center justify-between gap-3 px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-medium leading-snug">
          {icon && <span className="shrink-0 opacity-60">{icon}</span>}
          {children}
        </span>
        {badge && (
          <span
            className={`ml-1 shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeCls[variant]}`}
          >
            {badge}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Triggers ─────────────────────────────────────────────────────────────────

/** Horizontal row of trigger sources (entry points into the pipeline) */
export function PipelineTriggers({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-center gap-2">{children}</div>
  );
}

// ─── Parallel group ───────────────────────────────────────────────────────────

/**
 * Steps that run in parallel, displayed side by side.
 * The dashed border signals concurrent execution.
 */
export function PipelineParallel({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-3.5">
      {label && (
        <p className="mb-3 text-center text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">{children}</div>
    </div>
  );
}

/** Individual item inside PipelineParallel */
export function PipelineParallelItem({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm">
      {children}
    </div>
  );
}

// ─── Fork (branching) ─────────────────────────────────────────────────────────

/** Decision gate — diamond shape + side-by-side branches */
export function PipelineFork({
  question,
  children,
}: {
  question: string;
  children: ReactNode;
}) {
  return (
    <div>
      {/* Diamond */}
      <div className="mb-3 flex justify-center">
        <div className="relative flex h-16 w-16 items-center justify-center">
          <div className="absolute inset-0 rotate-45 rounded-md border border-border bg-muted shadow-sm" />
          <span className="relative z-10 px-2 text-center text-[11px] font-bold leading-tight text-foreground">
            {question}
          </span>
        </div>
      </div>
      {/* Branches side by side */}
      <div className="flex items-start justify-center gap-6">{children}</div>
    </div>
  );
}

/** A single branch within a PipelineFork */
export function PipelineForkBranch({
  label,
  highlight = false,
  children,
}: {
  label: string;
  highlight?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-[140px] flex-col items-center">
      {/* branch label pill */}
      <span
        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
          highlight
            ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {label}
      </span>
      {/* short connector */}
      <div className="flex justify-center py-0.5">
        <div className="h-3 w-0.5 bg-border" />
      </div>
      {/* branch steps */}
      <div className="flex flex-col items-center">{children}</div>
    </div>
  );
}
