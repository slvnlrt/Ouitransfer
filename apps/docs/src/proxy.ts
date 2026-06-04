import { createI18nMiddleware } from "fumadocs-core/i18n/middleware";

import { i18n } from "@/lib/i18n";

export default createI18nMiddleware(i18n);

export const config = {
  // Run on all paths except API routes, Next.js internals, and static files.
  //
  // The leading "/" entry is required for sub-path deployments: Next.js prefixes
  // matcher patterns with `basePath`, so `/((?!…).*)` becomes `/docs/(…)+` and
  // never matches the bare base-path root (`/docs`). Without this, the default
  // locale's landing page is not rewritten to `/en` and 404s. Harmless when no
  // base path is configured.
  matcher: ["/", "/((?!api|_next/static|_next/image|assets|favicon.ico|.*\\.).*)"],
};
