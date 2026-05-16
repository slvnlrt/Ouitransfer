"use client";

import { Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CreateReverseShareFormData } from "./types";

interface BasicInfoSectionProps {
  form: UseFormReturn<CreateReverseShareFormData>;
}

export function BasicInfoSection({ form }: BasicInfoSectionProps) {
  const t = useTranslations();

  return (
    <div className="space-y-4">
      <FormField
        control={form.control}
        name="name"
        rules={{ required: t("validation.nameRequired") }}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("reverseShares.form.name.label")}</FormLabel>
            <FormControl>
              <Input placeholder={t("reverseShares.form.name.placeholder")} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("reverseShares.form.description.label")}</FormLabel>
            <FormControl>
              <Textarea
                placeholder={t("reverseShares.form.description.placeholder")}
                rows={3}
                {...field}
              />
            </FormControl>
            <FormDescription>{t("reverseShares.form.description.description")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="pageLayout"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="flex items-center gap-2">
              <Settings className="size-4" />
              {t("reverseShares.form.pageLayout.label")}
            </FormLabel>
            <Select onValueChange={field.onChange} defaultValue={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder={t("reverseShares.form.pageLayout.placeholder")} />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="DEFAULT">
                  {t("reverseShares.form.pageLayout.options.default")}
                </SelectItem>
                <SelectItem value="WETRANSFER">
                  {t("reverseShares.form.pageLayout.options.wetransfer")}
                </SelectItem>
              </SelectContent>
            </Select>
            <FormDescription>{t("reverseShares.form.pageLayout.description")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
