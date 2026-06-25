"use client";

import { ArrowRight, Check, Copy, FileText, Link2, Lock, Send } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BackgroundLights } from "@/components/ui/background-lights";
import { Button } from "@/components/ui/button";
import { useAppInfo } from "@/contexts/app-info-context";

const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.15,
    },
  },
};

function AnimatedSendIcon() {
  return (
    <motion.div
      initial={{ scale: 0, rotate: 0 }}
      animate={{ scale: 1, rotate: -45 }}
      transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.2 }}
      className="relative mb-6"
    >
      <motion.div
        animate={{ y: [0, -5, 0] }}
        transition={{ duration: 4, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
      >
        <div className="relative">
          <Send className="size-16 md:size-20 text-primary" strokeWidth={1.5} />
          <motion.div
            className="absolute inset-0 rounded-full bg-primary/15 blur-2xl -z-10"
            animate={{ scale: [1, 1.08, 1], opacity: [0.3, 0.5, 0.3] }}
            transition={{ duration: 12, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}

function EmployeeSection() {
  const t = useTranslations("home");
  const { appName } = useAppInfo();

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="flex flex-col items-center md:items-start text-center md:text-start"
    >
      <AnimatedSendIcon />

      <motion.h1
        variants={fadeInUp}
        transition={{ duration: 0.5 }}
        className="text-4xl lg:text-5xl font-extrabold tracking-tight"
      >
        {appName}
      </motion.h1>

      <motion.p
        variants={fadeInUp}
        transition={{ duration: 0.5 }}
        className="text-xl lg:text-2xl font-semibold text-gradient-brand mt-3"
      >
        {t("tagline")}
      </motion.p>

      <motion.p
        variants={fadeInUp}
        transition={{ duration: 0.5 }}
        className="text-lg text-muted-foreground mt-4 max-w-md"
      >
        {t("subtitle")}
      </motion.p>

      <motion.div variants={fadeInUp} transition={{ duration: 0.5 }} className="mt-8">
        <Button asChild variant="brand" size="lg" className="group text-base font-semibold px-8">
          <Link href="/login">
            {t("login")}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </Button>
      </motion.div>
    </motion.div>
  );
}

/** Sober, language-neutral mockup of a completed transfer — reinforces the product. */
function TransferVisual() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.6, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="relative w-full max-w-sm"
    >
      <div
        aria-hidden
        className="absolute -inset-4 -z-10 rounded-3xl bg-gradient-brand opacity-15 blur-2xl"
      />
      <div className="rounded-2xl border border-border/70 bg-card/70 p-4 shadow-xl backdrop-blur-md">
        <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/60 p-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-brand text-white">
            <FileText className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">report.pdf</p>
            <p className="text-xs text-muted-foreground">2.4 MB</p>
          </div>
          <span className="flex size-7 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
            <Lock className="size-3.5" />
          </span>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-medium">
              <Check className="size-3.5 text-emerald-500" />
              100%
            </span>
            <span className="font-mono text-muted-foreground">2.4 / 2.4 MB</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div className="h-full w-full rounded-full bg-gradient-brand" />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 p-2 pl-3">
          <Link2 className="size-4 shrink-0 text-primary" />
          <code className="min-w-0 flex-1 truncate font-mono text-sm">share/a7Kf2x</code>
          <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-brand text-white">
            <Copy className="size-3.5" />
          </span>
        </div>
      </div>
    </motion.div>
  );
}

function PartnerSection() {
  const t = useTranslations("home.partners");

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.7 }}
      className="w-full max-w-sm rounded-xl border border-border/60 bg-card/70 p-6 shadow-sm backdrop-blur-md"
    >
      <h2 className="text-lg font-semibold mb-2">{t("title")}</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">{t("description")}</p>
    </motion.div>
  );
}

export function HomeContent() {
  return (
    <div className="relative container mx-auto max-w-7xl px-6 flex-grow flex items-center">
      <BackgroundLights />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-grid-fade opacity-60"
      />
      <section className="relative grid grid-cols-1 md:grid-cols-2 gap-12 lg:gap-16 w-full py-12 items-center">
        <EmployeeSection />
        <div className="flex flex-col items-center gap-6 md:items-end">
          <TransferVisual />
          <PartnerSection />
        </div>
      </section>
    </div>
  );
}
