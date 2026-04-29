"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/contexts/auth-context";
import { useSecureConfigValue } from "@/hooks/use-secure-configs";

export function useHome() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const { value: showHomePage, isLoading: configLoading } = useSecureConfigValue("showHomePage");

  // Loading until both auth check and config fetch are done
  const isLoading = isAuthenticated === null || configLoading;

  // Show home page only when: config says yes + user is not authenticated
  const shouldShowHomePage = !isLoading && showHomePage === "true" && isAuthenticated === false;

  // Redirect authenticated users to dashboard
  useEffect(() => {
    if (isAuthenticated === true) {
      router.replace("/dashboard");
    }
  }, [isAuthenticated, router]);

  // Redirect to login if home page is disabled
  useEffect(() => {
    if (!isLoading && showHomePage !== "true") {
      router.push("/login");
    }
  }, [isLoading, showHomePage, router]);

  return { isLoading, shouldShowHomePage };
}
