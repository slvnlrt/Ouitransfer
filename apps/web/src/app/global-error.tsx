"use client";

import { useEffect } from "react";

import "./globals.css";

import { reportError } from "@/lib/report-error";

// Global error boundary — catches root layout crashes.
// Providers (theme, i18n, auth) are unavailable since root layout failed.
// Must render its own <html>/<body>.
// TODO: i18n — hardcoded English; providers are dead so useTranslations() is unavailable.
// reportError / logger are safe to import — they are dependency-free wrappers
// around console.* and won't be the cause of a root layout crash.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportError(error, { source: "global-error" });
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-background text-foreground font-sans antialiased">
        <div className="flex items-center justify-center min-h-screen px-6">
          <div className="flex flex-col items-center text-center gap-6 max-w-md">
            <div className="flex items-center justify-center h-16 w-16 rounded-full bg-destructive/10">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-destructive"
                role="img"
                aria-label="Error"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold">Something went wrong</h1>
              <p className="text-muted-foreground text-sm">
                An unexpected error occurred. Please try again or return to the home page.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => reset()}
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors"
              >
                Try again
              </button>
              {/* Raw <a> tag — next/link is unavailable when root layout has crashed */}
              <a
                href="/"
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                Go to home page
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
