"use client";

import { Plus, Share } from "lucide-react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

export function EmptySharesState({ onCreate }: { onCreate: () => void }) {
  const t = useTranslations();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center justify-center py-8 gap-4"
    >
      <Share className="h-10 w-10 text-muted-foreground" />
      <div className="text-center">
        <p className="text-muted-foreground mb-4">{t("recentShares.noShares")}</p>
        <Button variant="outline" size="sm" onClick={onCreate}>
          <Plus className="h-4 w-4" />
          {t("recentShares.createFirst")}
        </Button>
      </div>
    </motion.div>
  );
}
