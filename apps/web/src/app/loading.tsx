// Self-contained spinner — no hooks or providers needed.
// LoadingScreen (useTranslations) can't be used here because this Suspense
// fallback may render before NextIntlClientProvider is mounted.

export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}
