import { Spinner } from "@/components/ui/spinner";

// Note: Server component — cannot use i18n hooks. English fallback is acceptable for brief loading states.

export function PageLoading() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <Spinner size="lg" />
    </div>
  );
}
