export type SocialPlatform =
  | "YouTube" | "Discord" | "Instagram" | "X" | "TikTok" | "Telegram"
  | "Spotify" | "SoundCloud" | "GitHub" | "Reddit" | "Twitch" | "Snapchat"
  | "Facebook" | "LinkedIn" | "Steam" | "Roblox" | "PayPal" | "Pinterest"
  | "Threads" | "Kick"
  | "Patreon" | "Bitcoin" | "Ethereum" | "Litecoin" | "Solana" | "Email" | "Custom URL";

export type BadgeName = "Verified" | "Premium" | "Staff" | "Helper" | "Donor" | "Gifter" | "OG" | "Server Booster" | "Bug Hunter" | "Winner" | "Second Place" | "Third Place";
export type BackgroundEffect = "None" | "Snowflakes" | "Snow" | "Sakura" | "Rain" | "Fireflies";
export type UsernameEffect = "None" | "Glow" | "Gradient" | "Shimmer" | "Rainbow" | "Fuzzy" | "Shuffle" | "Sparkle" | "Glitch" | "Pulse" | "Wave" | "Shadow";
export type SocialAlign = "left" | "center" | "right";
export type SocialAction = "open" | "copy";
export type ProfileLayout = "Default" | "Modern" | "Simplistic" | "Sleek" | "Portfolio";
export type ProfileShape = "circle" | "rounded" | "square";
export type BannerShape = "rounded" | "square" | "pill";
export type ButtonStyle = "glass" | "solid" | "outline";
export type ProfileFont = "Inter" | "font-2" | "font-3" | "font-4" | "font-5" | "font-6" | "font-7" | "font-8" | "font-9" | "font-10" | "font-11";
export type PageEnter = "None" | "Fade" | "Unfold" | "Pop";

export interface ProfileAsset {
  url: string | null;
  name?: string;
  type?: string;
  /** Set only for an explicit user removal. */
  remove?: boolean;
}

export interface LyricsRecording { id: number; title: string; artist: string; album: string; duration: number }

export interface AudioTrack {
  recording?: LyricsRecording | null;
  id: string;
  title: string;
  audio: ProfileAsset;
  artwork: ProfileAsset;
}

export interface SocialLink {
  id: string;
  platform: SocialPlatform;
  label: string;
  value: string;
  enabled: boolean;
  displayMode: "link" | "text";
  clicks: number;
  action?: SocialAction;
  iconColor?: string | null;
  iconGlow?: boolean;
  customIcon?: ProfileAsset | null;
}

export type WidgetType = "youtube" | "spotify" | "discord" | "telegram" | "roblox" | "github" | "lastfm" | "timezone" | "weather";

export type SectionType = "about" | "project" | "skills" | "text" | "lyrics" | "integration";

export interface ProfileSection {
  id: string;
  type: SectionType;
  enabled: boolean;
  title: string;
  body: string;
  href?: string;
  tags?: string[];
  cover?: ProfileAsset | null;
  subtitle?: string;
  leftCard?: import("./premium").IntegrationCard;
  rightCard?: import("./premium").IntegrationCard;
}

export interface ProfileWidget {
  id: string;
  type: WidgetType;
  enabled: boolean;
  value: string;
}

export interface ResolvedWidget {
  id: string;
  type: WidgetType;
  status: "ok" | "error" | "empty";
  title: string;
  subtitle: string;
  image: string | null;
  href: string | null;
  meta?: { provider?: string; timezone?: string; iso?: string };
}

export interface ProfileBadge {
  id: string;
  name: BadgeName | string;
  description: string;
  owned: boolean;
  enabled: boolean;
  color: string;
  monochrome?: boolean;
  icon?: string;
  previewUrl?: string;
  assetUrl?: string;
  animated?: boolean;
  rarity?: string;
}

export interface ProfileConfig {
  profile: {
    username: string;
    displayName: string;
    description: string;
    location: string;
    views: number;
    uid: string;
    joinedAt?: string;
  };
  settings: {
    premium?: import("./premium").PremiumSettings;
    accentColor: string;
    usernameColor?: string;
    usernameEffectColor?: string;
    textColor: string;
    backgroundColor: string;
    iconColor: string;
    profileOpacity: number;
    backgroundOpacity: number;
    profileBlur: number;
    profileRadius: number;
    profileFrameOpacity: number;
    profileGradient: boolean;
    showViews: boolean;
    showBadges: boolean;
    showSocials: boolean;
    showJoinDate?: boolean;
    showDiscordStatus?: boolean;
    showUsername?: boolean;
    socialAlign?: SocialAlign;
    cardAlign?: SocialAlign;
    showProfileFrame?: boolean;
    showAvatar?: boolean;
    showAvatarBorder?: boolean;
    showDisplayName?: boolean;
    elementLayouts?: import("./element-layout").ElementLayouts;
    profileFrameScale?: number;
    profileFrameWidth?: number;
    profileFrameHeight?: number;
    profileFrameX?: number;
    profileFrameY?: number;
    layout?: ProfileLayout;
    avatarShape?: ProfileShape;
    bannerShape?: BannerShape;
    buttonStyle?: ButtonStyle;
    profileFont?: ProfileFont;
    profileFontScope?: "all" | "name";
    fontSize?: number;
    letterSpacing?: number;
    bioTypewriter?: boolean;
    bioTypeMs?: number;
    bioDeleteMs?: number;
    bioPauseMs?: number;
    tabTitleAnimate?: boolean;
    borderColor?: string;
    borderWidth?: number;
    cardTilt?: boolean;
    entryScreen: boolean;
    entryText: string;
    pageEnter?: PageEnter;
    clickSound?: boolean;
    backgroundEffect: BackgroundEffect;
    usernameEffect: UsernameEffect;
    usernameGlow: boolean;
    socialGlow: boolean;
    badgeGlow: boolean;
    monochromeIcons?: boolean;
    widgetColorSwap?: boolean;
    ogTitle?: string;
    ogDescription?: string;
    ogOverlayAvatar?: boolean;
    ogOverlayName?: boolean;
    ogOverlayAddress?: boolean;
  };
  assets: {
    avatar: ProfileAsset;
    banner?: ProfileAsset;
    background: ProfileAsset;
    backgroundVideo: ProfileAsset;
    backgroundEffectVideo?: ProfileAsset;
    audio: ProfileAsset;
    audioArtwork: ProfileAsset;
    audioTitle: string;
    tracks: AudioTrack[];
    cursor: ProfileAsset;
    ogImage?: ProfileAsset;
    favicon?: ProfileAsset;
    customFont?: ProfileAsset;
    clickSound?: ProfileAsset;
    entryIcon?: ProfileAsset;
    audioEnabled: boolean;
    audioSource?: "video" | "standalone" | "tracks";
    volume: number;
  };
  socials: SocialLink[];
  badges: ProfileBadge[];
  widgets: ProfileWidget[];
  sections: ProfileSection[];
  rank?: {
    id: string;
    slug: string;
    name: string;
    description: string;
    level: number;
    color: string;
  } | null;
  discord?: {
    avatar?: string | null;
    accountAvatar?: string | null;
    username?: string | null;
    globalName?: string | null;
    decoration?: string | null;
    guildTag?: { tag: string; badge: string } | null;
    status?: "online" | "idle" | "dnd" | "offline" | null;
  };
}
