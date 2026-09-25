import type { ProfileConfig, ProfileBadge, SocialLink } from "./types";

export const mockSocials: SocialLink[] = [
  { id: "discord", platform: "Discord", label: "Discord", value: "demo", enabled: true, displayMode: "text", clicks: 0 },
  { id: "instagram", platform: "Instagram", label: "Instagram", value: "instagram.com/demo", enabled: true, displayMode: "link", clicks: 0 },
  { id: "youtube", platform: "YouTube", label: "YouTube", value: "youtube.com/@demo", enabled: true, displayMode: "link", clicks: 0 },
  { id: "telegram", platform: "Telegram", label: "Telegram", value: "t.me/demo", enabled: true, displayMode: "link", clicks: 0 },
  { id: "github", platform: "GitHub", label: "GitHub", value: "github.com/demo", enabled: true, displayMode: "link", clicks: 0 },
];

const badgeInfo: Array<[ProfileBadge["name"], string, string]> = [
  ["Verified", "Verified creator", "#8f8dff"],
  ["Premium", "Premium member", "#d9a4ff"],
  ["Staff", "Misa.lol staff", "#ff9fcf"],
  ["Helper", "Community helper", "#76d9c8"],
  ["Donor", "Generous supporter", "#ffcb71"],
  ["Gifter", "Community gifter", "#ff8f9d"],
  ["OG", "Original member", "#98adff"],
  ["Server Booster", "Server booster", "#f69bd7"],
  ["Bug Hunter", "Bug hunter", "#bbd968"],
  ["Winner", "Event winner", "#ffcf76"],
  ["Second Place", "Second place", "#bbc6d8"],
  ["Third Place", "Third place", "#c69470"],
];

export const mockBadges: ProfileBadge[] = badgeInfo.map(([name, description, color], index) => ({
  id: name.toLowerCase().replaceAll(" ", "-"), name, description,
  owned: [0, 1, 6].includes(index), enabled: [0, 1, 6].includes(index), color, monochrome: false,
}));

export const mockProfile: ProfileConfig = {
  profile: { username: "demo", displayName: "Demo User", description: "A little corner of the internet.", location: "", views: 0, uid: "1000001", joinedAt: "2026-01-01T00:00:00Z" },
  settings: {
    accentColor: "#9b87f5", usernameColor: "#ffffff", usernameEffectColor: "#e11d48", textColor: "#ffffff", backgroundColor: "#08080d", iconColor: "#d8d3ff",
    profileOpacity: 10, backgroundOpacity: 88, profileBlur: 24, profileRadius: 24, profileFrameOpacity: 100, profileGradient: true, showViews: true, showBadges: true, showSocials: true, showJoinDate: false, showDiscordStatus: true, showUsername: true, socialAlign: "center",
    cardAlign: "center", showProfileFrame: true, showAvatar: true, showAvatarBorder: true, showDisplayName: true, profileFrameScale: 100, profileFrameWidth: 430, profileFrameHeight: 0, profileFrameX: 0, profileFrameY: 0, layout: "Modern", avatarShape: "circle", bannerShape: "rounded", buttonStyle: "glass", profileFont: "Inter", profileFontScope: "name", fontSize: 16, letterSpacing: 0, bioTypewriter: false, bioTypeMs: 55, bioDeleteMs: 35, bioPauseMs: 1200, tabTitleAnimate: false, borderColor: "#ffffff", borderWidth: 1, cardTilt: false,
    entryScreen: true, entryText: "click to enter...", pageEnter: "Fade", clickSound: false, backgroundEffect: "None", usernameEffect: "Glow",
    usernameGlow: true, socialGlow: true, badgeGlow: true, monochromeIcons: false, widgetColorSwap: false,
    ogTitle: "", ogDescription: "", ogOverlayAvatar: true, ogOverlayName: true, ogOverlayAddress: true,
  },
  assets: { avatar: { url: null }, banner: { url: null }, background: { url: null }, backgroundVideo: { url: null }, backgroundEffectVideo: { url: null }, audio: { url: null }, audioArtwork: { url: null }, audioTitle: "", tracks: [], cursor: { url: null }, ogImage: { url: null }, favicon: { url: null }, customFont: { url: null }, clickSound: { url: null }, audioEnabled: true, volume: 65 },
  socials: mockSocials,
  badges: mockBadges,
  widgets: [],
  sections: [],
};

export const cloneMockProfile = (): ProfileConfig => structuredClone(mockProfile);

export const platformOptions: ProfileConfig["socials"][number]["platform"][] = [
  "YouTube", "Discord", "Instagram", "X", "TikTok", "Telegram", "Spotify", "SoundCloud", "GitHub", "Reddit", "Twitch", "Snapchat", "Facebook", "LinkedIn", "Steam", "Roblox", "PayPal", "Pinterest", "Patreon", "Threads", "Kick", "Bitcoin", "Ethereum", "Litecoin", "Solana", "Email", "Custom URL",
];
