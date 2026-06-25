import { Plus, Share } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

interface EmptySharesStateProps {
  onCreateShare: () => void;
}

export function EmptySharesState({ onCreateShare }: EmptySharesStateProps) {
  const t = useTranslations();

  return (
    <div className="text-center py-6 flex flex-col items-center gap-2">
      <Share className="w-8 h-8 text-muted-foreground" />
      <p className="text-muted-foreground">{t("shares.empty.message")}</p>
      <Button variant="default" size="sm" onClick={onCreateShare} className="gap-2">
        <Plus className="h-4 w-4" />
        {t("shares.empty.createButton")}
      </Button>
    </div>
  );
}
