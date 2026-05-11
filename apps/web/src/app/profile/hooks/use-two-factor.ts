"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useAppInfo } from "@/contexts/app-info-context";
import {
  disableTwoFactor,
  generate2FASetup,
  generateBackupCodes,
  getTwoFactorStatus,
  verifyTwoFactorSetup,
} from "@/http/endpoints/auth/two-factor";
import type { TwoFactorSetupResponse } from "@/http/endpoints/auth/two-factor/types";
import { logger } from "@/lib/logger";
import { queryKeys } from "@/lib/query-keys";

/**
 * Extract a user-facing error message from an Axios error, or return `undefined`
 * so the caller can fall back to a generic i18n message.
 */
function extractServerError(error: unknown): string | undefined {
  if (!axios.isAxiosError(error)) return undefined;
  return error.response?.data?.error || undefined;
}

export function useTwoFactor() {
  const t = useTranslations();
  const { appName } = useAppInfo();
  const queryClient = useQueryClient();

  // ── Local UI state (modals, form inputs, transient data) ────────────
  const [setupData, setSetupData] = useState<TwoFactorSetupResponse | null>(null);
  const [isSetupModalOpen, setIsSetupModalOpen] = useState(false);
  const [isDisableModalOpen, setIsDisableModalOpen] = useState(false);
  const [isBackupCodesModalOpen, setIsBackupCodesModalOpen] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verificationCode, setVerificationCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [disableTotpCode, setDisableTotpCode] = useState("");

  // ── Query: 2FA status ───────────────────────────────────────────────
  const statusQuery = useQuery({
    queryKey: queryKeys.auth.twoFactor.status(),
    queryFn: async () => {
      const response = await getTwoFactorStatus();
      return response.data;
    },
  });

  // ── Mutation: start setup (generate QR / secret) ────────────────────
  const startSetupMutation = useMutation({
    mutationFn: async () => {
      const response = await generate2FASetup({ appName });
      return response.data;
    },
    onSuccess: (data) => {
      setSetupData(data);
      setIsSetupModalOpen(true);
    },
    onError: (error: unknown) => {
      logger.error("Failed to generate 2FA setup", {
        err: error instanceof Error ? error.message : String(error),
      });
      const serverMsg = extractServerError(error);
      toast.error(serverMsg ?? t("twoFactor.messages.setupFailed"));
    },
  });

  // ── Mutation: verify setup (enable 2FA) ─────────────────────────────
  const verifyMutation = useMutation({
    mutationFn: async () => {
      if (!setupData || !verificationCode) {
        throw new Error("missing_input");
      }
      const response = await verifyTwoFactorSetup({
        token: verificationCode,
        secret: setupData.secret,
      });
      return response.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        setBackupCodes(data.backupCodes);
        setIsSetupModalOpen(false);
        setIsBackupCodesModalOpen(true);
        setVerificationCode("");
        toast.success(t("twoFactor.messages.enabledSuccess"));
        queryClient.invalidateQueries({ queryKey: queryKeys.auth.twoFactor.status() });
      }
    },
    onError: (error: unknown) => {
      if (error instanceof Error && error.message === "missing_input") {
        toast.error(t("twoFactor.messages.enterVerificationCode"));
        return;
      }
      logger.error("Failed to verify 2FA setup", {
        err: error instanceof Error ? error.message : String(error),
      });
      const serverMsg = extractServerError(error);
      toast.error(serverMsg ?? t("twoFactor.messages.verificationFailed"));
    },
  });

  // ── Mutation: disable 2FA ───────────────────────────────────────────
  const disableMutation = useMutation({
    mutationFn: async () => {
      if (!disablePassword) {
        throw new Error("missing_password");
      }
      if (!disableTotpCode) {
        throw new Error("missing_totp");
      }
      const response = await disableTwoFactor({
        password: disablePassword,
        totpCode: disableTotpCode,
      });
      return response.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        setIsDisableModalOpen(false);
        setDisablePassword("");
        setDisableTotpCode("");
        toast.success(t("twoFactor.messages.disabledSuccess"));
        queryClient.invalidateQueries({ queryKey: queryKeys.auth.twoFactor.status() });
      }
    },
    onError: (error: unknown) => {
      if (error instanceof Error && error.message === "missing_password") {
        toast.error(t("twoFactor.messages.enterPassword"));
        return;
      }
      if (error instanceof Error && error.message === "missing_totp") {
        toast.error(t("twoFactor.messages.enterVerificationCode"));
        return;
      }
      // Clear the TOTP code on error so the user can enter a fresh code.
      // The password is kept so the user doesn't have to re-type it.
      setDisableTotpCode("");
      logger.error("Failed to disable 2FA", {
        err: error instanceof Error ? error.message : String(error),
      });
      const serverMsg = extractServerError(error);
      toast.error(serverMsg ?? t("twoFactor.messages.disableFailed"));
    },
  });

  // ── Mutation: generate new backup codes ─────────────────────────────
  const generateCodesMutation = useMutation({
    mutationFn: async () => {
      const response = await generateBackupCodes();
      return response.data;
    },
    onSuccess: (data) => {
      setBackupCodes(data.backupCodes);
      setIsBackupCodesModalOpen(true);
      toast.success(t("twoFactor.messages.backupCodesGenerated"));
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.twoFactor.status() });
    },
    onError: (error: unknown) => {
      logger.error("Failed to generate backup codes", {
        err: error instanceof Error ? error.message : String(error),
      });
      const serverMsg = extractServerError(error);
      toast.error(serverMsg ?? t("twoFactor.messages.backupCodesFailed"));
    },
  });

  // ── Pure client helpers (no fetch) ──────────────────────────────────
  const downloadBackupCodes = () => {
    const content = backupCodes.join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ouitransfer-backup-codes.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyBackupCodes = async () => {
    try {
      await navigator.clipboard.writeText(backupCodes.join("\n"));
      toast.success(t("twoFactor.messages.backupCodesCopied"));
    } catch {
      toast.error(t("twoFactor.messages.backupCodesCopyFailed"));
    }
  };

  // ── Derived loading state (preserves original unified isLoading) ────
  const isLoading =
    statusQuery.isLoading ||
    startSetupMutation.isPending ||
    verifyMutation.isPending ||
    disableMutation.isPending ||
    generateCodesMutation.isPending;

  // ── Public API wrappers (preserve original function signatures) ─────
  const startSetup = () => startSetupMutation.mutate();
  const verifySetup = () => verifyMutation.mutate();
  const disable2FA = () => disableMutation.mutate();
  const generateNewBackupCodes = () => generateCodesMutation.mutate();

  const loadStatus = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.auth.twoFactor.status() });
  };

  return {
    isLoading,
    status: statusQuery.data ?? { enabled: false, verified: false, availableBackupCodes: 0 },
    setupData,
    backupCodes,
    verificationCode,
    disablePassword,
    disableTotpCode,

    isSetupModalOpen,
    isDisableModalOpen,
    isBackupCodesModalOpen,

    setVerificationCode,
    setDisablePassword,
    setDisableTotpCode,
    setIsSetupModalOpen,
    setIsDisableModalOpen,
    setIsBackupCodesModalOpen,

    startSetup,
    verifySetup,
    disable2FA,
    generateNewBackupCodes,
    downloadBackupCodes,
    copyBackupCodes,
    loadStatus,
  };
}
