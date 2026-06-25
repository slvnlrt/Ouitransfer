import { Folders, MonitorDown, Share2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Card, CardContent } from "@/components/ui/card";

export function QuickAccessCards() {
  const t = useTranslations();
  const router = useRouter();

  const QUICK_ACCESS_ITEMS = [
    {
      title: t("quickAccess.files.title"),
      icon: <Folders className="size-6" />,
      description: t("quickAccess.files.description"),
      path: "/files",
    },
    {
      title: t("quickAccess.shares.title"),
      icon: <Share2 className="size-6" />,
      description: t("quickAccess.shares.description"),
      path: "/shares",
    },
    {
      title: t("quickAccess.reverseShares.title"),
      icon: <MonitorDown className="size-6" />,
      description: t("quickAccess.reverseShares.description"),
      path: "/reverse-shares",
    },
  ] as const;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {QUICK_ACCESS_ITEMS.map((card) => (
        <Card
          key={card.title}
          className="cursor-pointer group transition-all duration-150 border-border/50 h-full hover:-translate-y-px hover:shadow-md"
          onClick={() => router.push(card.path)}
        >
          <CardContent className="h-full">
            <div className="flex items-center gap-4 h-full">
              <div className="dark:group-hover:bg-accent group-hover:bg-primary/10 w-12 h-12 rounded-lg flex items-center justify-center text-primary/80 group-hover:text-primary dark:bg-accent/60 bg-primary/5 border dark:border-none transition-all duration-200 flex-shrink-0">
                {card.icon}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-foreground mb-1 truncate">{card.title}</h3>
                <p className="text-sm text-muted-foreground group-hover:text-muted-foreground leading-relaxed">
                  {card.description}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
