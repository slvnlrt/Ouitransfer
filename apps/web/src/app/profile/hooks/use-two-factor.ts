"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useAppInfo } from "@/contexts/app-info-context";
import { logger } from "@/lib/logger";
import {
  disableTwoFactor,
  generate2FASetup,
  generateBackupCodes,
  getTwoFactorStatus,
  verifyTwoFactorSetup,
} from "@/http/endpoints/auth/two-factor";
import type { TwoFactorSetupResponse, TwoFactorStatus } from "@/http/endpoints/auth/two-factor/types";

export function useTwoFactor() {
  const t = useTranslations();
  const { appName } = useAppInfo();
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<TwoFactorStatus>({
    enabled: false,
    verified: false,
    availableBackupCodes: 0,
  });
  const [setupData, setSetupData] = useState<TwoFactorSetupResponse | null>(null);
  const [isSetupModalOpen, setIsSetupModalOpen] = useState(false);
  const [isDisableModalOpen, setIsDisableModalOpen] = useState(false);
  const [isBackupCodesModalOpen, setIsBackupCodesModalOpen] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verificationCode, setVerificationCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");

  const loadStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await getTwoFactorStatus();
      setStatus(response.data);
    } catch (error) {
      logger.error("Failed to load 2FA status", { err: error instanceof Error ? error.message : String(error) });
      toast.error(t("twoFactor.messages.statusLoadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  const startSetup = async () => {
    try {
      setIsLoading(true);
      const response = await generate2FASetup({ appName });
      setSetupData(response.data);
      setIsSetupModalOpen(true);
    } catch (error: unknown) {
      logger.error("Failed to generate 2FA setup", { err: error instanceof Error ? error.message : String(error) });
      const axiosError = error as { response?: { data?: { error?: string } } };
      if (axiosError.response?.data?.error) {
        toast.error(axiosError.response.data.error);
      } else {
        toast.error(t("twoFactor.messages.setupFailed"));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const verifySetup = async () => {
    if (!setupData || !verificationCode) {
      toast.error(t("twoFactor.messages.enterVerificationCode"));
      return;
    }

    try {
      setIsLoading(true);
      const response = await verifyTwoFactorSetup({
        token: verificationCode,
        secret: setupData.secret,
      });

      if (response.data.success) {
        setBackupCodes(response.data.backupCodes);
        setIsSetupModalOpen(false);
        setIsBackupCodesModalOpen(true);
        setVerificationCode("");
        toast.success(t("twoFactor.messages.enabledSuccess"));
        await loadStatus();
      }
    } catch (error: unknown) {
      logger.error("Failed to verify 2FA setup", { err: error instanceof Error ? error.message : String(error) });
      const axiosError = error as { response?: { data?: { error?: string } } };
      if (axiosError.response?.data?.error) {
        toast.error(axiosError.response.data.error);
      } else {
        toast.error(t("twoFactor.messages.verificationFailed"));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const disable2FA = async () => {
    if (!disablePassword) {
      toast.error(t("twoFactor.messages.enterPassword"));
      return;
    }

    try {
      setIsLoading(true);
      const response = await disableTwoFactor({
        password: disablePassword,
      });

      if (response.data.success) {
        setIsDisableModalOpen(false);
        setDisablePassword("");
        toast.success(t("twoFactor.messages.disabledSuccess"));
        await loadStatus();
      }
    } catch (error: unknown) {
      logger.error("Failed to disable 2FA", { err: error instanceof Error ? error.message : String(error) });
      const axiosError = error as { response?: { data?: { error?: string } } };
      if (axiosError.response?.data?.error) {
        toast.error(axiosError.response.data.error);
      } else {
        toast.error(t("twoFactor.messages.disableFailed"));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const generateNewBackupCodes = async () => {
    try {
      setIsLoading(true);
      const response = await generateBackupCodes();
      setBackupCodes(response.data.backupCodes);
      setIsBackupCodesModalOpen(true);
      toast.success(t("twoFactor.messages.backupCodesGenerated"));
      await loadStatus();
    } catch (error: unknown) {
      logger.error("Failed to generate backup codes", { err: error instanceof Error ? error.message : String(error) });
      const axiosError = error as { response?: { data?: { error?: string } } };
      if (axiosError.response?.data?.error) {
        toast.error(axiosError.response.data.error);
      } else {
        toast.error(t("twoFactor.messages.backupCodesFailed"));
      }
    } finally {
      setIsLoading(false);
    }
  };

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

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  return {
    isLoading,
    status,
    setupData,
    backupCodes,
    verificationCode,
    disablePassword,

    isSetupModalOpen,
    isDisableModalOpen,
    isBackupCodesModalOpen,

    setVerificationCode,
    setDisablePassword,
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
