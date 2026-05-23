"use client";

import type { ReactNode } from "react";

import { Navbar } from "@/components/layout/navbar";
import { SystemStatusBar } from "@/components/layout/system-status-bar";
import { DefaultFooter } from "@/components/ui/default-footer";

interface PageLayoutProps {
  children: ReactNode;
}

/**
 * Shared layout for authenticated pages that don't use the FileManagerLayout sidebar.
 * Provides consistent Navbar + content area + footer structure.
 *
 * Used by: profile, settings, users-management, shares, reverse-shares.
 * Pages with sidebar (dashboard, files, customization) use FileManagerLayout instead.
 */
export function PageLayout({ children }: PageLayoutProps) {
  return (
    <div className="w-full min-h-screen flex flex-col">
      <Navbar />
      {/* sticky top-16 assumes Navbar h-16 (64px) */}
      <SystemStatusBar />
      <div className="flex-1 max-w-7xl mx-auto w-full px-6 py-8">{children}</div>
      <DefaultFooter />
    </div>
  );
}
