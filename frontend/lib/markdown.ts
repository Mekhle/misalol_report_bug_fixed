const LINK = /\[([^\]]+)\]\(([^)]+)\)/g;
const CODE = /`([^`]+)`/g;
const BOLD = /\*\*([^*]+)\*\*/g;
const ITALIC = /(?<!\*)\*([^*]+)\*(?!\*)/g;

export function renderSafeMarkdown(text: string) {
  const source = (text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!source) return "";
  const blocks: string[] = [];
  let listItems: string[] = [];
  let listKind = "";
  for (const raw of source.split("\n")) {
    const stripped = raw.trim();
    if (stripped.startsWith("- ") || stripped.startsWith("* ")) {
      if (listKind === "ol") {
        blocks.push(listHtml(listKind, listItems));
        listItems = [];
      }
      listKind = "ul";
      listItems.push(inline(stripped.slice(2)));
      continue;
    }
    if (/^\d+\.\s+/.test(stripped)) {
      if (listKind === "ul") {
        blocks.push(listHtml(listKind, listItems));
        listItems = [];
      }
      listKind = "ol";
      listItems.push(inline(stripped.replace(/^\d+\.\s+/, "")));
      continue;
    }
    if (listItems.length) {
      blocks.push(listHtml(listKind, listItems));
      listItems = [];
      listKind = "";
    }
    if (!stripped) continue;
    const heading = /^(#{1,3})\s+(.+)$/.exec(stripped);
    if (heading) {
      const level = Math.min(heading[1].length, 3) + 1;
      blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    blocks.push(`<p>${inline(stripped)}</p>`);
  }
  if (listItems.length) blocks.push(listHtml(listKind, listItems));
  return blocks.join("");
}

function listHtml(kind: string, items: string[]) {
  const tag = kind === "ol" ? "ol" : "ul";
  return `<${tag}>${items.map((item) => `<li>${item}</li>`).join("")}</${tag}>`;
}

function inline(text: string) {
  let escaped = escapeHtml(text);
  escaped = escaped.replace(LINK, (_all, label: string, href: string) => {
    const rawHref = unescapeHtml(href);
    const safe = safeHref(rawHref);
    return safe ? `<a href="${escapeAttr(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
  });
  escaped = escaped.replace(CODE, (_all, value: string) => `<code>${value}</code>`);
  escaped = escaped.replace(BOLD, (_all, value: string) => `<strong>${value}</strong>`);
  escaped = escaped.replace(ITALIC, (_all, value: string) => `<em>${value}</em>`);
  return escaped;
}

function unescapeHtml(value: string) {
  return value.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ({
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
  }[entity] || entity));
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] || ch));
}

function escapeAttr(value: string) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function safeHref(url: string) {
  const text = (url || "").trim();
  const lower = text.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("vbscript:") || lower.startsWith("file:")) return "";
  if (lower.startsWith("mailto:")) {
    const address = text.slice(7).trim();
    return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address) ? `mailto:${address}` : "";
  }
  try {
    const parsed = new URL(text.includes("://") ? text : `https://${text}`);
    const host = (parsed.hostname || "").toLowerCase();
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username) return "";
    if (!host || host === "javascript" || host === "vbscript" || host === "data") return "";
    return text.includes("://") ? text : `https://${text}`;
  } catch {
    return "";
  }
}
