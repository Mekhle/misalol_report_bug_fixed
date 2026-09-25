from typing import Any


def section_has_content(item: dict[str, Any]) -> bool:
    kind = str(item.get("type") or "")
    if kind in {"about", "integration"} and any((item.get(side) or {}).get("enabled") for side in ("leftCard", "rightCard")):
        return True
    if kind == "lyrics":
        return True
    if kind == "skills":
        return bool(item.get("tags"))
    if kind == "project":
        cover = item.get("cover") if isinstance(item.get("cover"), dict) else {}
        return bool(item.get("title") or item.get("body") or item.get("href") or cover.get("url"))
    return bool(str(item.get("body") or "").strip() or str(item.get("title") or "").strip() or item.get("subtitle") or item.get("tags"))


def project_configured(item: dict[str, Any]) -> bool:
    return bool(str(item.get("body") or "").strip() or str(item.get("href") or "").strip() or (item.get("cover") or {}).get("url") or item.get("tags"))


def visible_sections(items: list) -> list[dict]:
    enabled = [item for item in items if isinstance(item, dict) and item.get("enabled")]
    about = next((item for item in enabled if item.get("type") == "about"), None)
    skills = [tag for item in enabled if item.get("type") == "skills" for tag in item.get("tags") or []]
    result = []
    index = 0
    while index < len(enabled):
        item = enabled[index]
        index += 1
        kind = item.get("type")
        if kind == "skills" and (about is not None or not item.get("tags")):
            continue
        if item is about:
            item = {**item, "tags": list(dict.fromkeys([*(item.get("tags") or []), *skills]))}
        if kind == "project":
            group = [item]
            while index < len(enabled) and enabled[index].get("type") == "project":
                group.append(enabled[index])
                index += 1
            result.extend([entry for entry in group if project_configured(entry)] or group[:1])
        elif kind == "integration" or section_has_content(item):
            result.append(item)
    return result
