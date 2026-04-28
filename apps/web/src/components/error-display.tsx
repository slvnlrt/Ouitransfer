"use client";

import type { VariantProps } from "class-variance-authority";
import { AlertCircle } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { Button, type buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ErrorDisplayAction {
  label: string;
  onClick?: () => void;
  href?: string;
  variant?: VariantProps<typeof buttonVariants>["variant"];
}

interface ErrorDisplayProps {
  variant?: "page" | "inline" | "minimal";
  title: string;
  message?: string;
  icon?: React.ReactNode;
  actions?: ErrorDisplayAction[];
  className?: string;
}

function ActionButton({ action }: { action: ErrorDisplayAction }) {
  if (action.href) {
    return (
      <Button variant={action.variant ?? "default"} asChild>
        <Link href={action.href}>{action.label}</Link>
      </Button>
    );
  }
  return (
    <Button variant={action.variant ?? "default"} onClick={action.onClick}>
      {action.label}
    </Button>
  );
}

export function ErrorDisplay({
  variant = "page",
  title,
  message,
  icon,
  actions,
  className,
}: ErrorDisplayProps) {
  const iconNode = icon ?? (
    <AlertCircle
      className={cn("text-destructive", variant === "page" ? "h-16 w-16" : "h-12 w-12")}
    />
  );

  const content = (
    <div
      className={cn(
        "flex flex-col items-center text-center gap-4",
        variant === "page" && "gap-6",
        className,
      )}
    >
      {iconNode}
      <div className="flex flex-col gap-2">
        <h2
          className={cn(
            "font-semibold text-foreground",
            variant === "page" ? "text-2xl" : "text-lg",
          )}
        >
          {title}
        </h2>
        {message && <p className="text-muted-foreground text-sm max-w-md">{message}</p>}
      </div>
      {actions && actions.length > 0 && (
        <div className="flex gap-3 flex-wrap justify-center">
          {actions.map((action, index) => (
            <ActionButton key={`${index}-${action.label}`} action={action} />
          ))}
        </div>
      )}
    </div>
  );

  switch (variant) {
    case "page":
      return <div className="flex items-center justify-center min-h-[60vh] px-6">{content}</div>;
    case "inline":
      return (
        <Card className="max-w-md">
          <CardContent className="py-8">{content}</CardContent>
        </Card>
      );
    case "minimal":
      return <div className="flex items-center justify-center py-12 px-6">{content}</div>;
    default: {
      const _exhaustive: never = variant;
      return _exhaustive;
    }
  }
}
