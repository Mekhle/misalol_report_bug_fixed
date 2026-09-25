/* ============================================
   MISA.LOL — Auth
   Login, signup, session, legacy-page compatibility
   ============================================ */

const AUTH_ERRORS = {
  oauth_denied: "That sign-in was cancelled.",
  oauth_failed: "Sign-in failed. Try again.",
  already_linked: "That account is already linked to a different user.",
  email_taken: "That email is already used by another account.",
  account_exists: "An account with that email already exists. Log in, then connect this provider from the dashboard.",
  google_not_configured: "Google login is not configured yet.",
  discord_not_configured: "Discord login is not configured yet.",
  telegram_not_configured: "Telegram login is not configured yet.",
  apple_not_configured: "Apple login is not configured yet.",
  turnstile: "Complete the human verification first.",
  invalid: "Invalid email or password.",
};

function setTurnstileToken(token) {
  window.__misaTurnstileToken = token || "";
}

function authLocks() {
  return document.querySelectorAll(".auth-lock");
}

function isFormControl(el) {
  return (
    el instanceof HTMLButtonElement ||
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  );
}

function setAuthLockState(el, locked) {
  el.classList.toggle("is-locked", locked);
  try {
    el.inert = locked;
  } catch {
    /* older browsers ignore the inert property */
  }
  if (locked) el.setAttribute("inert", "");
  else el.removeAttribute("inert");
  if (isFormControl(el)) el.disabled = locked;
  el.querySelectorAll("input, button, textarea, select").forEach((node) => {
    node.disabled = locked;
  });
  el.querySelectorAll("a").forEach((node) => {
    if (locked) node.setAttribute("tabindex", "-1");
    else node.removeAttribute("tabindex");
  });
}

function lockAuthActions() {
  setTurnstileToken("");
  authLocks().forEach((el) => setAuthLockState(el, true));
}

function unlockAuthActions(token) {
  if (!token) return;
  setTurnstileToken(token);
  authLocks().forEach((el) => setAuthLockState(el, false));
}

function currentTurnstileToken() {
  if (window.__misaTurnstileToken) return window.__misaTurnstileToken;
  const inputs = document.querySelectorAll('input[name="cf-turnstile-response"]');
  for (const input of inputs) {
    if (input.value) return input.value;
  }
  return "";
}

function syncTurnstileGate() {
  const token = currentTurnstileToken();
  if (token) unlockAuthActions(token);
}

window.misaTurnstileSuccess = function (token) {
  unlockAuthActions(token);
  syncTurnstileGate();
};

window.misaTurnstileExpire = function () {
  lockAuthActions();
};

window.misaTurnstileError = function () {
  if (currentTurnstileToken()) {
    syncTurnstileGate();
    return;
  }
  showAuthMessage("Human verification failed to load. Refresh and try again.", "error");
};

function watchTurnstileGate() {
  if (!document.querySelector(".auth-lock")) return;
  syncTurnstileGate();
  const root = document.querySelector(".turnstile-box") || document.body;
  const observer = new MutationObserver(syncTurnstileGate);
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["value"] });
  const started = Date.now();
  const timer = setInterval(() => {
    syncTurnstileGate();
    if (currentTurnstileToken() || Date.now() - started > 120000) clearInterval(timer);
  }, 200);
}

function consumeTurnstileToken() {
  const token = currentTurnstileToken();
  lockAuthActions();
  if (window.turnstile?.reset) {
    try {
      window.turnstile.reset();
    } catch {
      /* widget may already be gone */
    }
  }
  return token;
}

function authMessageBox() {
  return document.getElementById("auth-message");
}

function showAuthMessage(text, kind) {
  const box = authMessageBox();
  if (!box || !text) return;
  box.hidden = false;
  box.textContent = text;
  box.classList.add("is-visible");
  box.classList.toggle("auth-message--error", kind === "error");
  box.classList.toggle("auth-message--ok", kind !== "error");
}

function errorFromApi(data) {
  if (!data) return "Something went wrong.";
  if (typeof data.detail === "string") return data.detail;
  if (Array.isArray(data.detail) && data.detail[0]?.msg) return data.detail[0].msg;
  return "Something went wrong.";
}

