import { FileQuestion } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ErrorDisplay } from "@/components/error-display";

export default async function NotFound() {
  const t = await getTranslations("errors");

  return (
    <ErrorDisplay
      variant="page"
      title={t("pageNotFound")}
      message={t("pageNotFoundMessage")}
      icon={<FileQuestion className="h-16 w-16 text-muted-foreground" />}
      actions={[{ label: t("goHome"), href: "/" }]}
    />
  );
}
