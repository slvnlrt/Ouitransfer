"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";

import { BackgroundLights } from "@/components/ui/background-lights";

export function LoadingScreen() {
  const t = useTranslations();

  return (
    <div className="fixed inset-0 bg-background">
      <BackgroundLights />
      <div className="relative flex flex-col items-center justify-center h-full gap-4">
        <motion.span
          animate={{ opacity: [0.5, 1, 0.5] }}
          className="text-xl font-semibold text-primary tracking-tight"
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          {t("common.loading")}
        </motion.span>
        <motion.div
          animate={{ scaleX: [0, 1, 0] }}
          className="w-12 h-0.5 bg-primary/60 rounded-full"
          transition={{
            duration: 1.5,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      </div>
    </div>
  );
}
