"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { ErrorDisplay } from "@/components/error-display";
import { reportError } from "@/lib/report-error";

export default function ReverseShareError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");

  useEffect(() => {
    reportError(error, { source: "error-boundary", route: "/r/[alias]" });
  }, [error]);

  return (
    <ErrorDisplay
      variant="minimal"
      title={t("uploadUnavailable")}
      message={t("uploadErrorMessage")}
      actions={[{ label: t("tryAgain"), onClick: () => reset() }]}
    />
  );
}
