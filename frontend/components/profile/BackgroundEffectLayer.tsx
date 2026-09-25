"use client";

import { useEffect, useRef } from "react";
import { colorRgb } from "@/lib/effect-colors";
import type { BackgroundEffect } from "@/lib/types";
import { SakuraEffectLayer } from "./SakuraEffectLayer";
import { CodropsRainEffectLayer } from "./CodropsRainEffectLayer";

type Particle = { x: number; y: number; size: number; speed: number; drift: number; phase: number; alpha: number };

export function BackgroundEffectLayer({ effect, color, className = "" }: { effect: BackgroundEffect; color?: string; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || effect === "None") return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const rgb = colorRgb(color, effect === "Fireflies" ? "#fcd271" : "#ffffff");
    let width = 1, height = 1, frame = 0, animation = 0, wind = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const countFor = () => effect === "Fireflies" ? Math.max(60, Math.min(200, Math.round(width * height / 6000))) : effect === "Sakura" ? Math.max(10, Math.min(28, Math.round(width / 80))) : effect === "Snow" ? Math.max(24, Math.min(64, Math.round(width * height / 14500))) : Math.max(12, Math.min(effect === "Rain" ? 140 : 48, Math.round(effect === "Rain" ? width * height / 5200 : width / 28)));
    let particles: Particle[] = [];
    const create = (randomY = true): Particle => ({
      x: Math.random() * width, y: randomY ? Math.random() * height : -30,
      size: effect === "Rain" ? 2.5 + Math.pow(Math.random(), 3.1) * 18 : effect === "Fireflies" ? .45 + Math.pow(Math.random(), 2.2) * 1.35 : effect === "Sakura" ? 10 + Math.random() * 4 : effect === "Snow" ? .8 + Math.random() * 2.4 : 1.4 + Math.random() * 4,
      speed: effect === "Rain" ? .025 + Math.random() * .22 : effect === "Snow" ? .2 + Math.random() * 1.8 : .25 + Math.random() * 1.1,
      drift: (Math.random() - .5) * (effect === "Fireflies" ? .7 : effect === "Sakura" ? .9 : effect === "Snow" ? 2.2 : .35),
      phase: Math.random() * Math.PI * 2, alpha: .35 + Math.random() * .55,
    });
    const resize = () => {
      const rect = canvas.getBoundingClientRect(); width = Math.max(1, rect.width); height = Math.max(1, rect.height);
      const ratio = Math.min(window.devicePixelRatio || 1, effect === "Rain" ? 1.5 : 1.75);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      particles = Array.from({ length: reduced ? Math.min(22, countFor()) : countFor() }, () => create());
    };
    const drawFlake = (p: Particle) => {
      context.save(); context.translate(p.x, p.y); context.strokeStyle = "rgba(" + rgb + "," + p.alpha + ")"; context.lineWidth = Math.max(.7, p.size / 5);
      for (let arm = 0; arm < 3; arm += 1) { context.rotate(Math.PI / 3); context.beginPath(); context.moveTo(-p.size, 0); context.lineTo(p.size, 0); context.stroke(); }
      context.restore();
    };
    const drawRainDrop = (p: Particle) => {
      const radius = p.size;
      const stretch = 1 + Math.max(0, radius - 7) * .035;
      if (radius > 8) {
        const trail = context.createLinearGradient(p.x, p.y - radius * 3.2, p.x, p.y);
        trail.addColorStop(0, "rgba(210,235,246,0)");
        trail.addColorStop(1, "rgba(210,235,246," + p.alpha * .16 + ")");
        context.strokeStyle = trail; context.lineWidth = Math.max(1, radius * .18);
        context.beginPath(); context.moveTo(p.x, p.y - radius * 3.2); context.lineTo(p.x, p.y - radius * .7); context.stroke();
      }
      const glass = context.createRadialGradient(p.x - radius * .32, p.y - radius * .4, radius * .08, p.x, p.y, radius * 1.15);
      glass.addColorStop(0, "rgba(255,255,255,.68)");
      glass.addColorStop(.2, "rgba(210,235,246,.13)");
      glass.addColorStop(.68, "rgba(120,155,176,.08)");
      glass.addColorStop(1, "rgba(5,18,28,.48)");
      context.shadowColor = "rgba(0,10,20,.62)"; context.shadowBlur = Math.max(2, radius * .45); context.shadowOffsetY = Math.max(1, radius * .12);
      context.fillStyle = glass; context.beginPath(); context.ellipse(p.x, p.y, radius * .72, radius * stretch, 0, 0, Math.PI * 2); context.fill();
      context.shadowColor = "transparent"; context.strokeStyle = "rgba(235,249,255," + Math.min(.7, p.alpha * .75) + ")";
      context.lineWidth = Math.max(.45, radius * .055); context.stroke();
      context.strokeStyle = "rgba(255,255,255," + p.alpha * .5 + ")"; context.lineWidth = Math.max(.5, radius * .08);
      context.beginPath(); context.arc(p.x - radius * .08, p.y - radius * .13, radius * .48, Math.PI * 1.05, Math.PI * 1.68); context.stroke();
    };
    const draw = (move = true) => {
      context.clearRect(0, 0, width, height); frame += move ? 1 : 0;
      for (const p of particles) {
        if (move) {
          if (effect === "Fireflies") { p.x += (p.phase > Math.PI ? -1 : 1) * (.12 + p.speed * .12); p.y += Math.sin(frame / 95 + p.phase) * .06; }
          else if (effect === "Rain") { p.y += p.speed * Math.max(1, p.size / 5); p.x += Math.sin(frame / 130 + p.phase) * .018; }
          else if (effect === "Snow") { p.y += p.speed; p.x += p.drift + wind; }
          else { p.y += p.speed; p.x += p.drift + Math.sin(frame / 70 + p.phase) * .16; }
          if (effect === "Fireflies") { if (p.x > width + 30) { p.x = -30; p.y = Math.random() * height; } else if (p.x < -30) { p.x = width + 30; p.y = Math.random() * height; } }
          else if (p.y > height + 30 || p.x < -30 || p.x > width + 30) Object.assign(p, create(false));
        }
        context.save(); context.globalAlpha = effect === "Fireflies" ? p.alpha * Math.pow(Math.max(0, Math.sin(frame / (72 + p.phase * 8) + p.phase)), 5) : p.alpha;
        if (effect === "Rain") drawRainDrop(p);
        else if (effect === "Sakura") { const petalWidth = p.size * .78; const petalHeight = p.size; context.globalAlpha *= .9 - Math.min(.7, p.y / Math.max(1, height) * .7); context.translate(p.x, p.y); context.rotate(Math.sin(frame / 34 + p.phase) * .48 + p.phase); if (Math.sin(frame / 42 + p.phase) < 0) context.scale(-1, 1); const petal = context.createLinearGradient(-petalWidth / 2, -petalHeight / 2, petalWidth / 2, petalHeight / 2); petal.addColorStop(0, "rgba(255,183,197,.92)"); petal.addColorStop(1, "rgba(255,197,208,.9)"); context.fillStyle = petal; context.beginPath(); context.moveTo(-petalWidth * .52, 0); context.bezierCurveTo(-petalWidth * .35, -petalHeight * .48, petalWidth * .32, -petalHeight * .55, petalWidth * .52, 0); context.bezierCurveTo(petalWidth * .3, petalHeight * .42, -petalWidth * .25, petalHeight * .55, -petalWidth * .52, 0); context.closePath(); context.fill(); }
        else if (effect === "Snowflakes") drawFlake(p);
        else if (effect === "Fireflies") { const glow = context.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3.2); glow.addColorStop(0, "rgba(" + rgb + ",1)"); glow.addColorStop(.24, "rgba(" + rgb + ",.7)"); glow.addColorStop(1, "rgba(" + rgb + ",0)"); context.fillStyle = glow; context.beginPath(); context.arc(p.x, p.y, p.size * 3.2, 0, Math.PI * 2); context.fill(); }
        else { context.fillStyle = "rgba(" + rgb + ",.82)"; context.beginPath(); context.arc(p.x, p.y, p.size, 0, Math.PI * 2); context.fill(); }
        context.restore();
      }
    };
    const tick = () => { draw(true); animation = requestAnimationFrame(tick); };
    const observer = new ResizeObserver(() => { resize(); if (reduced) draw(false); }); observer.observe(canvas); resize();
    if (reduced) draw(false); else tick();
    const visibility = () => { cancelAnimationFrame(animation); if (!reduced && !document.hidden) tick(); };
    const pointerWind = (event: PointerEvent) => { wind = ((event.clientX / Math.max(1, window.innerWidth)) - .5) * 1.4; };
    if (effect === "Snow") document.addEventListener("pointermove", pointerWind, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    return () => { cancelAnimationFrame(animation); observer.disconnect(); document.removeEventListener("visibilitychange", visibility); document.removeEventListener("pointermove", pointerWind); };
  }, [effect, color]);
  if (effect === "None") return null;
  if (effect === "Sakura") return <SakuraEffectLayer className={className} color={color} />;
  if (effect === "Rain") return <CodropsRainEffectLayer className={className} />;
  return <canvas ref={canvasRef} className={"pointer-events-none absolute inset-0 h-full w-full " + className} data-background-effect={effect} aria-hidden="true" />;

}