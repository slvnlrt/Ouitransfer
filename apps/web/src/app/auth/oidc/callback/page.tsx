"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";

import { LoadingScreen } from "@/components/layout/loading-screen";
import { getCurrentUser } from "@/http/endpoints";
import { logger } from "@/lib/logger";
import { queryKeys } from "@/lib/query-keys";

/**
 * OIDC callback landing page.
 *
 * Same security model as the OAuth callback page — the server-side callback
 * handler sets httpOnly cookies and redirects directly to `/dashboard`.
 *
 * This page serves as a safety net: it verifies the session (using the
 * httpOnly cookies set server-side) and redirects accordingly.
 *
 * SECURITY: Auth tokens are NEVER set via `document.cookie`. The httpOnly
 * cookie is set exclusively by the Fastify server.
 */
export default function OIDCCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const t = useTranslations();

  useEffect(() => {
    const error = searchParams.get("error");

    if (error) {
      toast.error(t("auth.authenticationFailed"));
      router.push("/login");
      return;
    }

    const verifySession = async () => {
      try {
        const response = await getCurrentUser();
        if (response?.data?.user) {
          queryClient.setQueryData(queryKeys.auth.currentUser(), response.data);
          router.push("/dashboard");
        } else {
          router.push("/login?error=authentication_failed");
        }
      } catch (err) {
        logger.error("OIDC callback session verification failed:", {
          err: err instanceof Error ? err.message : String(err),
        });
        router.push("/login?error=authentication_failed");
      }
    };

    verifySession();
  }, [router, searchParams, queryClient, t]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <LoadingScreen />
      <p className="mt-4 text-muted-foreground">{t("login.processing")}</p>
    </div>
  );
}
