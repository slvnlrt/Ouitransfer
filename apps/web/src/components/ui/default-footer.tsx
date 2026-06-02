"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { useSecureConfigValue } from "@/hooks/use-secure-configs";

const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

export function DefaultFooter() {
  const t = useTranslations();
  const { value: hideVersion } = useSecureConfigValue("hideVersion");
  const { value: footerEnabled } = useSecureConfigValue("footerEnabled");
  const { value: footerText, isLoading: isFooterLoading } = useSecureConfigValue("footerText");
  const { value: footerUrl } = useSecureConfigValue("footerUrl");

  if (footerEnabled === "false") {
    return null;
  }

  if (isFooterLoading) return null;

  if (!footerText) return null;

  const shouldHideVersion = hideVersion === "true";
  const displayText = footerText || "";
  const displayUrl = footerUrl || "#";

  return (
    <footer className="w-full flex items-center justify-center py-3 h-16">
      <div className="flex flex-col items-center">
        <Link
          target="_blank"
          className="text-current"
          href={displayUrl}
           title={t("footer.projectHomepage")}
        >
          <p className="text-primary text-xs sm:text-sm">{displayText}</p>
        </Link>
        {!shouldHideVersion && <span className="text-default-500 text-[11px] mt-1">v{version}</span>}
      </div>
    </footer>
  );
}
