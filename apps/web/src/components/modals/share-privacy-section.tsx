"use client";

import { ChevronDown, Shield } from "lucide-react";
import { useTranslations } from "next-intl";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export interface SharePrivacyFormData {
  nameFieldRequired: "HIDDEN" | "OPTIONAL" | "REQUIRED";
  emailFieldRequired: "HIDDEN" | "OPTIONAL" | "REQUIRED";
  notifyOnDownload: boolean;
  inactivityAlertDays: string;
}

interface SharePrivacySectionProps {
  value: SharePrivacyFormData;
  onChange: (data: SharePrivacyFormData) => void;
  /** Suffix for switch IDs to avoid duplicates when multiple instances render */
  switchIdSuffix?: string;
}

export function SharePrivacySection({ value, onChange, switchIdSuffix }: SharePrivacySectionProps) {
  const t = useTranslations();
  const notifySwitchId = switchIdSuffix
    ? `notify-on-download-${switchIdSuffix}`
    : "notify-on-download";

  return (
    <Collapsible>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors">
        <span className="flex items-center gap-2">
          <Shield className="size-4" />
          {t("createShare.privacySection")}
        </span>
        <ChevronDown className="size-4 transition-transform duration-200 data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 pt-3">
        <div className="space-y-2">
          <Label>{t("createShare.nameFieldRequired")}</Label>
          <Select
            value={value.nameFieldRequired}
            onValueChange={(v: "HIDDEN" | "OPTIONAL" | "REQUIRED") =>
              onChange({ ...value, nameFieldRequired: v })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="HIDDEN">{t("createShare.fieldHidden")}</SelectItem>
              <SelectItem value="OPTIONAL">{t("createShare.fieldOptional")}</SelectItem>
              <SelectItem value="REQUIRED">{t("createShare.fieldRequired")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t("createShare.nameFieldRequiredHelp")}</p>
        </div>

        <div className="space-y-2">
          <Label>{t("createShare.emailFieldRequired")}</Label>
          <Select
            value={value.emailFieldRequired}
            onValueChange={(v: "HIDDEN" | "OPTIONAL" | "REQUIRED") =>
              onChange({ ...value, emailFieldRequired: v })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="HIDDEN">{t("createShare.fieldHidden")}</SelectItem>
              <SelectItem value="OPTIONAL">{t("createShare.fieldOptional")}</SelectItem>
              <SelectItem value="REQUIRED">{t("createShare.fieldRequired")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t("createShare.emailFieldRequiredHelp")}</p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Switch
              checked={value.notifyOnDownload}
              onCheckedChange={(checked) => onChange({ ...value, notifyOnDownload: checked })}
              id={notifySwitchId}
            />
            <Label htmlFor={notifySwitchId}>{t("createShare.notifyOnDownload")}</Label>
          </div>
          <p className="text-xs text-muted-foreground ps-9">
            {t("createShare.notifyOnDownloadHelp")}
          </p>
        </div>

        <div className="space-y-2">
          <Label>{t("createShare.inactivityAlertDays")}</Label>
          <div className="relative">
            <Input
              type="number"
              min="1"
              className="pe-14"
              value={value.inactivityAlertDays}
              onChange={(e) => onChange({ ...value, inactivityAlertDays: e.target.value })}
              placeholder={t("createShare.inactivityAlertPlaceholder")}
            />
            <span className="absolute end-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none select-none">
              {t("common.days")}
            </span>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
