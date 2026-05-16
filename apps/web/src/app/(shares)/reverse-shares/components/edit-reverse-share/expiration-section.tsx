"use client";

import { Calendar, ChevronDown, ChevronUp } from "lucide-react";
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

interface ExpirationSectionProps {
  form: UseFormReturn<EditReverseShareFormData>;
  hasExpiration: boolean;
}

export function ExpirationSection({ form, hasExpiration }: ExpirationSectionProps) {
  const t = useTranslations();

  const toggleExpiration = () => {
    const newValue = !hasExpiration;
    form.setValue("hasExpiration", newValue);
    if (!newValue) {
      form.setValue("expiration", DEFAULT_VALUES.EMPTY_STRING);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1">
        <Label className="flex items-center gap-2">
          <Calendar className="size-4" />
          {t("reverseShares.form.expiration.configure")}
        </Label>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={toggleExpiration}
        >
          {hasExpiration ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </Button>
      </div>

      {hasExpiration && (
        <FormField
          control={form.control}
          name="expiration"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("reverseShares.form.expiration.label")}</FormLabel>
              <FormControl>
                <Input type="datetime-local" {...field} />
              </FormControl>
              <FormDescription className="text-xs">
                {t("reverseShares.form.expiration.description")}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </div>
  );
}
