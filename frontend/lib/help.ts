export type HelpCategory = "Setup" | "Customize" | "Account" | "Troubleshooting";

export interface HelpArticle {
  id: string;
  category: HelpCategory;
  title: string;
  summary: string;
  href?: string;
  body: string[];
  tags: string[];
}

export const HELP_CATEGORIES: HelpCategory[] = ["Setup", "Customize", "Account", "Troubleshooting"];
export const SUPPORT_EMAIL = "support@misa.lol";

export const helpArticles: HelpArticle[] = [
  {
    id: "claim-username",
    category: "Setup",
    title: "Claim a username and open your page",
    summary: "Your public address is misa.lol/yourname.",
    href: "/settings",
    tags: ["username", "setup", "live page", "share"],
    body: [
      "Claim a username in Settings before you save a profile. It must start with a letter and can use letters, numbers, or underscores.",
      "Your live page is misa.lol/yourname. Share it from Overview, or use Help Center → View your live profile.",
      "The account id (UID) never changes. Analytics and templates stay attached to that id if you rename later.",
    ],
  },
  {
    id: "save-changes",
    category: "Setup",
    title: "Save changes to the live card",
    summary: "Nothing goes live until you press Save changes.",
    href: "/customize",
    tags: ["save", "autosave", "live", "customize"],
    body: [
      "Customize does not autosave. Edit the preview, then press Save changes.",
      "If the live page looks old, you still have unsaved edits, or the last save failed. Check the save error on Customize and try again.",
      "Settings has its own Save changes button for display name. Username uses Change / Confirm on that same page.",
    ],
  },
  {
    id: "share-page",
    category: "Setup",
    title: "Share your page and QR code",
    summary: "Copy the public link or download a QR from Overview.",
    href: "/",
    tags: ["share", "qr", "og", "link"],
    body: [
      "Overview shows your public link and a QR code. On misa.lol those always point at https://misa.lol/yourname.",
      "Customize → Sharing appearance sets the title, description, favicon, and optional overlay for chat previews.",
      "The share image is composed on the server. After you save, give previews a minute to refresh.",
    ],
  },
  {
    id: "customize-look",
    category: "Customize",
    title: "Layouts, colors, and alignment",
    summary: "Modern, Simplistic, and Sleek are skins, not a second effects system.",
    href: "/customize",
    tags: ["layout", "colors", "alignment", "card"],
    body: [
      "Pick Modern, Simplistic, or Sleek in Customize. That changes the card chrome, not a separate effects engine.",
      "Accent, text, background, and icon colors apply to the card. Widget color swap recolors the music player and profile widgets.",
      "Effects → Font picks a stack or a custom WOFF/TTF. Text size and letter spacing apply to the card. Typewriter bio uses one description line at a time.",
      "Page enter (fade, unfold, pop) plays after click to enter. Customize preview uses the same overlay so you can test it. Reduced motion skips the motion and tilt.",
      "Icon alignment moves socials, location, and views together. Card alignment moves the whole card on the page.",
    ],
  },
  {
    id: "media-assets",
    category: "Customize",
    title: "Avatar, background, and cursor",
    summary: "Upload images or video, then save. Public pages never inline those files.",
    href: "/customize",
    tags: ["avatar", "banner", "background", "cursor", "gif"],
    body: [
      "Upload an avatar, banner, background, background video, or cursor in Customize. GIFs work for avatars.",
      "Crop and zoom when you pick a still image. The public page serves media from /api/v1/profile/yourname/assets/… so the HTML stays small.",
      "A missing or huge file can fail the save. Use a smaller file and press Save changes again.",
    ],
  },
  {
    id: "social-links",
    category: "Customize",
    title: "Add and edit social links",
    summary: "Links are your real profiles. Applying a template does not overwrite them.",
    href: "/links",
    tags: ["links", "socials", "icons", "copy"],
    body: [
      "Add platforms on Links. Each item can open a URL or copy text. Custom icons must be a raster image, not a script.",
      "You can set a per-link color. Monochrome icons in Customize paints every icon with the icon color.",
      "Templates copy the look of your card. They do not replace the links you already added.",
    ],
  },
  {
    id: "music-player",
    category: "Customize",
    title: "Music player and tracks",
    summary: "Skip changes the track without reloading the page.",
    href: "/customize",
    tags: ["audio", "player", "tracks", "playlist"],
    body: [
      "Add tracks in Customize. The player on the card swaps the current song when you skip. It does not refresh the page.",
      "The Customize preview does not autoplay audio. Open the live page to hear how visitors hear it.",
      "A playlist that is too large will fail to save. Use smaller files or fewer tracks.",
    ],
  },
  {
    id: "profile-widgets",
    category: "Customize",
    title: "Profile widgets",
    summary: "Optional cards for YouTube, Spotify, Discord, and more.",
    href: "/customize",
    tags: ["widgets", "youtube", "spotify", "discord", "github", "weather"],
    body: [
      "Open Customize and use the Widgets tab. Add up to eight cards: YouTube, Spotify, Discord server, Telegram, Roblox, GitHub, Last.fm, timezone, or weather.",
      "The preview fetches live data. Empty, loading, and error states stay on the card so you can see what visitors will get. Last.fm needs a server API key.",
      "Save changes to publish. Templates do not overwrite your widgets. Widget color swap paints these cards the same way as the music player.",
    ],
  },
  {
    id: "portfolio-sections",
    category: "Customize",
    title: "Portfolio sections",
    summary: "About, projects, skills, custom text, and synced lyrics.",
    href: "/customize",
    tags: ["portfolio", "about", "projects", "skills", "lyrics", "markdown"],
    body: [
      "Open Customize and use the Portfolio tab. Add About Me, projects, skills, custom text, or synced lyrics. You can reorder, hide, or remove each block the same way as widgets.",
      "About and custom text accept Markdown: bold, italic, lists, and http or mailto links. Project covers stay on the server and are not inlined in the public HTML.",
      "Lyrics can use [mm:ss.xx] timestamps and follow the profile music player. The Customize preview does not autoplay. Templates do not overwrite your sections.",
    ],
  },
  {
    id: "badges-help",
    category: "Customize",
    title: "Badges on your card",
    summary: "You can only show badges you actually own.",
    href: "/badges",
    tags: ["badges", "verified", "color"],
    body: [
      "Badges are granted by staff. On Badges you can reorder owned ones, change color, and use monochrome.",
      "The public card only shows badges you own. Widget color swap does not paint badges.",
      "Apply for verification on Badges. Staff review the request and grant the Verified badge. Custom badges are created and assigned in Admin.",
    ],
  },
  {
    id: "templates-help",
    category: "Customize",
    title: "Apply or publish a template",
    summary: "Apply updates your saved profile. Publishing is for creators.",
    href: "/templates",
    tags: ["templates", "gallery", "creator"],
    body: [
      "Templates → Apply writes the look to your saved profile. Your name, links, badges, Discord, and avatar stay yours.",
      "Publishing snapshots your last saved Customize look and puts it in the shared gallery. That needs the template creator role.",
      "If Apply is disabled, claim a username first. If Publish is hidden, you are not a creator.",
    ],
  },
  {
    id: "discord-card",
    category: "Customize",
    title: "Show Discord on your card",
    summary: "Connect Discord in Settings. Online status is not available.",
    href: "/settings",
    tags: ["discord", "avatar", "decoration", "server tag"],
    body: [
      "Connect Discord in Settings. You can show the linked avatar, decoration, and server tag on the public card.",
      "Discord does not give apps your online status, so Misa cannot show that.",
      "If the live bits look stale, use Reconnect. Disconnect removes Discord from the card but keeps the rest of your profile.",
    ],
  },
  {
    id: "change-username",
    category: "Account",
    title: "Change your username",
    summary: "Same account. Old links redirect. The old name stays reserved.",
    href: "/settings",
    tags: ["username", "rename", "redirect", "reserved"],
    body: [
      "In Settings, type the new name, press Change, then Confirm. The account id does not change.",
      "The old address redirects to the new one, including share images. Nobody else can claim the old name.",
      "You can take one of your own old names back. Names like admin, login, or dashboard stay reserved for the site.",
    ],
  },
  {
    id: "display-name",
    category: "Account",
    title: "Change your display name",
    summary: "This is the name on the card, not the URL.",
    href: "/settings",
    tags: ["display name", "profile", "settings"],
    body: [
      "Display name is what people read on the card. The URL still uses your username.",
      "Edit it in Settings or Customize, then press Save changes.",
      "An empty display name cannot be saved.",
    ],
  },
  {
    id: "connected-accounts",
    category: "Account",
    title: "Google, Discord, and Telegram",
    summary: "Link providers from Settings. You can disconnect Discord from there.",
    href: "/settings",
    tags: ["google", "discord", "telegram", "login"],
    body: [
      "Settings → Connected accounts links Google, Telegram, and Discord.",
      "Discord also drives the live avatar, decoration, and server tag. The other providers are for sign-in.",
      "Password, backup codes, sessions, and the 3-account switcher live in Settings. Account deletion still needs support.",
    ],
  },
  {
    id: "analytics-help",
    category: "Account",
    title: "Analytics and views",
    summary: "Your own visits do not count. Check Analytics in a private window.",
    href: "/analytics",
    tags: ["analytics", "views", "clicks", "private"],
    body: [
      "Analytics counts public-card views and link clicks. Preview and dashboard visits are ignored.",
      "Your own signed-in visits do not count. Open the live page in a private window, then refresh Analytics.",
      "Country is read from Cloudflare. On localhost that field stays empty. Views on the card come from the same totals.",
      "Community uses those same public views and clicks for the leaderboard. Private breakdowns stay on Analytics.",
    ],
  },
  {
    id: "community-leaderboard",
    category: "Account",
    title: "Community leaderboard",
    summary: "Ranks public pages by Analytics views or clicks.",
    href: "/community",
    tags: ["community", "leaderboard", "views", "rank"],
    body: [
      "Community ranks live pages that already have public Analytics views or link clicks.",
      "Your own signed-in visits still do not count. Preview and dashboard traffic is ignored.",
      "Suspended accounts and pages without a username stay off the board.",
    ],
  },
  {
    id: "live-page-stale",
    category: "Troubleshooting",
    title: "The live page did not update",
    summary: "Save first, then hard-refresh the public URL.",
    href: "/customize",
    tags: ["save", "cache", "live", "broken"],
    body: [
      "Press Save changes on Customize. If save fails, the live card still has the last successful version.",
      "Open misa.lol/yourname (or the local public URL) and refresh. The Customize preview can be ahead of the live page until you save.",
      "Username on the card always comes from the account. You cannot type a different username in Customize.",
    ],
  },
  {
    id: "name-taken",
    category: "Troubleshooting",
    title: "A username is taken or reserved",
    summary: "Former names stay reserved so old links keep working.",
    href: "/settings",
    tags: ["reserved", "taken", "username", "409"],
    body: [
      "Taken means another account uses it right now. Reserved means the site or a former username is holding it.",
      "If you used a name before, you can usually claim that old name again from Settings.",
      "Admin-reserved words such as login or dashboard cannot be used.",
    ],
  },
  {
    id: "audio-preview",
    category: "Troubleshooting",
    title: "I do not hear audio in Customize",
    summary: "Preview never autoplays. Use the live page to test sound.",
    href: "/customize",
    tags: ["audio", "autoplay", "preview", "player"],
    body: [
      "The Customize preview will not autoplay music. That is intentional.",
      "Press play on the preview player, or open the live page.",
      "If save said the playlist is too large, shrink the files and save again.",
    ],
  },
  {
    id: "account-email",
    category: "Account",
    title: "Change your email",
    summary: "We send a confirmation link to the new address.",
    href: "/settings",
    tags: ["email", "confirm", "settings"],
    body: [
      "In Settings, type the new email. If this account has a password, enter it, then press Send confirmation.",
      "Open the link from the new inbox. Confirmation uses the public site origin, not a reflected Host header.",
      "The old address gets a notice. The change is not live until the new email is confirmed.",
    ],
  },
  {
    id: "recover-password",
    category: "Account",
    title: "Reset a forgotten password",
    summary: "Use Forgot password on the login page. The link works once.",
    href: "/settings",
    tags: ["password", "reset", "forgot", "recovery"],
    body: [
      "On the login page, open Forgot password and enter your email. We always show the same success message so accounts cannot be guessed.",
      "The email link opens /reset-password and lasts 30 minutes. Setting a new password signs out every session.",
      "You can also change a known password from Settings. That signs out other browsers and keeps this one.",
    ],
  },
  {
    id: "backup-codes",
    category: "Account",
    title: "Backup codes",
    summary: "Ten single-use codes after password or social login.",
    href: "/settings",
    tags: ["mfa", "backup", "codes", "security"],
    body: [
      "Settings → Backup codes creates ten XXXX-XXXX codes. They are shown once. We store only hashes.",
      "After your password, or after Google, Discord, or Telegram, enter one unused code to finish signing in.",
      "Generating a new set invalidates unused old codes. Keep at least a few left so you do not lock the account.",
    ],
  },
  {
    id: "sessions-switcher",
    category: "Account",
    title: "Sessions and saved accounts",
    summary: "Revoke other browsers. Switch between up to three accounts on this device.",
    href: "/settings",
    tags: ["sessions", "revoke", "switch", "accounts"],
    body: [
      "Active sessions lists this browser and others we have seen since this feature shipped. Sign out one, or all others.",
      "The login cookie is still one session for one user. A second signed cookie remembers up to three account ids on this browser.",
      "Switching needs both cookies. Forget removes an account from this browser without deleting the account.",
    ],
  },
  {
    id: "contact-support",
    category: "Account",
    title: "Contact support",
    summary: "Email support@misa.lol from the address on this account.",
    tags: ["support", "email", "contact", "help"],
    body: [
      "Email support@misa.lol from the email on this account so we can find you.",
      "Include your username, UID from the sidebar, and what you expected to happen.",
      "Premium and gifts are not sold from the dashboard yet. Those requests still go to the same address.",
    ],
  },
];

export function findHelpArticle(id: string | null | undefined) {
  if (!id) return null;
  return helpArticles.find((item) => item.id === id) || null;
}

export function searchHelp(query: string, category: HelpCategory | "All" = "All") {
  const needle = query.trim().toLowerCase();
  return helpArticles.filter((item) => {
    if (category !== "All" && item.category !== category) return false;
    if (!needle) return true;
    const hay = [item.title, item.summary, item.category, ...item.tags, ...item.body].join(" ").toLowerCase();
    return hay.includes(needle);
  });
}
