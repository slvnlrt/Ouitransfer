"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/auth-context";
import { getCurrentUser } from "@/http/endpoints";
import { logger } from "@/lib/logger";

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setUser, setIsAuthenticated, setIsAdmin } = useAuth();
  const t = useTranslations();

  useEffect(() => {
    const token = searchParams.get("token");
    const error = searchParams.get("error");

    if (error) {
      let errorMessage = "Authentication failed";

      switch (error) {
        case "oauth_error":
          errorMessage = "OAuth authentication failed";
          break;
        case "missing_parameters":
          errorMessage = "Missing authentication parameters";
          break;
        case "registration_disabled":
          errorMessage = "Registration is disabled for this provider";
          break;
        case "provider_disabled":
          errorMessage = "This authentication provider is disabled";
          break;
        case "state_expired":
          errorMessage = "Authentication session expired";
          break;
        case "account_inactive":
          errorMessage = "Your account is inactive";
          break;
        default:
          errorMessage = "Authentication failed";
      }

      toast.error(errorMessage);
      router.push("/login");
      return;
    }

    if (token) {
      // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API has poor browser support; direct assignment is the only cross-browser option here
      document.cookie = `token=${token}; path=/; max-age=${7 * 24 * 60 * 60}; samesite=lax`;

      // Buscar dados do usuário após definir o cookie
      const fetchUserData = async () => {
        try {
          const response = await getCurrentUser();
          if (response?.data?.user) {
            const { isAdmin, ...userData } = response.data.user;
            setUser(userData);
            setIsAdmin(isAdmin);
            setIsAuthenticated(true);
            toast.success(t("auth.successfullyAuthenticated"));
            router.push("/dashboard");
          } else {
            throw new Error("No user data received");
          }
        } catch (error) {
          logger.error("Error fetching user data:", {
            err: error instanceof Error ? error.message : String(error),
          });
          toast.error(t("auth.authenticationFailed"));
          router.push("/login");
        }
      };

      fetchUserData();
      return;
    }

    router.push("/login");
  }, [router, searchParams, setUser, setIsAuthenticated, setIsAdmin, t]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
        <p className="text-muted-foreground">Processing authentication...</p>
      </div>
    </div>
  );
}
