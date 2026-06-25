"use client";

import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/auth-context";
import { getAuthConfig, login } from "@/http/endpoints";
import { completeTwoFactorLogin } from "@/http/endpoints/auth/two-factor";
import type { GetCurrentUser200 } from "@/http/endpoints/auth/types";
import { queryKeys } from "@/lib/query-keys";
import { parseApiError } from "@/utils/api-error";
import type { LoginFormValues } from "../schemas/schema";

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
      // Map the error code to an i18n key only — never render a free-form
      // `message` URL param, which would let an attacker craft a phishing toast
      // on the legitimate login page (A7-08).
      const message = t(`auth.errors.${errorParam}`);

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
      const loginData = response.data;

      if (
        "requiresTwoFactor" in loginData &&
        loginData.requiresTwoFactor &&
        "challengeToken" in loginData
      ) {
        setRequiresTwoFactor(true);
        setTwoFactorChallengeToken(loginData.challengeToken);
        return;
      }

      if ("user" in loginData) {
        // The login response has user data — seed the TQ cache with it.
        // The login route's Zod schema does not include `image`, so the server
        // strips it during serialization. We set `image: null` here; the
        // background currentUser refetch below will fetch the full profile.
        const rawUser = loginData.user;
        const user: GetCurrentUser200["user"] = {
          ...rawUser,
          image: null,
        };
        setAuthUserData({ user });
        // Background refetch for freshest data (including image)
        queryClient.invalidateQueries({ queryKey: queryKeys.auth.currentUser() });
        router.replace("/dashboard");
      }
    } catch (err) {
      const apiError = parseApiError(err);
      if (apiError.isNetworkError) {
        setError(t("errors.networkError"));
      } else if (apiError.code === ErrorCodes.ACCOUNT_LOCKED) {
        const minutes =
          typeof apiError.details?.remainingMinutes === "number"
            ? apiError.details.remainingMinutes
            : 15; // Matches LOCKOUT_DURATION_MINUTES in login-attempts.service.ts
        setError(t("errors.accountLocked", { minutes }));
      } else if (
        apiError.code === ErrorCodes.UNAUTHORIZED ||
        apiError.code === ErrorCodes.VALIDATION_ERROR
      ) {
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

      // After successful 2FA, the server MUST return user data.
      // If it doesn't, that's a server contract violation — fail loudly.
      const rawUser = response.data.user;
      if (!rawUser) {
        throw new Error("2FA login succeeded but server returned no user data");
      }

      // Map the server response to the User shape expected by setAuthUserData.
      // LoginResponse.user has `image?: string | null`; User requires `image: string | null`.
      const user = {
        id: rawUser.id,
        firstName: rawUser.firstName,
        lastName: rawUser.lastName,
        username: rawUser.username,
        email: rawUser.email,
        isAdmin: rawUser.isAdmin,
        isActive: rawUser.isActive,
        createdAt: rawUser.createdAt,
        updatedAt: rawUser.updatedAt,
        image: rawUser.image ?? null,
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
