"use client";

import { colorRgb } from "@/lib/effect-colors";
import { useEffect, useRef } from "react";

/*
 * Animation model adapted from Sakura.js by Jeroen Hammann.
 * Copyright (c) 2019 Jeroen Hammann. Released under the MIT License:
 * https://github.com/jhammann/sakura/blob/master/LICENSE
 */

const randomInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

export function SakuraEffectLayer({ className = "", color }: { className?: string; color?: string }) {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let stopped = false;
    let animation = 0;
    let timer = 0;
    const blowAnimations = ["soft-left", "medium-left", "soft-right", "medium-right"];
    const swayAnimations = Array.from({ length: 9 }, (_, index) => `sway-${index}`);

    const createPetal = () => {
      if (stopped || document.visibilityState === "hidden") return;
      timer = window.setTimeout(() => {
        animation = window.requestAnimationFrame(createPetal);
      }, 300);

      const fallTime = window.innerHeight * 0.007 + Math.round(Math.random() * 5);
      const blow = blowAnimations[randomInt(0, blowAnimations.length - 1)];
      const sway = swayAnimations[randomInt(0, swayAnimations.length - 1)];
      const height = randomInt(10, 14);
      const width = height - Math.floor(randomInt(0, 10) / 3);
      const petal = document.createElement("span");

      petal.className = "misa-sakura-petal";
      petal.style.animation = [
        `misa-sakura-fall ${fallTime}s linear 0s 1`,
        `misa-sakura-blow-${blow} ${Math.max(fallTime, 30) - 20 + randomInt(0, 20)}s linear 0s infinite`,
        `misa-sakura-${sway} ${randomInt(2, 4)}s linear 0s infinite`,
      ].join(", ");
      petal.style.background =
        color ? `linear-gradient(120deg, rgba(${colorRgb(color, "#ffb7c5")},.9), rgba(${colorRgb(color, "#ffb7c5")},.9))` : "linear-gradient(120deg, rgba(255, 183, 197, 0.9), rgba(255, 197, 208, 0.9))";
      petal.style.borderRadius =
        `${randomInt(14, 14 + Math.floor(Math.random() * 10))}px ${randomInt(1, Math.max(1, Math.floor(width / 4)))}px`;
      petal.style.height = `${height}px`;
      petal.style.left = `${Math.random() * layer.clientWidth - 100}px`;
      petal.style.marginTop = `${-(Math.floor(Math.random() * 20) + 15)}px`;
      petal.style.width = `${width}px`;
      petal.addEventListener("animationend", () => petal.remove(), { once: true });
      layer.appendChild(petal);
    };

    const onVisibility = () => {
      window.cancelAnimationFrame(animation);
      window.clearTimeout(timer);
      if (document.visibilityState === "hidden") layer.replaceChildren();
      else animation = window.requestAnimationFrame(createPetal);
    };
    document.addEventListener("visibilitychange", onVisibility);
    animation = window.requestAnimationFrame(createPetal);
    return () => {
      stopped = true;
      window.cancelAnimationFrame(animation);
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      layer.replaceChildren();
    };
  }, [color]);

  return (
    <div
      ref={layerRef}
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      data-background-effect="Sakura"
      aria-hidden="true"
    >
      <style jsx global>{`
        .misa-sakura-petal { pointer-events: none; position: absolute; top: 0; }
        @keyframes misa-sakura-fall { 0% { opacity: .9; top: 0; } 100% { opacity: .2; top: 100%; } }
        @keyframes misa-sakura-blow-soft-left { 0% { margin-left: 0; } 100% { margin-left: -50%; } }
        @keyframes misa-sakura-blow-medium-left { 0% { margin-left: 0; } 100% { margin-left: -100%; } }
        @keyframes misa-sakura-blow-soft-right { 0% { margin-left: 0; } 100% { margin-left: 50%; } }
        @keyframes misa-sakura-blow-medium-right { 0% { margin-left: 0; } 100% { margin-left: 100%; } }
        @keyframes misa-sakura-sway-0 { 0% { transform: rotate(-5deg); } 40% { transform: rotate(28deg); } 100% { transform: rotate(3deg); } }
        @keyframes misa-sakura-sway-1 { 0% { transform: rotate(10deg); } 40% { transform: rotate(43deg); } 100% { transform: rotate(15deg); } }
        @keyframes misa-sakura-sway-2 { 0% { transform: rotate(15deg); } 40% { transform: rotate(56deg); } 100% { transform: rotate(22deg); } }
        @keyframes misa-sakura-sway-3 { 0% { transform: rotate(25deg); } 40% { transform: rotate(74deg); } 100% { transform: rotate(37deg); } }
        @keyframes misa-sakura-sway-4 { 0% { transform: rotate(40deg); } 40% { transform: rotate(68deg); } 100% { transform: rotate(25deg); } }
        @keyframes misa-sakura-sway-5 { 0% { transform: rotate(50deg); } 40% { transform: rotate(78deg); } 100% { transform: rotate(40deg); } }
        @keyframes misa-sakura-sway-6 { 0% { transform: rotate(65deg); } 40% { transform: rotate(92deg); } 100% { transform: rotate(58deg); } }
        @keyframes misa-sakura-sway-7 { 0% { transform: rotate(72deg); } 40% { transform: rotate(118deg); } 100% { transform: rotate(68deg); } }
        @keyframes misa-sakura-sway-8 { 0% { transform: rotate(94deg); } 40% { transform: rotate(136deg); } 100% { transform: rotate(82deg); } }
      `}</style>
    </div>
  );
}