"use client";

import { Send } from "lucide-react";
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
        className="text-xl lg:text-2xl font-semibold text-primary mt-3"
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
        <Button
          asChild
          size="lg"
          className="text-base font-semibold px-8 transition-all hover:scale-105 hover:shadow-lg hover:shadow-primary/20"
        >
          <Link href="/login">{t("login")}</Link>
        </Button>
      </motion.div>
    </motion.div>
  );
}

function PartnerSection() {
  const t = useTranslations("home.partners");

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.6 }}
      className="flex items-center justify-center"
    >
      <div className="rounded-xl border border-border/60 bg-card p-8 shadow-sm max-w-md w-full">
        <h2 className="text-xl font-semibold mb-4">{t("title")}</h2>
        <p className="text-muted-foreground leading-relaxed">{t("description")}</p>
      </div>
    </motion.div>
  );
}

export function HomeContent() {
  return (
    <div className="container mx-auto max-w-7xl px-6 flex-grow flex items-center">
      <BackgroundLights />
      <section className="relative grid grid-cols-1 md:grid-cols-2 gap-12 lg:gap-16 w-full py-12">
        <EmployeeSection />
        <PartnerSection />
      </section>
    </div>
  );
}
