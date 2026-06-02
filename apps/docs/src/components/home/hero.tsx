"use client";

import { ArrowRight, BookOpenText, Github } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";

import { TransferCard } from "@/components/home/transfer-card";
import type { SiteContent } from "@/lib/content-i18n";

const GITHUB_URL = "https://github.com/slvnlrt/ouitransfer";

export function Hero({
  content,
  docsLink,
  version,
}: {
  content: SiteContent["home"];
  docsLink: string;
  version: string;
}) {
  const reduceMotion = useReducedMotion();
  const t = content.hero;

  const enter = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 24 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    <section className="relative overflow-hidden">
      {/* Aurora + grid background */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-grid-fade opacity-60" />
        <div className="absolute -top-32 left-1/2 size-[36rem] -translate-x-1/2 animate-aurora rounded-full bg-brand/25 blur-[120px]" />
        <div className="absolute -right-24 top-10 size-[28rem] animate-aurora-slow rounded-full bg-brand-from/20 blur-[120px]" />
        <div className="absolute -left-24 top-40 size-[26rem] animate-aurora rounded-full bg-brand-to/20 blur-[120px]" />
      </div>

      <div className="mx-auto grid max-w-screen-xl items-center gap-12 px-4 py-20 sm:px-6 md:py-28 lg:grid-cols-2 lg:gap-8 lg:px-8">
        {/* Copy */}
        <div className="flex flex-col items-start max-lg:items-center max-lg:text-center">
          <motion.div {...enter(0)}>
            <span className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-sm font-medium text-brand">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-brand" />
              </span>
              {t.badge}
            </span>
          </motion.div>

          <motion.h1
            {...enter(0.08)}
            className="mt-6 text-5xl font-bold tracking-tight text-fd-foreground sm:text-6xl lg:text-7xl"
          >
            {t.title}
            <br />
            <span className="text-gradient-brand">{t.titleAccent}</span>
          </motion.h1>

          <motion.p
            {...enter(0.16)}
            className="mt-6 max-w-xl text-lg leading-relaxed text-fd-muted-foreground"
          >
            {t.description}
          </motion.p>

          <motion.div
            {...enter(0.24)}
            className="mt-8 flex flex-col items-center gap-4 sm:flex-row"
          >
            <Link
              href={docsLink}
              className="group inline-flex items-center gap-2 rounded-xl bg-gradient-brand bg-[length:200%_200%] px-6 py-3 font-medium text-white shadow-lg shadow-brand/25 transition-[background-position,transform] duration-500 hover:bg-right hover:-translate-y-0.5"
            >
              <BookOpenText className="size-5" />
              {t.primaryCta}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-2 rounded-xl border border-fd-border bg-fd-card/50 px-6 py-3 font-medium text-fd-foreground backdrop-blur-sm transition-colors hover:border-brand/40 hover:bg-fd-accent"
            >
              <Github className="size-5" />
              {t.secondaryCta}
            </a>
          </motion.div>

          <motion.p {...enter(0.32)} className="mt-6 text-sm text-fd-muted-foreground">
            {t.note}
            <span className="ml-2 font-mono text-xs text-fd-muted-foreground/60">{version}</span>
          </motion.p>
        </div>

        {/* Transfer card */}
        <motion.div
          className="flex justify-center lg:justify-end"
          {...(reduceMotion
            ? {}
            : {
                initial: { opacity: 0, scale: 0.94, y: 24 },
                animate: { opacity: 1, scale: 1, y: 0 },
                transition: { duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] as const },
              })}
        >
          <div className={reduceMotion ? "" : "animate-float"}>
            <TransferCard demo={content.demo} />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
