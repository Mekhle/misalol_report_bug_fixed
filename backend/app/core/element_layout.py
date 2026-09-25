"""Versioned, optional layout settings. Legacy profiles need no database migration."""
import math


def bounded(value, low, high, default=0):
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        return default
    return round(max(low, min(high, value)))


def normalize_box(element, value):
    return {
        "x": bounded(value.get("x"), -100, 100),
        "y": bounded(value.get("y"), -400 if element == "frame" else 0, 400),
        "width": bounded(value.get("width"), 260 if element == "frame" else 160, 1040) if value.get("width") else 0,
        "height": bounded(value.get("height"), 0, 1000),
    }


def normalize_layouts(value):
    if not isinstance(value, dict) or value.get("version") not in (1, 2):
        return None
    result = {"version": 2}
    for viewport in ("desktop", "mobile"):
        boxes = value.get(viewport)
        if isinstance(boxes, dict):
            result[viewport] = {}
            for element, box in boxes.items():
                if not isinstance(box, dict) or not (element in ("frame", "discord", "audio") or (element.startswith("widget:") and 7 < len(element) <= 167)):
                    continue
                # Old desktop audio offsets were relative to the entire viewport.
                if value["version"] == 1 and viewport == "desktop" and element == "audio":
                    box = {**box, "x": 0, "y": 0}
                result[viewport][element] = normalize_box(element, box)
    return result


def element_box(settings, element, viewport):
    layouts = normalize_layouts(settings.get("elementLayouts")) or {}
    saved = layouts.get(viewport, {}).get(element)
    if saved is not None:
        return saved
    if element != "frame" or viewport == "mobile":
        return {"x": 0, "y": 0, "width": 0, "height": 0}
    width = settings.get("profileFrameWidth", 430)
    return normalize_box(element, {
        "x": settings.get("profileFrameX", 0) * 2 + {"left": -100, "right": 100}.get(settings.get("cardAlign"), 0),
        "y": max(0, settings.get("profileFrameY", 0) * 4),
        "width": (880 if width == 430 else width) * settings.get("profileFrameScale", 100) / 100,
        "height": settings.get("profileFrameHeight", 0),
    })


def element_style(settings, element):
    values = []
    for viewport in ("desktop", "mobile"):
        box = element_box(settings, element, viewport)
        width = f'{box["width"]}px' if box["width"] else "100%"
        values.extend((f"--{viewport}-width:{width}", f'--{viewport}-height:{box["height"]}px', f'--{viewport}-x:{(box["x"] + 100) / 200}', f'--{viewport}-y:{box["y"]}px'))
    return ";".join(values)
