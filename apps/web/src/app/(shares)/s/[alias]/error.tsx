"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { ErrorDisplay } from "@/components/error-display";
import { reportError } from "@/lib/report-error";

export default function ShareError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");

  useEffect(() => {
    reportError(error, { source: "error-boundary", route: "/s/[alias]" });
  }, [error]);

  return (
    <ErrorDisplay
      variant="inline"
      title={t("shareUnavailable")}
      message={t("shareErrorMessage")}
      actions={[{ label: t("tryAgain"), onClick: () => reset() }]}
    />
  );
}
