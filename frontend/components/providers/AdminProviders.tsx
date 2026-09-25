"use client";

import { RuntimeErrorBoundary } from "@/components/dashboard/RuntimeErrorBoundary";
import { I18nProvider } from "@/lib/i18n";

export function AdminProviders({ children }: { children: React.ReactNode }) {
  return (
    <RuntimeErrorBoundary>
      <I18nProvider>{children}</I18nProvider>
    </RuntimeErrorBoundary>
  );
}