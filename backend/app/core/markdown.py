import re
from html import escape, unescape

from app.core.network_safety import safe_public_url

LINK = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
CODE = re.compile(r"`([^`]+)`")
BOLD = re.compile(r"\*\*([^*]+)\*\*")
ITALIC = re.compile(r"(?<!\*)\*([^*]+)\*(?!\*)")
HEADING = re.compile(r"^(#{1,3})\s+(.+)$")


def render_safe_markdown(text: str) -> str:
    source = (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not source:
        return ""
    blocks: list[str] = []
    list_items: list[str] = []
    list_kind = ""
    for raw in source.split("\n"):
        line = raw.rstrip()
        stripped = line.strip()
        if stripped.startswith("- ") or stripped.startswith("* "):
            if list_kind == "ol":
                blocks.append(_list_html(list_kind, list_items))
                list_items = []
            list_kind = "ul"
            list_items.append(_inline(stripped[2:]))
            continue
        if re.match(r"^\d+\.\s+", stripped):
            if list_kind == "ul":
                blocks.append(_list_html(list_kind, list_items))
                list_items = []
            list_kind = "ol"
            list_items.append(_inline(re.sub(r"^\d+\.\s+", "", stripped)))
            continue
        if list_items:
            blocks.append(_list_html(list_kind, list_items))
            list_items = []
            list_kind = ""
        if not stripped:
            continue
        heading = HEADING.match(stripped)
        if heading:
            level = min(len(heading.group(1)), 3) + 1
            blocks.append(f"<h{level}>{_inline(heading.group(2))}</h{level}>")
            continue
        blocks.append(f"<p>{_inline(stripped)}</p>")
    if list_items:
        blocks.append(_list_html(list_kind, list_items))
    return "".join(blocks)


def _list_html(kind: str, items: list[str]) -> str:
    tag = "ol" if kind == "ol" else "ul"
    return f"<{tag}>{''.join(f'<li>{item}</li>' for item in items)}</{tag}>"


def _inline(text: str) -> str:
    escaped = escape(text)

    def link(match: re.Match[str]) -> str:
        label = match.group(1)
        raw_href = unescape(match.group(2))
        href = _safe_href(raw_href)
        if not href:
            return label
        return f'<a href="{escape(href, quote=True)}" target="_blank" rel="noopener noreferrer">{label}</a>'

    escaped = LINK.sub(link, escaped)
    escaped = CODE.sub(lambda match: f"<code>{match.group(1)}</code>", escaped)
    escaped = BOLD.sub(lambda match: f"<strong>{match.group(1)}</strong>", escaped)
    escaped = ITALIC.sub(lambda match: f"<em>{match.group(1)}</em>", escaped)
    return escaped


def _safe_href(url: str) -> str | None:
    text = (url or "").strip()
    lower = text.lower()
    if lower.startswith(("javascript:", "data:", "vbscript:", "file:")):
        return None
    if lower.startswith("mailto:"):
        address = text.split(":", 1)[1].strip()
        return f"mailto:{address}" if re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+", address) else None
    candidate = text if "://" in text else f"https://{text}"
    return safe_public_url(candidate)
