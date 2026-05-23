"use client";

import { createContext, type ReactNode, useContext } from "react";

interface DashboardMetrics {
  fileCount?: number;
  activeShareCount?: number;
}

const DashboardMetricsContext = createContext<DashboardMetrics>({});

export function DashboardMetricsProvider({
  fileCount,
  activeShareCount,
  children,
}: DashboardMetrics & { children: ReactNode }) {
  return (
    <DashboardMetricsContext.Provider value={{ fileCount, activeShareCount }}>
      {children}
    </DashboardMetricsContext.Provider>
  );
}

export function useDashboardMetrics(): DashboardMetrics {
  return useContext(DashboardMetricsContext);
}
