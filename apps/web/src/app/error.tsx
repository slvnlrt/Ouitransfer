"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { ErrorDisplay } from "@/components/error-display";
import { reportError } from "@/lib/report-error";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");

  useEffect(() => {
    reportError(error, { source: "error-boundary" });
  }, [error]);

  return (
    <ErrorDisplay
      variant="page"
      title={t("somethingWentWrong")}
      message={process.env.NODE_ENV === "development" ? error.message : t("unexpectedError")}
      actions={[
        { label: t("tryAgain"), onClick: () => reset() },
        { label: t("goHome"), href: "/", variant: "outline" },
      ]}
    />
  );
}