async function sendJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function bindLoginForm() {
  const form = document.getElementById("login-form");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.busy) return; // v3.97: a second Enter while it sends does nothing
    const submit = form.querySelector('[type="submit"]');
    const original = submit ? submit.textContent : "";
    form.dataset.busy = "1";
    if (submit) { submit.textContent = "Signing in…"; submit.setAttribute("aria-busy", "true"); }
    try {
      const token = currentTurnstileToken();
      if (!token) {
        showAuthMessage("Complete the human verification first.", "error");
        return;
      }
      const { response, data } = await sendJson("/api/v1/auth/login", {
        email: form.email.value,
        password: form.password.value,
        remember: Boolean(form.remember?.checked),
        turnstile_token: token,
      });
      if (!response.ok) {
        consumeTurnstileToken();
        showAuthMessage(errorFromApi(data), "error");
        return;
      }
      window.location.href = data.redirect || "/dashboard";
    } catch {
      showAuthMessage("Could not reach the server.", "error");
    } finally {
      delete form.dataset.busy;
      if (submit) { submit.textContent = original; submit.removeAttribute("aria-busy"); }
    }
  });
}

function bindSignupForm() {
  const form = document.getElementById("signup-form");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.busy) return; // v3.97: a second Enter while it sends does nothing
    const submit = form.querySelector('[type="submit"]');
    const original = submit ? submit.textContent : "";
    form.dataset.busy = "1";
    if (submit) { submit.textContent = "Creating account…"; submit.setAttribute("aria-busy", "true"); }
    try {
      const token = currentTurnstileToken();
      if (!token) {
        showAuthMessage("Complete the human verification first.", "error");
        return;
      }
      const { response, data } = await sendJson("/api/v1/auth/signup", {
        email: form.email.value,
        password: form.password.value,
        confirm_password: form["confirm-password"].value,
        tos: Boolean(form.tos?.checked),
        username: form.username?.value?.trim().toLowerCase() || null,
        turnstile_token: token,
      });
      if (!response.ok) {
        consumeTurnstileToken();
        showAuthMessage(errorFromApi(data), "error");
        return;
      }
      window.location.href = data.redirect || "/dashboard";
    } catch {
      showAuthMessage("Could not reach the server.", "error");
    } finally {
      delete form.dataset.busy;
      if (submit) { submit.textContent = original; submit.removeAttribute("aria-busy"); }
    }
  });
}

function bindSocialAuth() {
  document.querySelectorAll(".social-auth__button").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (!document.querySelector(".auth-page")) return;
      if (currentTurnstileToken()) return;
      event.preventDefault();
      showAuthMessage("Complete the human verification first.", "error");
    });
  });
}

async function configureSocialAuth() {
  const links = document.querySelectorAll(".social-auth__button");
  if (!links.length) return;
  let providers;
  try {
    const response = await fetch("/api/v1/auth/providers", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    providers = response.ok ? await response.json() : null;
  } catch {
    providers = null;
  }
  const routes = {
    google: "/api/v1/auth/google?next=/dashboard",
    discord: "/api/v1/auth/discord?next=/dashboard",
    telegram: "/api/v1/auth/telegram",
    apple: "/api/v1/auth/apple?next=/dashboard",
  };
  links.forEach((link) => {
    const provider = ["google", "discord", "telegram", "apple"].find((name) =>
      link.classList.contains(`social-auth__button--${name}`),
    );
    if (!provider) return;
    const enabled = providers?.[provider] !== false;
    if (enabled) {
      link.href = routes[provider];
      link.removeAttribute("tabindex");
    } else {
      link.href = "#";
      link.setAttribute("aria-disabled", "true");
    }
  });
}

function bindForgotPassword() {
  document.querySelectorAll(".forgot-link").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      window.location.href = "/forgot-password";
    });
  });
}

function bindForgotForm() {
  const form = document.getElementById("forgot-form");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.busy) return;
    const submit = form.querySelector('[type="submit"]');
    const original = submit ? submit.textContent : "";
    form.dataset.busy = "1";
    if (submit) { submit.textContent = "Sending…"; submit.setAttribute("aria-busy", "true"); }
    try {
      const email = form.email ? form.email.value.trim() : "";
      const { response, data } = await sendJson("/api/v1/auth/forgot", { email });
      if (!response.ok) {
        showAuthMessage(errorFromApi(data), "error");
        return;
      }
      showAuthMessage("If an account exists with that email, a reset link has been sent.", "ok");
    } catch {
      showAuthMessage("Could not reach the server.", "error");
    } finally {
      delete form.dataset.busy;
      if (submit) { submit.textContent = original; submit.removeAttribute("aria-busy"); }
    }
  });
}

