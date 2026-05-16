"use client";

import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerWithInvite } from "@/http/endpoints/invite";
import { logger } from "@/lib/logger";

interface RegisterFormData {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
}

interface RegisterFormProps {
  token: string;
  onSuccess: () => void;
}

export function RegisterForm({ token, onSuccess }: RegisterFormProps) {
  const t = useTranslations();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<RegisterFormData>();

  const password = watch("password");

  const onSubmit = async (data: RegisterFormData) => {
    if (data.password !== data.confirmPassword) {
      toast.error(t("registerWithInvite.validation.passwordsMatch"));
      return;
    }

    setIsSubmitting(true);

    try {
      await registerWithInvite({
        token,
        firstName: data.firstName,
        lastName: data.lastName,
        username: data.username,
        email: data.email,
        password: data.password,
      });

      toast.success(t("registerWithInvite.messages.success"));
      onSuccess();
    } catch (error: unknown) {
      logger.error("Error registering:", {
        err: error instanceof Error ? error.message : String(error),
      });

      // TODO: Server should return structured error codes instead of English messages
      const errorMessage = (error as { response?: { data?: { error?: string } } } | null)?.response
        ?.data?.error;
      if (errorMessage?.includes("already been used")) {
        toast.error(t("registerWithInvite.errors.tokenUsed"));
      } else if (errorMessage?.includes("expired")) {
        toast.error(t("registerWithInvite.errors.tokenExpired"));
      } else if (errorMessage?.includes("Username already exists")) {
        toast.error(t("registerWithInvite.errors.usernameExists"));
      } else if (errorMessage?.includes("Email already exists")) {
        toast.error(t("registerWithInvite.errors.emailExists"));
      } else {
        toast.error(t("registerWithInvite.errors.createFailed"));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="firstName">{t("registerWithInvite.labels.firstName")}</Label>
          <Input
            id="firstName"
            placeholder={t("registerWithInvite.labels.firstNamePlaceholder")}
            {...register("firstName", {
              required: t("registerWithInvite.validation.firstNameRequired"),
            })}
          />
          {errors.firstName && (
            <p className="text-destructive text-sm">{errors.firstName.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="lastName">{t("registerWithInvite.labels.lastName")}</Label>
          <Input
            id="lastName"
            placeholder={t("registerWithInvite.labels.lastNamePlaceholder")}
            {...register("lastName", {
              required: t("registerWithInvite.validation.lastNameRequired"),
            })}
          />
          {errors.lastName && <p className="text-destructive text-sm">{errors.lastName.message}</p>}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="username">{t("registerWithInvite.labels.username")}</Label>
        <Input
          id="username"
          placeholder={t("registerWithInvite.labels.usernamePlaceholder")}
          {...register("username", {
            required: t("registerWithInvite.validation.usernameMinLength"),
            minLength: {
              value: 3,
              message: t("registerWithInvite.validation.usernameMinLength"),
            },
          })}
        />
        {errors.username && <p className="text-destructive text-sm">{errors.username.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">{t("registerWithInvite.labels.email")}</Label>
        <Input
          id="email"
          type="email"
          placeholder={t("registerWithInvite.labels.emailPlaceholder")}
          {...register("email", {
            required: t("registerWithInvite.validation.invalidEmail"),
            pattern: {
              value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
              message: t("registerWithInvite.validation.invalidEmail"),
            },
          })}
        />
        {errors.email && <p className="text-destructive text-sm">{errors.email.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">{t("registerWithInvite.labels.password")}</Label>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            placeholder={t("registerWithInvite.labels.passwordPlaceholder")}
            {...register("password", {
              required: t("registerWithInvite.validation.passwordMinLength"),
              minLength: {
                value: 8,
                message: t("registerWithInvite.validation.passwordMinLength"),
              },
            })}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showPassword ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
          </button>
        </div>
        {errors.password && <p className="text-destructive text-sm">{errors.password.message}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmPassword">{t("registerWithInvite.labels.confirmPassword")}</Label>
        <div className="relative">
          <Input
            id="confirmPassword"
            type={showConfirmPassword ? "text" : "password"}
            placeholder={t("registerWithInvite.labels.confirmPasswordPlaceholder")}
            {...register("confirmPassword", {
              required: t("registerWithInvite.validation.passwordsMatch"),
              validate: (value) =>
                value === password || t("registerWithInvite.validation.passwordsMatch"),
            })}
          />
          <button
            type="button"
            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showConfirmPassword ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
          </button>
        </div>
        {errors.confirmPassword && (
          <p className="text-destructive text-sm">{errors.confirmPassword.message}</p>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting
          ? t("registerWithInvite.buttons.creating")
          : t("registerWithInvite.buttons.createAccount")}
      </Button>
    </form>
  );
}
