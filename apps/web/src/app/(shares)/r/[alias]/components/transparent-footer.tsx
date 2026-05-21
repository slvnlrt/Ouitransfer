"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { useSecureConfigValue } from "@/hooks/use-secure-configs";

const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

export function TransparentFooter() {
  const t = useTranslations();
  const { value: hideVersion } = useSecureConfigValue("hideVersion");
  const { value: footerEnabled } = useSecureConfigValue("footerEnabled");
  const { value: footerText } = useSecureConfigValue("footerText");
  const { value: footerUrl } = useSecureConfigValue("footerUrl");

  if (footerEnabled === "false") {
    return null;
  }

  const shouldHideVersion = hideVersion === "true";
  const displayText = footerText || "Burger&Cie";
  const displayUrl = footerUrl || "https://burgeretcie.fr";

  return (
    <footer className="absolute bottom-0 start-0 end-0 z-50 w-full flex items-center justify-center py-3 h-16 pointer-events-none">
      <div className="flex flex-col items-center pointer-events-auto">
        <Link
          target="_blank"
          className="flex items-center gap-1 text-white/80 hover:text-primary transition-colors"
          href={displayUrl}
          title={t("footer.kyanHomepage")}
        >
          <span className="text-white/70 text-xs sm:text-sm">{t("footer.poweredBy")}</span>
          <p className="text-primary text-xs sm:text-sm font-medium cursor-pointer hover:text-primary/80">
            {displayText}
          </p>
        </Link>
        {!shouldHideVersion && <span className="text-white text-[11px] mt-1">v{version}</span>}
      </div>
    </footer>
  );
}