function bindResetForm() {
  const form = document.getElementById("reset-form");
  if (!form) return;
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  const tokenInput = document.getElementById("reset-token") || form.token;
  if (tokenInput && token) tokenInput.value = token;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.busy) return;
    const submit = form.querySelector('[type="submit"]');
    const original = submit ? submit.textContent : "";
    const activeToken = tokenInput ? tokenInput.value : token;
    if (!activeToken) {
      showAuthMessage("Missing or invalid reset token.", "error");
      return;
    }
    const password = form.password ? form.password.value : "";
    const confirmPassword = form["confirm-password"] ? form["confirm-password"].value : "";
    if (password !== confirmPassword) {
      showAuthMessage("Passwords do not match.", "error");
      return;
    }
    form.dataset.busy = "1";
    if (submit) { submit.textContent = "Saving…"; submit.setAttribute("aria-busy", "true"); }
    try {
      const { response, data } = await sendJson("/api/v1/auth/reset", {
        token: activeToken,
        password: password,
        confirm_password: confirmPassword,
      });
      if (!response.ok) {
        showAuthMessage(errorFromApi(data), "error");
        return;
      }
      showAuthMessage("Password updated successfully! Redirecting to login...", "ok");
      setTimeout(() => {
        window.location.href = data.redirect || "/login";
      }, 1500);
    } catch {
      showAuthMessage("Could not reach the server.", "error");
    } finally {
      delete form.dataset.busy;
      if (submit) { submit.textContent = original; submit.removeAttribute("aria-busy"); }
    }
  });
}

function bindLogout() {
  const button = document.getElementById("logout-btn");
  if (!button) return;
  button.addEventListener("click", async () => {
    await sendJson("/api/v1/auth/logout", {});
    window.location.href = "/";
  });
}

function providerRow(name) {
  return document.querySelector(`.connection-row[data-provider="${name}"]`);
}

function setProviderState(name, connected, extra) {
  const row = providerRow(name);
  if (!row) return;
  const status = row.querySelector("[data-status]");
  const toggle = row.querySelector(".connection-row__toggle");
  if (status) status.textContent = connected ? extra || "Connected" : "Not connected";
  if (!toggle) return;
  toggle.classList.toggle("connection-row__toggle--connected", connected);
  toggle.classList.toggle("connection-row__toggle--connect", !connected);
  if (toggle.tagName === "A") {
    toggle.textContent = connected ? "Connected" : "Connect";
    // v3.84: three "Connect" links read the same to a screen reader — carry the provider in the name
    const who = row.querySelector(".connection-row__info b");
    if (who) toggle.setAttribute("aria-label", (connected ? "Connected: " : "Connect ") + who.textContent.trim());
  } else {
    toggle.textContent = connected ? "Connected" : "Password";
  }
}

function renderDashboard(user) {
  const name = user.display_name || user.username || user.email || "misa user";
  const handle = user.username ? `misa.lol/${user.username}` : "username not set";
  const navName = document.getElementById("nav-name");
  const navHandle = document.getElementById("nav-handle");
  const navAvatar = document.getElementById("nav-avatar");
  if (navName) navName.textContent = name;
  if (navHandle) navHandle.textContent = handle;
  if (navAvatar && user.avatar_url) navAvatar.src = user.avatar_url;
  const email = document.getElementById("account-email");
  const accountName = document.getElementById("account-name");
  const accountId = document.getElementById("account-id");
  if (email) email.textContent = user.email || "No email on this account";
  if (accountName) accountName.textContent = name;
  if (accountId) accountId.textContent = user.account_id || "Generating...";
  const usernameInput = document.getElementById("username");
  if (usernameInput && user.username) usernameInput.value = user.username;
  setProviderState("email", Boolean(user.providers?.email), user.email || "Password login enabled");
  setProviderState("google", Boolean(user.providers?.google));
  setProviderState("discord", Boolean(user.providers?.discord));
  setProviderState("telegram", Boolean(user.providers?.telegram), user.telegram_username ? `@${user.telegram_username}` : "Connected");
  setProviderState("apple", Boolean(user.providers?.apple));
}

