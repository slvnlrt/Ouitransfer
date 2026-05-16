import type React from "react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

type StatusBadgeVariant = "warning" | "success" | "info";

const variantClasses: Record<StatusBadgeVariant, string> = {
  warning: "bg-yellow-500/20 text-yellow-800 dark:text-yellow-400 border-yellow-300 dark:border-yellow-500/20",
  success: "bg-green-500/20 text-green-800 dark:text-green-400 border-green-300 dark:border-green-500/20",
  info: "bg-blue-500/20 text-blue-800 dark:text-blue-400 border-blue-300 dark:border-blue-500/20",
};

export function StatusBadge({
  variant,
  children,
  className,
}: {
  variant: StatusBadgeVariant;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Badge variant="secondary" className={cn(variantClasses[variant], className)}>
      {children}
    </Badge>
  );
}
