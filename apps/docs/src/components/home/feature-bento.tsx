"use client";

import {
  Cloud,
  Container,
  Gauge,
  LayoutDashboard,
  type LucideIcon,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { Reveal } from "@/components/home/reveal";
import type { SiteContent } from "@/lib/content-i18n";
import { cn } from "@/lib/utils";

function IconChip({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div className="inline-flex size-11 items-center justify-center rounded-xl bg-brand/10 text-brand ring-1 ring-brand/20">
      <Icon className="size-5" />
    </div>
  );
}

function BentoCard({
  className,
  icon,
  title,
  description,
  children,
}: {
  className?: string;
  icon: LucideIcon;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border border-fd-border bg-fd-card/40 p-6 transition-all duration-300 hover:border-brand/40 hover:shadow-lg hover:shadow-brand/5",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-24 h-40 bg-brand/10 opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
      />
      <div className="relative flex flex-col">
        <IconChip icon={icon} />
        <h3 className="mt-4 text-lg font-semibold text-fd-foreground">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">{description}</p>
        {children}
      </div>
    </div>
  );
}

/** Three bars that animate to width when the card scrolls into view. */
function SpeedBars() {
  const reduceMotion = useReducedMotion();
  const widths = [92, 74, 58];
  return (
    <div className="mt-5 space-y-2">
      {widths.map((w, i) => (
        <div key={w} className="h-1.5 overflow-hidden rounded-full bg-fd-secondary">
          <motion.div
            className="h-full rounded-full bg-gradient-brand"
            initial={reduceMotion ? false : { width: 0 }}
            whileInView={{ width: `${w}%` }}
            viewport={{ once: true }}
            transition={{ duration: 0.9, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
      ))}
    </div>
  );
}

export function FeatureBento({ content }: { content: SiteContent["home"] }) {
  const f = content.features;

  return (
    <section className="mx-auto max-w-screen-xl px-4 py-20 sm:px-6 md:py-28 lg:px-8">
      <Reveal className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-brand">{f.eyebrow}</p>
        <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight text-fd-foreground sm:text-4xl">
          {f.heading}
        </h2>
        <p className="mt-4 text-pretty text-lg text-fd-muted-foreground">{f.subtitle}</p>
      </Reveal>

      <div className="mt-14 grid gap-4 lg:grid-cols-6">
        {/* Secure — large */}
        <Reveal className="lg:col-span-4" delay={0}>
          <BentoCard
            className="h-full"
            icon={ShieldCheck}
            title={f.secure.title}
            description={f.secure.description}
          >
            <div className="mt-6 flex flex-wrap gap-2">
              {["Password", "Expiry", "Access control", "Encrypted at rest"].map((tag) => (
                <span
                  key={tag}
                  className="rounded-lg border border-fd-border bg-fd-background/60 px-2.5 py-1 font-mono text-xs text-fd-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          </BentoCard>
        </Reveal>

        {/* Fast */}
        <Reveal className="lg:col-span-2" delay={0.08}>
          <BentoCard
            className="h-full"
            icon={Gauge}
            title={f.fast.title}
            description={f.fast.description}
          >
            <SpeedBars />
          </BentoCard>
        </Reveal>

        {/* Storage */}
        <Reveal className="lg:col-span-2" delay={0}>
          <BentoCard
            className="h-full"
            icon={Cloud}
            title={f.storage.title}
            description={f.storage.description}
          />
        </Reveal>

        {/* API */}
        <Reveal className="lg:col-span-2" delay={0.08}>
          <BentoCard
            className="h-full"
            icon={TerminalSquare}
            title={f.api.title}
            description={f.api.description}
          >
            <pre className="mt-5 overflow-hidden rounded-lg border border-fd-border bg-fd-background/70 p-3 font-mono text-[11px] leading-relaxed text-fd-muted-foreground">
              <span className="text-brand">POST</span> /api/transfers{"\n"}
              {"{ "}
              <span className="text-emerald-500">&quot;expiresIn&quot;</span>: &quot;7d&quot;{" }"}
            </pre>
          </BentoCard>
        </Reveal>

        {/* Search / dashboard */}
        <Reveal className="lg:col-span-2" delay={0.16}>
          <BentoCard
            className="h-full"
            icon={LayoutDashboard}
            title={f.search.title}
            description={f.search.description}
          />
        </Reveal>

        {/* Self-hosted — wide */}
        <Reveal className="lg:col-span-6" delay={0}>
          <BentoCard
            className="overflow-hidden"
            icon={Container}
            title={f.selfHosted.title}
            description={f.selfHosted.description}
          >
            <pre className="mt-5 w-fit rounded-lg border border-fd-border bg-fd-background/70 px-4 py-2.5 font-mono text-xs text-fd-foreground">
              <span className="select-none text-brand">$ </span>docker compose up -d
            </pre>
          </BentoCard>
        </Reveal>
      </div>
    </section>
  );
}
