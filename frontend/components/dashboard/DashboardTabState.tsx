"use client";

import { useEffect } from "react";

const SLEEP_TITLE = "zzz... come back \u2014 misa.lol";
const SLEEP_ICON = "/dashboard/favicon-sleep.png";

export function DashboardTabState() {
  useEffect(() => {
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]'));
    const normalTitle = document.title;
    const saved = links.map((element) => ({ element, href: element.getAttribute("href"), type: element.getAttribute("type") }));
    const apply = () => {
      const sleeping = document.visibilityState === "hidden";
      document.title = sleeping ? SLEEP_TITLE : normalTitle;
      saved.forEach(({ element, href, type }) => {
        element.setAttribute("href", sleeping ? SLEEP_ICON : href || "/dashboard/favicon-awake.png");
        if (sleeping) element.setAttribute("type", "image/png");
        else if (type === null) element.removeAttribute("type");
        else element.setAttribute("type", type);
      });
    };
    document.addEventListener("visibilitychange", apply);
    apply();
    return () => document.removeEventListener("visibilitychange", apply);
  }, []);
  return null;
}
