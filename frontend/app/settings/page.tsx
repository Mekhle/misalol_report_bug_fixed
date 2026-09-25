import { Suspense } from "react";
import { SettingsView } from "@/components/settings/SettingsView";

export default function SettingsPage() {
  return <Suspense><SettingsView /></Suspense>;
}
