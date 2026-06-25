"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSecureConfigValue } from "@/hooks/use-secure-configs";
import { safeHttpUrlOrHash } from "@/utils/safe-url";

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
  // Reject non-http(s) hrefs (javascript:/data:/protocol-relative) at render time (A7-01).
  const displayUrl = safeHttpUrlOrHash(footerUrl);

  return (
    <footer className="w-full flex items-center justify-center py-3 h-16">
      <div className="flex flex-col items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              target="_blank"
              rel="noopener noreferrer"
              className="text-current"
              href={displayUrl}
            >
              <p className="text-primary text-xs sm:text-sm">{displayText}</p>
            </Link>
          </TooltipTrigger>
          <TooltipContent>{t("footer.projectHomepage")}</TooltipContent>
        </Tooltip>
        {!shouldHideVersion && <span className="text-default-500 text-[11px] mt-1">v{version}</span>}
      </div>
    </footer>
  );
}
