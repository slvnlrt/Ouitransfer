"use client";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { PageLayout } from "@/components/layout/page-layout";

import { NotificationPreferencesTable } from "./components/notification-preferences-table";

export default function NotificationsPage() {
  return (
    <ProtectedRoute>
      <PageLayout>
        <NotificationPreferencesTable />
      </PageLayout>
    </ProtectedRoute>
  );
}
