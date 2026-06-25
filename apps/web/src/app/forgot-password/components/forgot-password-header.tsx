import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";

export function ForgotPasswordHeader() {
  const t = useTranslations();

  return (
    <div className="space-y-3 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-gradient-brand text-white shadow-lg shadow-primary/20">
        <Lock className="size-6" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-gradient-brand">
        {t("forgotPassword.title")}
      </h1>
      <p className="text-muted-foreground">{t("forgotPassword.description")}</p>
    </div>
  );
}
