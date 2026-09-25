/* ============================================================
   MISA.LOL — tab visibility states
   Hidden tab  -> "zzz... come back — misa.lol" + sleeping favicon.
   Visible tab -> restores this page's own title + favicons.
   Page Visibility API only. No reloads, no framework hooks,
   single listener (guarded against double-binding).
   ============================================================ */
(function () {
  "use strict";
  if (window.__misaTabState) return;
  window.__misaTabState = true;

  var SLEEP_TITLE = "zzz... come back — misa.lol";
  var SLEEP_FILE = "favicon-sleep.png";

  function iconLinks() {
    return Array.prototype.slice.call(
      document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]')
    );
  }

  var links = iconLinks();
  if (!links.length) return;

  var normalTitle = document.title;
  var saved = links.map(function (el) {
    return { el: el, href: el.getAttribute("href"), type: el.getAttribute("type") };
  });

  // The sleep icon lives next to the page's own icons, so this
  // resolves correctly from any page regardless of its path.
  var firstHref = saved[0].href || "";
  var sleepHref = firstHref.slice(0, firstHref.lastIndexOf("/") + 1) + SLEEP_FILE;

  // Warm the cache so the swap paints instantly in Chromium.
  try {
    new Image().src = sleepHref;
  } catch (e) {
    /* favicon still swaps, just uncached */
  }

  function setIcons(sleeping) {
    // Update the EXISTING <link rel="icon"> elements in place —
    // never append duplicates — so Chromium picks the change up.
    saved.forEach(function (s) {
      if (sleeping) {
        s.el.setAttribute("href", sleepHref);
        s.el.setAttribute("type", "image/png");
      } else {
        s.el.setAttribute("href", s.href);
        if (s.type === null) s.el.removeAttribute("type");
        else s.el.setAttribute("type", s.type);
      }
    });
  }

  function apply() {
    if (document.visibilityState === "hidden") {
      if (document.title !== SLEEP_TITLE) document.title = SLEEP_TITLE;
      setIcons(true);
    } else {
      if (document.title !== normalTitle) document.title = normalTitle;
      setIcons(false);
    }
  }

  document.addEventListener("visibilitychange", apply);
  apply(); // the page itself may load already-hidden (restored background tab)
})();
