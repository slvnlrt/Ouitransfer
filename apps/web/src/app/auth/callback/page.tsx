"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/ui/spinner";
import { getCurrentUser } from "@/http/endpoints";
import { logger } from "@/lib/logger";
import { queryKeys } from "@/lib/query-keys";

/**
 * OAuth callback landing page.
 *
 * The normal OAuth flow never reaches this page — the server-side callback
 * handler (`/api/auth/providers/:provider/callback`) sets httpOnly cookies
 * and redirects directly to `/dashboard`.
 *
 * This page exists as a safety net for:
 * 1. Error redirects from the server (query param `?error=...`)
 * 2. Edge cases where the browser lands here after the server has already
 *    set the auth cookies — we verify the session and redirect to dashboard.
 *
 * SECURITY: Auth tokens are NEVER set via `document.cookie`. The httpOnly
 * cookie is set exclusively by the Fastify server.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const t = useTranslations();

  useEffect(() => {
    const error = searchParams.get("error");

    if (error) {
      const errorKey = [
        "oauth_error",
        "missing_parameters",
        "missing_code",
        "registration_disabled",
        "provider_disabled",
        "state_expired",
        "account_inactive",
        "no_email",
        "token_exchange_failed",
        "missing_user_info",
      ].includes(error)
        ? `auth.callback.errors.${error}`
        : "auth.authenticationFailed";

      toast.error(t(errorKey as Parameters<typeof t>[0]));
      router.push("/login");
      return;
    }

    // The server-side OAuth callback sets httpOnly cookies and redirects
    // to /dashboard. If the browser lands here, verify the session exists
    // (cookies are sent automatically) and redirect.
    const verifySession = async () => {
      try {
        const response = await getCurrentUser();
        if (response?.data?.user) {
          queryClient.setQueryData(queryKeys.auth.currentUser(), response.data);
          toast.success(t("auth.successfullyAuthenticated"));
          router.push("/dashboard");
        } else {
          // No active session — redirect to login
          router.push("/login");
        }
      } catch (err) {
        logger.error("Auth callback session verification failed:", {
          err: err instanceof Error ? err.message : String(err),
        });
        toast.error(t("auth.authenticationFailed"));
        router.push("/login");
      }
    };

    verifySession();
  }, [router, searchParams, queryClient, t]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <Spinner size="lg" className="mx-auto mb-4" />
        <p className="text-muted-foreground">{t("login.processing")}</p>
      </div>
    </div>
  );
}
