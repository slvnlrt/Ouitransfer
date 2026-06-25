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
import type { CreateReverseShareFormData } from "./types";

interface ExpirationSectionProps {
  form: UseFormReturn<CreateReverseShareFormData>;
  hasExpiration: boolean;
}

export function ExpirationSection({ form, hasExpiration }: ExpirationSectionProps) {
  const t = useTranslations();

  const toggleExpiration = () => {
    const currentValue = form.getValues("hasExpiration");
    form.setValue("hasExpiration", !currentValue);
    if (currentValue) {
      form.setValue("expiration", "");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1">
        <Label className="flex items-center gap-2">
          <Calendar className="size-4" />
          {t("reverseShares.labels.configureExpiration")}
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
              <FormDescription>{t("reverseShares.form.expiration.description")}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </div>
  );
}
