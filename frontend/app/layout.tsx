import type { Metadata } from "next";
import { AppProviders } from "@/components/providers/AppProviders";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./globals.css";
import "../public/profile-layout.css";

export const metadata: Metadata = {
  title: "misa.lol \u2014 I just need your name.",
  description: "A premium profile experience for creators.",
  icons: {
    icon: [{ url: "/dashboard/favicon-awake.png", type: "image/png" }],
    apple: "/dashboard/favicon-awake.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body suppressHydrationWarning><AppProviders>{children}</AppProviders></body></html>;
}
