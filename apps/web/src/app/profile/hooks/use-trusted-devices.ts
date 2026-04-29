"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { getTrustedDevices, removeAllTrustedDevices, removeTrustedDevice } from "@/http/endpoints";
import type { TrustedDevice } from "@/http/endpoints/auth/trusted-devices/types";
import { logger } from "@/lib/logger";
import { queryKeys } from "@/lib/query-keys";

export function useTrustedDevices() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [isRemoveModalOpen, setIsRemoveModalOpen] = useState(false);
  const [isRemoveAllModalOpen, setIsRemoveAllModalOpen] = useState(false);
  const [deviceToRemove, setDeviceToRemove] = useState<TrustedDevice | null>(null);

  const devicesQuery = useQuery({
    queryKey: queryKeys.auth.trustedDevices(),
    queryFn: async () => {
      const response = await getTrustedDevices();
      return response.devices;
    },
  });

  const removeDeviceMutation = useMutation({
    mutationFn: async (device: TrustedDevice) => {
      await removeTrustedDevice({ deviceId: device.id });
    },
    onSuccess: () => {
      toast.success(t("twoFactor.trustedDevices.deviceRemoved"));
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.trustedDevices() });
      setIsRemoveModalOpen(false);
      setDeviceToRemove(null);
    },
    onError: (_error, device) => {
      toast.error(t("twoFactor.trustedDevices.removeFailed"));
      logger.error("Failed to remove trusted device", {
        deviceId: device.id,
        err: _error instanceof Error ? _error.message : String(_error),
      });
    },
  });

  const removeAllDevicesMutation = useMutation({
    mutationFn: async () => {
      await removeAllTrustedDevices();
    },
    onSuccess: () => {
      toast.success(t("twoFactor.trustedDevices.allDevicesRemoved"));
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.trustedDevices() });
      setIsRemoveAllModalOpen(false);
    },
    onError: (error) => {
      toast.error(t("twoFactor.trustedDevices.removeAllFailed"));
      logger.error("Failed to remove all trusted devices", {
        err: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const handleRemoveDevice = useCallback((device: TrustedDevice) => {
    setDeviceToRemove(device);
    setIsRemoveModalOpen(true);
  }, []);

  const confirmRemoveDevice = async () => {
    if (!deviceToRemove) return;
    await removeDeviceMutation.mutateAsync(deviceToRemove);
  };

  const handleRemoveAllDevices = useCallback(() => {
    setIsRemoveAllModalOpen(true);
  }, []);

  const confirmRemoveAllDevices = async () => {
    await removeAllDevicesMutation.mutateAsync();
  };

  const formatDeviceName = useCallback(
    (device: TrustedDevice) => {
      const userAgent = device.userAgent;

      let deviceInfo = t("twoFactor.deviceNames.unknownDevice");

      if (!userAgent) {
        return deviceInfo;
      }

      if (userAgent.includes("Chrome")) {
        deviceInfo = t("twoFactor.deviceNames.browsers.chrome");
      } else if (userAgent.includes("Firefox")) {
        deviceInfo = t("twoFactor.deviceNames.browsers.firefox");
      } else if (userAgent.includes("Safari") && !userAgent.includes("Chrome")) {
        deviceInfo = t("twoFactor.deviceNames.browsers.safari");
      } else if (userAgent.includes("Edge")) {
        deviceInfo = t("twoFactor.deviceNames.browsers.edge");
      }

      if (userAgent.includes("Windows")) {
        deviceInfo += t("twoFactor.deviceNames.platforms.windows");
      } else if (userAgent.includes("Mac")) {
        deviceInfo += t("twoFactor.deviceNames.platforms.macos");
      } else if (userAgent.includes("Linux")) {
        deviceInfo += t("twoFactor.deviceNames.platforms.linux");
      } else if (userAgent.includes("iPhone")) {
        deviceInfo += t("twoFactor.deviceNames.platforms.iphone");
      } else if (userAgent.includes("Android")) {
        deviceInfo += t("twoFactor.deviceNames.platforms.android");
      }

      return deviceInfo;
    },
    [t],
  );

  const formatDate = useCallback((dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, []);

  const loadDevices = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.auth.trustedDevices() });
  };

  return {
    isLoading: devicesQuery.isLoading,
    devices: devicesQuery.data ?? [],
    isRemoveModalOpen,
    isRemoveAllModalOpen,
    deviceToRemove,
    isRemoving: removeDeviceMutation.isPending || removeAllDevicesMutation.isPending,
    setIsRemoveModalOpen,
    setIsRemoveAllModalOpen,
    handleRemoveDevice,
    confirmRemoveDevice,
    handleRemoveAllDevices,
    confirmRemoveAllDevices,
    formatDeviceName,
    formatDate,
    loadDevices,
  };
}
