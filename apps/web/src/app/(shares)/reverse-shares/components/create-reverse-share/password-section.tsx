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
import type { CreateReverseShareFormData } from "./types";

interface PasswordSectionProps {
  form: UseFormReturn<CreateReverseShareFormData>;
  isPasswordProtected: boolean;
}

export function PasswordSection({ form, isPasswordProtected }: PasswordSectionProps) {
  const t = useTranslations();

  const togglePassword = () => {
    const currentValue = form.getValues("isPasswordProtected");
    form.setValue("isPasswordProtected", !currentValue);
    if (currentValue) {
      form.setValue("password", "");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1">
        <Label className="flex items-center gap-2">
          <Lock className="size-4" />
          {t("reverseShares.labels.protectWithPassword")}
        </Label>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={togglePassword}
        >
          {isPasswordProtected ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </Button>
      </div>

      {isPasswordProtected && (
        <FormField
          control={form.control}
          name="password"
          rules={{
            required: isPasswordProtected ? t("validation.passwordRequired") : false,
          }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("reverseShares.form.password.label")}</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  placeholder={t("reverseShares.form.password.placeholder")}
                  {...field}
                />
              </FormControl>
              <FormDescription>{t("reverseShares.form.password.description")}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </div>
  );
}
