// TODO: Server component candidate — this page only renders 5 form components.
// Could be a server component with each *PickerForm as a client island,
// using getTranslations() from next-intl/server instead of useTranslations().
// ProtectedRoute and FileManagerLayout would need server-compatible alternatives.
"use client";

import { Palette } from "lucide-react";
import { useTranslations } from "next-intl";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { FileManagerLayout } from "@/components/layout/file-manager-layout";
import { BackgroundPickerForm } from "./components/background-picker-form";
import { ColorPickerForm } from "./components/color-picker-form";
import { FontPickerForm } from "./components/font-picker-form";
import { RadiusPickerForm } from "./components/radius-picker-form";
import { ThemePickerForm } from "./components/theme-picker-form";

export default function CustomizationPage() {
  const t = useTranslations();

  return (
    <ProtectedRoute>
      <FileManagerLayout
        breadcrumbLabel={t("customization.breadcrumb")}
        icon={<Palette className="size-5" />}
        title={t("customization.pageTitle")}
      >
        <div className="flex flex-col gap-6">
          <ThemePickerForm />
          <ColorPickerForm />
          <FontPickerForm />
          <RadiusPickerForm />
          <BackgroundPickerForm />
        </div>
      </FileManagerLayout>
    </ProtectedRoute>
  );
}
