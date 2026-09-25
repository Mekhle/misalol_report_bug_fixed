import { Suspense } from "react";
import { HelpCenterView } from "@/components/more/HelpCenterView";

export default function HelpPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-[900px] px-5 py-12 text-zinc-500">Loading help…</main>}>
      <HelpCenterView />
    </Suspense>
  );
}
