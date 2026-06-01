import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { ChevronRight, Github } from "lucide-react";

import { LATEST_VERSION } from "@/config/constants";
import { i18n } from "@/lib/i18n";

/** Prefix a path with the locale segment, except for the default language. */
export function localizedPath(path: string, locale: string): string {
  return locale === i18n.defaultLanguage ? path : `/${locale}${path}`;
}

/**
 * Shared layout options. Internal links are locale-aware so navigation stays
 * within the active language.
 */
export function baseOptions(locale: string): BaseLayoutProps {
  return {
    nav: {
      url: localizedPath("/", locale),
      title: (
        <div className="flex items-start gap-1.5">
          <ChevronRight className="text-primary" strokeWidth={3} />
          <span className="text-xl font-medium">OUITRANSFER</span>
        </div>
      ),
    },
    links: [
      {
        text: "Docs",
        url: localizedPath(`/docs/${LATEST_VERSION}`, locale),
        active: "nested-url",
      },
      {
        text: "Github",
        url: "https://github.com/slvnlrt/ouitransfer",
        active: "nested-url",
        icon: (
          <>
            <Github fill="currentColor" />
          </>
        ),
      },
    ],
  };
}
