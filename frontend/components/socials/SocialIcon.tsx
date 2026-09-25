import { Mail } from "lucide-react";
import { FaBitcoin, FaEthereum, FaLink, FaLinkedin, FaLitecoinSign } from "react-icons/fa6";
import { SiDiscord, SiFacebook, SiGithub, SiInstagram, SiKick, SiPatreon, SiPaypal, SiPinterest, SiReddit, SiRoblox, SiSnapchat, SiSolana, SiSoundcloud, SiSpotify, SiSteam, SiTelegram, SiThreads, SiTiktok, SiTwitch, SiX, SiYoutube } from "react-icons/si";
import type { IconType } from "react-icons";
import { isSafeSocialIconUrl } from "@/lib/socials";
import type { SocialLink, SocialPlatform } from "@/lib/types";

const icons: Partial<Record<SocialPlatform, IconType>> = { YouTube: SiYoutube, Discord: SiDiscord, Instagram: SiInstagram, X: SiX, TikTok: SiTiktok, Telegram: SiTelegram, Spotify: SiSpotify, SoundCloud: SiSoundcloud, GitHub: SiGithub, Reddit: SiReddit, Twitch: SiTwitch, Snapchat: SiSnapchat, Facebook: SiFacebook, LinkedIn: FaLinkedin, Steam: SiSteam, Roblox: SiRoblox, PayPal: SiPaypal, Pinterest: SiPinterest, Patreon: SiPatreon, Threads: SiThreads, Kick: SiKick, Bitcoin: FaBitcoin, Ethereum: FaEthereum, Litecoin: FaLitecoinSign, Solana: SiSolana, Email: Mail, "Custom URL": FaLink };

export function SocialIcon({ platform, size = 18, color, customIcon, monochrome = false }: { platform: SocialPlatform; size?: number; color?: string; customIcon?: SocialLink["customIcon"]; monochrome?: boolean }) {
  if (isSafeSocialIconUrl(customIcon?.url)) {
    if (monochrome && color) {
      return (
        <span
          aria-hidden="true"
          className="block rounded-md"
          style={{
            width: size,
            height: size,
            backgroundColor: color,
            WebkitMaskImage: `url("${customIcon.url}")`,
            maskImage: `url("${customIcon.url}")`,
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskPosition: "center",
            WebkitMaskSize: "contain",
            maskSize: "contain",
          }}
        />
      );
    }
    return <img src={customIcon.url} alt="" width={size} height={size} className="h-full w-full rounded-md object-contain" />;
  }
  const Icon = icons[platform] || FaLink;
  return <Icon size={size} color={color} style={color ? { color, fill: color } : undefined} aria-hidden="true" />;
}
