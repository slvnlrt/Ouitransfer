"use client";

import { useInView, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import type { SiteContent } from "@/lib/content-i18n";

/** Eases a number from 0 to `to` once it scrolls into view. */
function CountUp({ to, duration = 1.4 }: { to: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const reduceMotion = useReducedMotion();
  const [value, setValue] = useState(reduceMotion ? to : 0);

  useEffect(() => {
    if (!inView || reduceMotion) {
      setValue(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / (duration * 1000));
      const eased = 1 - (1 - p) ** 3; // easeOutCubic
      setValue(Math.round(eased * to));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduceMotion, to, duration]);

  return <span ref={ref}>{value}</span>;
}

export function Stats({ content }: { content: SiteContent["home"] }) {
  const s = content.stats;
  const items: { key: string; value: ReactNode; label: string }[] = [
    { key: "languages", value: <CountUp to={23} />, label: s.languages },
    {
      key: "providers",
      value: (
        <>
          <CountUp to={7} />+
        </>
      ),
      label: s.providers,
    },
    { key: "maxSize", value: "∞", label: s.maxSize },
    {
      key: "openSource",
      value: (
        <>
          <CountUp to={100} />%
        </>
      ),
      label: s.openSource,
    },
  ];

  return (
    <section className="mx-auto max-w-screen-xl px-4 sm:px-6 lg:px-8">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-fd-border bg-fd-border md:grid-cols-4">
        {items.map((it) => (
          <div key={it.key} className="bg-fd-card/40 px-6 py-8 text-center backdrop-blur-sm">
            <div className="text-gradient-brand text-4xl font-bold tracking-tight tabular-nums sm:text-5xl">
              {it.value}
            </div>
            <div className="mt-2 text-sm text-fd-muted-foreground">{it.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
