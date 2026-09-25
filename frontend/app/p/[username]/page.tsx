import { PublicProfileView } from "@/components/profile/PublicProfileView";
import { publicProfileOnServer } from "@/lib/public-profile-server";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const { username } = await params;
  const profile = await publicProfileOnServer(username);
  const title = profile?.settings.ogTitle || `${profile?.profile.displayName || username} · misa.lol`;
  const description = profile?.settings.ogDescription || profile?.profile.description || `${username} on misa.lol`;
  const origin = process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://misa.lol";
  const url = `${origin}/${encodeURIComponent(username)}`;
  const image = `${origin}/api/v1/profile/${encodeURIComponent(username)}/og.jpg`;
  return { title, description, alternates: { canonical: url }, icons: { icon: `${origin}/api/v1/profile/${encodeURIComponent(username)}/assets/favicon` }, openGraph: { title, description, url, type: "profile", images: [{ url: image, width: 1200, height: 630 }] }, twitter: { card: "summary_large_image", title, description, images: [image] } };
}

export default async function PublicProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const profile = await publicProfileOnServer(username);
  return <PublicProfileView username={username} initialProfile={profile} />;
}
