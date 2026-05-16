"use client";

import { ChevronDown, ChevronUp, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEFAULT_VALUES, type EditReverseShareFormData } from "./types";

interface PasswordSectionProps {
  form: UseFormReturn<EditReverseShareFormData>;
  hasPassword: boolean;
}

export function PasswordSection({ form, hasPassword }: PasswordSectionProps) {
  const t = useTranslations();

  const togglePassword = () => {
    const newValue = !hasPassword;
    form.setValue("hasPassword", newValue);
    if (!newValue) {
      form.setValue("password", DEFAULT_VALUES.EMPTY_STRING);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1">
        <Label className="flex items-center gap-2">
          <Lock className="size-4" />
          {t("reverseShares.form.password.configurePassword")}
        </Label>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={togglePassword}
        >
          {hasPassword ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </Button>
      </div>

      {hasPassword && (
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("reverseShares.modals.password.password")}</FormLabel>
              <FormControl>
                <Input
                  placeholder={t("reverseShares.form.password.passwordPlaceholder")}
                  {...field}
                />
              </FormControl>
              <FormDescription className="text-xs">
                {t("reverseShares.form.password.passwordHelp")}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </div>
  );
}
