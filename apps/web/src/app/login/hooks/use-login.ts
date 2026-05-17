"use client";

import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { useAuth } from "@/contexts/auth-context";
import { getAuthConfig, login } from "@/http/endpoints";
import { completeTwoFactorLogin } from "@/http/endpoints/auth/two-factor";
import type { LoginResponse } from "@/http/endpoints/auth/two-factor/types";
import type { GetCurrentUser200 } from "@/http/endpoints/auth/types";
import { queryKeys } from "@/lib/query-keys";
import { parseApiError } from "@/utils/api-error";
import type { LoginFormValues } from "../schemas/schema";

const loginSchema = z.object({
  emailOrUsername: z.string(),
  password: z.string(),
});

type LoginFormData = z.infer<typeof loginSchema>;

export function useLogin() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations();
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [isVisible, setIsVisible] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [twoFactorChallengeToken, setTwoFactorChallengeToken] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auth config: replaces manual useEffect + useState with useQuery
  const authConfigQuery = useQuery({
    queryKey: queryKeys.auth.config(),
    queryFn: async () => {
      const response = await getAuthConfig();
      return response.data;
    },
  });
  const passwordAuthEnabled = authConfigQuery.data?.passwordAuthEnabled ?? true;
  const authConfigLoading = authConfigQuery.isLoading;

  useEffect(() => {
    if (isAuthenticated === true) {
      router.replace("/dashboard");
    }
  }, [isAuthenticated, router]);

  useEffect(() => {
    const errorParam = searchParams.get("error");
    const messageParam = searchParams.get("message");
    const reasonParam = searchParams.get("reason");

    const timers: ReturnType<typeof setTimeout>[] = [];

    if (reasonParam === "session_expired") {
      timers.push(
        setTimeout(() => {
          toast.error(t("auth.sessionExpired"));
        }, 100),
      );

      timers.push(
        setTimeout(() => {
          const url = new URL(window.location.href);
          url.searchParams.delete("reason");
          window.history.replaceState({}, "", url.toString());
        }, 1000),
      );
    }

    if (errorParam) {
      let message: string;

      if (messageParam) {
        message = decodeURIComponent(messageParam);
      } else {
        const errorKey = `auth.errors.${errorParam}`;
        message = t(errorKey);
      }

      timers.push(
        setTimeout(() => {
          toast.error(message);
        }, 100),
      );

      timers.push(
        setTimeout(() => {
          const url = new URL(window.location.href);
          url.searchParams.delete("error");
          url.searchParams.delete("message");
          url.searchParams.delete("provider");
          window.history.replaceState({}, "", url.toString());
        }, 1000),
      );
    }

    return () => {
      for (const id of timers) clearTimeout(id);
    };
  }, [searchParams, t]);

  const toggleVisibility = () => setIsVisible(!isVisible);

  /** Inject user data into the TQ cache so AuthProvider derives state immediately */
  const setAuthUserData = (userData: GetCurrentUser200) => {
    queryClient.setQueryData(queryKeys.auth.currentUser(), userData);
  };

  const onSubmit = async (data: LoginFormValues) => {
    setError(undefined);
    setIsSubmitting(true);

    try {
      if (!passwordAuthEnabled) {
        setError(t("errors.passwordAuthDisabled"));
        return;
      }

      const response = await login({
        emailOrUsername: data.emailOrUsername,
        password: data.password as string,
      });
      const loginData = response.data as LoginResponse;

      if (loginData.requiresTwoFactor && loginData.challengeToken) {
        setRequiresTwoFactor(true);
        setTwoFactorChallengeToken(loginData.challengeToken);
        return;
      }

      if (loginData.user) {
        // The login response has user data — seed the TQ cache with it.
        // LoginUser lacks `image`, so fill it in. The currentUser query shape
        // is GetCurrentUser200 = { user: User }.
        const user = { ...loginData.user, image: null as string | null };
        setAuthUserData({ user });
        // Also kick off a background refetch so we get the full user
        // (including image) from getCurrentUser.
        queryClient.invalidateQueries({ queryKey: queryKeys.auth.currentUser() });
        router.replace("/dashboard");
      }
    } catch (err) {
      const apiError = parseApiError(err);
      if (apiError.isNetworkError) {
        setError(t("errors.networkError"));
      } else if (apiError.code === ErrorCodes.UNAUTHORIZED) {
        setError(t("errors.invalidCredentials"));
      } else {
        setError(t("errors.unexpectedError"));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const onTwoFactorSubmit = async (rememberDevice: boolean = false) => {
    if (!twoFactorChallengeToken || !twoFactorCode) {
      setError(t("twoFactor.messages.enterVerificationCode"));
      return;
    }

    setError(undefined);
    setIsSubmitting(true);

    try {
      const response = await completeTwoFactorLogin({
        challengeToken: twoFactorChallengeToken,
        token: twoFactorCode,
        rememberDevice: rememberDevice,
      });

      // 2FA response has user data — seed TQ cache
      const user = {
        ...response.data.user,
        image: response.data.user.image ?? null,
      };
      setAuthUserData({ user });
      // Background refetch for freshest data
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.currentUser() });
      router.replace("/dashboard");
    } catch (err) {
      const apiError = parseApiError(err);
      if (apiError.isNetworkError) {
        setError(t("errors.networkError"));
      } else {
        setError(t("twoFactor.errors.invalidTwoFactorCode"));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    isAuthenticated,
    error,
    isVisible,
    toggleVisibility,
    onSubmit,
    requiresTwoFactor,
    twoFactorCode,
    setTwoFactorCode,
    onTwoFactorSubmit,
    isSubmitting,
    passwordAuthEnabled,
    authConfigLoading,
  };
}
