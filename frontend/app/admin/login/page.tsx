"use client";

import Link from "next/link";
import { ArrowRight, KeyRound, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, TextInput } from "@/components/ui";

function formatAdminError(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value)) {
    const messages = value.map((item) => formatAdminError(item, "")).filter(Boolean);
    if (messages.length) return messages.join(" ");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    if (typeof record.msg === "string" && record.msg.trim()) return record.msg;
  }
  return fallback;
}
declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback"?: () => void; "error-callback"?: () => void }) => string;
      remove?: (widgetId: string) => void;
    };
  }
}

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [turnstileSiteKey, setTurnstileSiteKey] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileNonce, setTurnstileNonce] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/v1/auth/providers", { cache: "no-store" })
      .then((response) => response.json())
      .then((value: { turnstile_site_key?: string }) => setTurnstileSiteKey(value.turnstile_site_key || ""))
      .catch(() => setTurnstileSiteKey(""));
  }, []);

  const resetTurnstile = () => {
    setTurnstileToken("");
    setTurnstileNonce((value) => value + 1);
  };

  const requestCode = async () => {
    if (!turnstileToken) { setError("Complete the human verification before continuing."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/admin-auth/request-otp", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ email, turnstile_token: turnstileToken }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { resetTurnstile(); throw new Error(formatAdminError(result.detail || result.error, "Could not send the verification code.")); }
      resetTurnstile();
      setStep("otp");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not send the verification code."); }
    finally { setBusy(false); }
  };

  const verifyCode = async () => {
    if (!turnstileToken) { setError("Complete the human verification before continuing."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/admin-auth/verify-otp", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ email, code, turnstile_token: turnstileToken }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { resetTurnstile(); throw new Error(formatAdminError(result.detail || result.error, "Invalid or expired verification code.")); }
      const session = await fetch("/api/v1/admin-auth/session", { credentials: "include", cache: "no-store", headers: { "Cache-Control": "no-store" } });
      if (!session.ok) throw new Error(`The admin session was not persisted (server returned ${session.status}). Please try again.`);
      window.location.replace("/m");
    } catch (e) { setError(e instanceof Error ? e.message : "Invalid or expired verification code."); }
    finally { setBusy(false); }
  };

  return <main className="grid min-h-[100svh] place-items-center bg-[#07070a] px-5 text-white"><section className="surface w-full max-w-[430px] rounded-2xl p-6 sm:p-8"><div className="mb-8 flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#c5b8ff] via-[#8c75eb] to-[#5946b8]"><ShieldCheck size={19} /></span><div><p className="font-semibold">Misa<span className="text-[#a899ff]">.lol</span></p><p className="text-xs text-zinc-600">Administrator access</p></div></div><p className="mb-2 text-xs font-semibold uppercase tracking-[.18em] text-[#a899ff]">Secure sign in</p><h1 className="text-2xl font-semibold tracking-[-.04em]">{step === "email" ? "Verify your admin email" : "Enter your code"}</h1><p className="mt-2 text-sm leading-6 text-zinc-500">{step === "email" ? "Every administrator login requires a fresh one-time code." : `A six-digit code was sent to ${email}. It expires in 5 minutes.`}</p><div className="mt-7 space-y-4">{step === "email" ? <TextInput value={email} onChange={setEmail} type="email" placeholder="Administrator email" autoComplete="email" /> : <><div className="relative"><KeyRound size={15} className="absolute left-3 top-3.5 text-zinc-600" /><TextInput value={code} onChange={(value) => setCode(value.replace(/[^0-9]/g, "").slice(0, 6))} placeholder="000000" className="pl-9 text-center font-mono tracking-[.35em]" /></div><button type="button" onClick={() => { resetTurnstile(); setStep("email"); setCode(""); setError(""); }} className="text-xs text-[#b1a5ff] hover:text-white">Use a different email</button></>}{turnstileSiteKey && <div className="flex justify-center"><TurnstileWidget key={`${step}-${turnstileNonce}`} siteKey={turnstileSiteKey} onToken={setTurnstileToken} /></div>}{error && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/[.06] px-3 py-2.5 text-xs leading-5 text-red-200">{error}</p>}<Button variant="accent" className="h-12 w-full" disabled={busy || !turnstileSiteKey || !turnstileToken || (step === "email" ? !email.trim() : code.length !== 6)} onClick={() => void (step === "email" ? requestCode() : verifyCode())}>{busy ? "Please wait…" : step === "email" ? "Send verification code" : "Verify and continue"}<ArrowRight size={16} /></Button></div><a href="https://misa.lol" className="mt-7 block text-center text-xs text-zinc-600 hover:text-zinc-300">Back to misa.lol</a></section></main>;
}

function TurnstileWidget({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;

  useEffect(() => {
    let disposed = false;
    let widgetId = "";
    const render = () => {
      if (disposed || !ref.current || !window.turnstile) return;
      widgetId = window.turnstile.render(ref.current, { sitekey: siteKey, callback: (token) => callback.current(token), "expired-callback": () => callback.current(""), "error-callback": () => callback.current("") });
    };
    if (window.turnstile) render();
    else {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true; script.defer = true; script.addEventListener("load", render); document.head.appendChild(script);
      return () => { disposed = true; script.removeEventListener("load", render); if (widgetId && window.turnstile?.remove) window.turnstile.remove(widgetId); ref.current?.replaceChildren(); };
    }
    return () => { disposed = true; if (widgetId && window.turnstile?.remove) window.turnstile.remove(widgetId); ref.current?.replaceChildren(); };
  }, [siteKey]);

  return <div ref={ref} className="min-h-[65px]" aria-label="Human verification" />;
}
