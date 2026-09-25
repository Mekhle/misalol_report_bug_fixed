"use client";

import { ImagePlus, UploadCloud } from "lucide-react";
import { useT } from "@/lib/i18n";
import { Button, PageHeader, SectionTitle } from "@/components/ui";

export function ImageHostView() {
  const t = useT();
  return (
    <main className="mx-auto min-h-screen max-w-[900px] px-5 py-8 sm:px-8 sm:py-11 xl:px-12">
      <PageHeader eyebrow={t("host.eyebrow")} title={t("host.title")} description={t("host.description")} />
      <section className="surface rounded-2xl p-6">
        <SectionTitle icon={UploadCloud} title={t("host.hosted")} description={t("host.hostedDesc")} />
        <div className="mt-6 flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[.1] bg-white/[.02] px-6 py-16 text-center">
          <span className="icon-glass mb-4 flex h-12 w-12 items-center justify-center rounded-2xl text-[#fda4af]"><ImagePlus size={20} /></span>
          <p className="text-sm font-medium text-zinc-200">{t("host.notReady")}</p>
          <p className="mt-2 max-w-md text-xs leading-5 text-zinc-500">{t("host.notReadyDesc")}</p>
          <Button variant="subtle" className="mt-5" disabled>{t("host.upload")}</Button>
        </div>
      </section>
    </main>
  );
}
