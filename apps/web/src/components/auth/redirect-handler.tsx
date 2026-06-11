"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { matchesPath } from "@/components/auth/paths/match-path";
import { publicPaths } from "@/components/auth/paths/public-paths";
import { unauthenticatedOnlyPaths } from "@/components/auth/paths/unauthenticated-only-paths";
import { LoadingScreen } from "@/components/layout/loading-screen";
import { useAuth } from "@/contexts/auth-context";

interface RedirectHandlerProps {
  children: React.ReactNode;
}

const homePaths = ["/"];

export function RedirectHandler({ children }: RedirectHandlerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated === true) {
      if (matchesPath(pathname, unauthenticatedOnlyPaths) || homePaths.includes(pathname)) {
        router.replace("/dashboard");
        return;
      }
    } else if (isAuthenticated === false) {
      if (!matchesPath(pathname, publicPaths) && !homePaths.includes(pathname)) {
        router.replace("/login");
        return;
      }
    }
  }, [isAuthenticated, pathname, router]);

  // While auth is still resolving, only block protected pages. Public pages
  // (login, password reset, share links) must render immediately — otherwise a
  // slow or stalled auth resolution after a session-expiry redirect leaves them
  // stuck on the loading screen until a manual reload.
  if (isAuthenticated === null) {
    if (matchesPath(pathname, publicPaths)) {
      return <>{children}</>;
    }
    return <LoadingScreen />;
  }

  if (
    isAuthenticated === true &&
    (matchesPath(pathname, unauthenticatedOnlyPaths) || homePaths.includes(pathname))
  ) {
    return <LoadingScreen />;
  }

  if (
    isAuthenticated === false &&
    !matchesPath(pathname, publicPaths) &&
    !homePaths.includes(pathname)
  ) {
    return <LoadingScreen />;
  }

  return <>{children}</>;
}