async function loadDashboard() {
  if (!document.querySelector(".dashboard")) return;
  let response;
  try {
    response = await fetch("/api/v1/me", { credentials: "include", headers: { Accept: "application/json" } });
  } catch {
    // v3.68: a dead network used to leave "loading…" in the nav and an unhandled rejection in the console; v2.js shows the message
    const name = document.getElementById("nav-name");
    if (name) name.textContent = "—";
    return;
  }
  if (response.status === 401) {
    window.location.href = "/login";
    return;
  }
  if (!response.ok) {
    showAuthMessage("Could not load your account.", "error");
    return;
  }
  renderDashboard(await response.json());
}

function bindAccountCopy() {
  const button = document.getElementById("account-copy");
  if (!button) return;
  button.addEventListener("click", async () => {
    const value = document.getElementById("account-id")?.textContent?.trim();
    if (!value || value === "—" || value === "Generating...") return;
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = "Copied";
      window.setTimeout(() => { button.textContent = "Copy"; }, 1400);
    } catch {
      button.textContent = "Copy unavailable";
    }
  });
}

function bindUsernameForm() {
  const form = document.getElementById("username-form");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.busy) return; // v3.96: a second Enter while it saves sends nothing
    const submit = form.querySelector('[type="submit"]');
    const original = submit ? submit.textContent : "";
    form.dataset.busy = "1";
    if (submit) { submit.textContent = "Saving…"; submit.setAttribute("aria-busy", "true"); }
    try {
      const response = await fetch("/api/v1/me/username", {
        method: "PATCH",
        credentials: "include",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.username.value }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        showAuthMessage(errorFromApi(data), "error");
        return;
      }
      showAuthMessage("Username saved.", "ok");
      renderDashboard(data);
    } catch {
      showAuthMessage("Could not save username.", "error");
    } finally {
      delete form.dataset.busy;
      if (submit) { submit.textContent = original; submit.removeAttribute("aria-busy"); }
    }
  });
}

async function markLoggedInNav() {
  if (document.querySelector(".auth-page") || document.querySelector(".dashboard")) return;
  try {
    const response = await fetch("/api/v1/me", { credentials: "include", headers: { Accept: "application/json" } });
    if (!response.ok) return;
    document.documentElement.classList.add("is-signed-in"); // v3.33: lets the phone nav drop "Claim" for members
    document.querySelectorAll('a[href="/login"]').forEach((link) => {
      link.href = "/dashboard";
      if (link.textContent.trim().toLowerCase() === "login") link.textContent = "Dashboard";
    });
    // v3.107: a member has an account — the nav's “Claim username” button becomes “Dashboard” (the text link hides on
    // wide screens, css); the phone menu's claim button hides (its Login entry already reads Dashboard)
    document.querySelectorAll(".nav__actions [data-claim]").forEach((btn) => {
      btn.href = "/dashboard";
      const label = btn.querySelector("span");
      if (label) label.textContent = "Dashboard";
    });
  } catch {
    /* public pages still work offline from the API */
  }
}

function completeTelegramAuthFromHash() {
  const prefix = "#tgAuthResult=";
  if (!location.hash.startsWith(prefix)) return false;
  let data;
  try {
    const raw = location.hash.slice(prefix.length);
    const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
    data = JSON.parse(atob(padded));
  } catch {
    return false;
  }
  const params = new URLSearchParams();
  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  });
  if (!params.get("id") || !params.get("hash")) return false;
  window.location.replace("/api/v1/auth/telegram/callback?" + params.toString());
  return true;
}

document.addEventListener("DOMContentLoaded", () => {
  if (completeTelegramAuthFromHash()) return;
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");
  if (error) showAuthMessage(AUTH_ERRORS[error] || "Sign-in failed. Try again.", "error");

  watchTurnstileGate();

  bindLoginForm();
  bindSignupForm();
  configureSocialAuth();
  bindSocialAuth();
  bindForgotPassword();
  bindForgotForm();
  bindResetForm();
  bindLogout();
  bindUsernameForm();
  bindAccountCopy();
  loadDashboard();
  markLoggedInNav();
});
