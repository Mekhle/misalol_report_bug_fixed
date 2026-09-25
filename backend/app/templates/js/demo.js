/* Static demo shim — backend removed, so auth forms + /api calls are stubbed. */
(function () {
  "use strict";
  window.__MISA_DEMO__ = true;
  window.MISA_CONFIG = window.MISA_CONFIG || { turnstileSiteKey: "" };
  window.MISA_TURNSTILE_SITE_KEY = window.MISA_TURNSTILE_SITE_KEY || "";
  var DEMO_TEXT = "Demo preview — the backend was removed, so this form doesn't send anywhere. Hook it to your API to go live.";
  function demoMessage(text) {
    var box = document.getElementById("auth-message");
    if (box) { box.hidden = false; box.textContent = text; box.classList.add("is-visible"); }
    else { alert(text); }
  }
  function fixWallMore(scope) {
    (scope || document).querySelectorAll("[data-wall-more]").forEach(function (w) {
      var h = w.getAttribute("href") || "";
      var m = h.match(/^(.*)#([^?]*)\?(.*)$/);
      if (m) w.setAttribute("href", m[1] + "?" + m[3] + "#" + m[2]);
    });
  }
  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (f && (f.id === "login-form" || f.id === "signup-form")) {
      e.preventDefault(); e.stopPropagation();
      demoMessage(DEMO_TEXT);
    }
  }, true);
  document.addEventListener("click", function (e) {
    var t = e.target;
    var oauth = t.closest && t.closest(".social-auth__button");
    if (oauth) { e.preventDefault(); e.stopPropagation(); demoMessage(DEMO_TEXT); return; }
    var w = t.closest && t.closest("[data-wall-more]");
    if (w) {
      var h = w.getAttribute("href") || "";
      var m = h.match(/^(.*)#([^?]*)\?(.*)$/);
      if (m) w.setAttribute("href", m[1] + "?" + m[3] + "#" + m[2]);
    }
  }, true);
  function unlock() {
    document.querySelectorAll(".turnstile-box").forEach(function (el) { el.hidden = true; });
    document.querySelectorAll(".auth-lock.is-locked").forEach(function (el) {
      el.classList.remove("is-locked");
      try { el.inert = false; } catch (_) {}
      el.removeAttribute("inert");
      if (/^(INPUT|BUTTON|SELECT|TEXTAREA)$/.test(el.tagName)) el.disabled = false;
      el.querySelectorAll("input,button,textarea,select").forEach(function (n) { n.disabled = false; });
      el.querySelectorAll("a").forEach(function (n) { n.removeAttribute("tabindex"); });
    });
    document.querySelectorAll("[data-lock-note]").forEach(function (g) {
      var spans = g.querySelectorAll("span");
      for (var i = 0; i < spans.length; i++) {
        if (!spans[i].classList.contains("dot")) spans[i].textContent = "Demo preview — human check skipped, the form is unlocked.";
      }
      g.classList.add("is-open");
    });
    fixWallMore(document);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", unlock);
  else unlock();
  if (window.fetch) {
    var rawFetch = window.fetch.bind(window);
    window.fetch = function (url, opts) {
      var u = String((url && url.url) || url || "");
      if (u.indexOf("/api/") !== -1) {
        if (u.indexOf("available?username=") !== -1) {
          return Promise.resolve(new Response(JSON.stringify({ available: true, username: null }),
            { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        return Promise.resolve(new Response(JSON.stringify({ detail: DEMO_TEXT }),
          { status: 400, headers: { "Content-Type": "application/json" } }));
      }
      return rawFetch(url, opts);
    };
  }
})();
