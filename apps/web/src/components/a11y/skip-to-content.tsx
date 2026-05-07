"use client";

import { useTranslations } from "next-intl";

export function SkipToContent() {
  const t = useTranslations("a11y");

  return (
    <a
      href="#main-content"
      className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-4 focus-visible:start-4 focus-visible:z-50 focus-visible:px-4 focus-visible:py-2 focus-visible:bg-background focus-visible:text-foreground focus-visible:border focus-visible:border-border focus-visible:rounded-md focus-visible:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {t("skipToContent")}
    </a>
  );
}
