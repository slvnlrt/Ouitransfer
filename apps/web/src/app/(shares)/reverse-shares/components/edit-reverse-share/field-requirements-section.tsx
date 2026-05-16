"use client";

import { ChevronDown, ChevronUp, Settings, User } from "lucide-react";
import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EditReverseShareFormData } from "./types";

interface FieldRequirementsSectionProps {
  form: UseFormReturn<EditReverseShareFormData>;
  hasFieldRequirements: boolean;
}

export function FieldRequirementsSection({
  form,
  hasFieldRequirements,
}: FieldRequirementsSectionProps) {
  const t = useTranslations();

  const toggleFieldRequirements = () => {
    const newValue = !hasFieldRequirements;
    form.setValue("hasFieldRequirements", newValue);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1">
        <Label className="flex items-center gap-2">
          <User className="size-4" />
          {t("reverseShares.form.fieldRequirements.title")}
        </Label>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={toggleFieldRequirements}
        >
          {hasFieldRequirements ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </Button>
      </div>

      {hasFieldRequirements && (
        <div className="bg-muted/50 rounded-lg p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="nameFieldRequired"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2 font-medium">
                    <User className="size-3.5" />
                    {t("reverseShares.form.nameFieldRequired.label")}
                  </FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="bg-background">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="HIDDEN">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                          {t("reverseShares.labels.fieldOptions.hidden")}
                        </div>
                      </SelectItem>
                      <SelectItem value="OPTIONAL">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-primary" />
                          {t("reverseShares.labels.fieldOptions.optional")}
                        </div>
                      </SelectItem>
                      <SelectItem value="REQUIRED">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-destructive" />
                          {t("reverseShares.labels.fieldOptions.required")}
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="emailFieldRequired"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2 font-medium">
                    <User className="size-3.5" />
                    {t("reverseShares.form.emailFieldRequired.label")}
                  </FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="bg-background">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="HIDDEN">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                          {t("reverseShares.labels.fieldOptions.hidden")}
                        </div>
                      </SelectItem>
                      <SelectItem value="OPTIONAL">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-primary" />
                          {t("reverseShares.labels.fieldOptions.optional")}
                        </div>
                      </SelectItem>
                      <SelectItem value="REQUIRED">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-destructive" />
                          {t("reverseShares.labels.fieldOptions.required")}
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="text-xs text-muted-foreground bg-accent p-3 rounded-md border border-border">
            <div className="flex items-start gap-2">
              <Settings className="size-3 mt-0.5 text-accent-foreground" />
              <div className="space-y-1">
                <p className="font-medium text-accent-foreground">
                  {t("reverseShares.form.fieldRequirements.configurationTitle")}
                </p>
                <ul className="space-y-0.5 text-muted-foreground">
                  <li>• {t("reverseShares.form.fieldRequirements.hiddenDescription")}</li>
                  <li>• {t("reverseShares.form.fieldRequirements.optionalDescription")}</li>
                  <li>• {t("reverseShares.form.fieldRequirements.requiredDescription")}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
