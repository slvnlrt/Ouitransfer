"use client";

import { Bell, LogOut, Palette, ScrollText, Settings, User, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { LanguageSwitcher } from "@/components/general/language-switcher";
import { ModeToggle } from "@/components/general/mode-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppInfo } from "@/contexts/app-info-context";
import { useAuth } from "@/contexts/auth-context";
import { logout as logoutAPI } from "@/http/endpoints";
import { logger } from "@/lib/logger";

export function Navbar() {
  const t = useTranslations();
  const router = useRouter();
  const { user, isAdmin, logout, isAuthenticated } = useAuth();
  const { appName, appLogo } = useAppInfo();
  const [isNavigating, setIsNavigating] = useState(false);

  const handleLogoClick = async () => {
    if (isNavigating || !isAuthenticated) return;

    try {
      setIsNavigating(true);
      router.replace("/dashboard");
    } catch (err) {
      logger.error("Error navigating to dashboard:", {
        err: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTimeout(() => setIsNavigating(false), 500);
    }
  };

  const handleLogout = async () => {
    try {
      await logoutAPI();
      logout();
      // Hard redirect to clear all client-side state (query caches, closures, etc.)
      // Soft navigation (router.push) causes a race condition with RedirectHandler:
      // removeQueries → isAuthenticated=null → LoadingScreen blocks the app
      // while queries refetch, potentially leaving the user stuck.
      window.location.href = "/login";
    } catch (err) {
      logger.error("Error logging out:", { err: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background shadow-sm px-6">
      <div className="container flex h-16 max-w-screen-xl items-center mx-auto lg:px-6">
        <div className="flex flex-1 items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleLogoClick}
              className={`flex items-center gap-2 cursor-pointer transition-opacity bg-transparent border-0 p-0 ${
                isNavigating ? "opacity-50" : "opacity-100"
              }`}
            >
              {appLogo && (
                <img
                  alt={t("navbar.logoAlt")}
                  className="h-8 w-8 object-contain rounded"
                  src={appLogo}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              )}
              <p className="font-semibold text-xl tracking-tight">{appName}</p>
            </button>
          </div>

          <div className="flex items-center gap-2 cursor-pointer">
            <LanguageSwitcher />
            <ModeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger className="rounded-full">
                <Avatar className="cursor-pointer h-10 w-10 rounded-full">
                  <AvatarImage src={user?.image as string | undefined} />
                  <AvatarFallback>{user?.firstName?.[0]}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <div className="flex flex-col px-2 py-1.5 gap-0.5">
                  <p className="font-semibold text-sm">
                    {user?.firstName} {user?.lastName}
                  </p>
                  <p className="font-semibold text-xs text-muted-foreground">{user?.email}</p>
                </div>
                <DropdownMenuItem asChild>
                  <Link href="/profile" className="flex items-center gap-2 cursor-pointer">
                    <User className="h-4 w-4" />
                    {t("navbar.profile")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/customization" className="flex items-center gap-2 cursor-pointer">
                    <Palette className="h-4 w-4" />
                    {t("navbar.customization")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/notifications" className="flex items-center gap-2 cursor-pointer">
                    <Bell className="h-4 w-4" />
                    {t("navbar.notifications")}
                  </Link>
                </DropdownMenuItem>
                {isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-muted-foreground uppercase tracking-wider px-2 py-1">
                      {t("navbar.administration")}
                    </DropdownMenuLabel>
                    <DropdownMenuItem asChild>
                      <Link
                        href="/admin/settings"
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <Settings className="h-4 w-4" />
                        {t("navbar.settings")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/admin/users" className="flex items-center gap-2 cursor-pointer">
                        <Users className="h-4 w-4" />
                        {t("navbar.usersManagement")}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/admin/audit" className="flex items-center gap-2 cursor-pointer">
                        <ScrollText className="h-4 w-4" />
                        {t("navbar.activityLog")}
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive cursor-pointer"
                  onClick={handleLogout}
                >
                  <LogOut className="h-4 w-4 text-destructive" />
                  {t("navbar.logout")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  );
}
