import "server-only";

import React from "react";
import { ImageResponse } from "next/og";
import crypto from "node:crypto";
import { redis } from "./redis";

export function publicHost(): string {
  const host = (process.env.APP_DOMAIN || "misa.lol").trim().toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
    return "misa.lol";
  }
  return host || "misa.lol";
}

function shareFlag(settings: Record<string, unknown>, key: string, defaultValue = true): boolean {
  if (!(key in settings)) return defaultValue;
  return Boolean(settings[key]);
}

export async function renderOgCard(bits: Record<string, unknown>): Promise<Response> {
  const canonical = JSON.stringify(bits, Object.keys(bits).sort());
  const hash = crypto.createHash("sha256").update(canonical).digest("hex");
  const cacheKey = `profile-og:v2:${hash}`;

  try {
    const client = redis();
    if (client.status === "wait") await client.connect();
    const cached = await client.get(cacheKey);
    if (cached) {
      const buffer = Buffer.from(cached, "base64");
      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
          ETag: `W/"${String(bits.username || "user")}-${String(bits.version || "0")}"`,
        },
      });
    }
  } catch {
    // Ignore cache failure
  }


  const settings = (bits.settings && typeof bits.settings === "object" ? bits.settings : {}) as Record<string, unknown>;
  const identity = (bits.identity && typeof bits.identity === "object" ? bits.identity : {}) as Record<string, unknown>;
  const username = String(bits.username || "user");
  const displayName = String(identity.displayName || username).trim() || username;
  const address = `${publicHost()}/${username}`;

  const overlayAvatar = shareFlag(settings, "ogOverlayAvatar", true);
  const overlayName = shareFlag(settings, "ogOverlayName", true);
  const overlayAddress = shareFlag(settings, "ogOverlayAddress", true);

  const bg = String(settings.backgroundColor || "#08080d");
  const accent = String(settings.accentColor || "#9b87f5");
  const avatarUrl = overlayAvatar && typeof bits.avatar === "string" ? bits.avatar : null;
  const coverUrl =
    typeof bits.og_image === "string" && bits.og_image
      ? bits.og_image
      : typeof bits.background === "string" && bits.background
        ? bits.background
        : null;

  const cardElement = React.createElement(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        backgroundColor: bg,
        position: "relative",
        overflow: "hidden",
      },
    },
    // Cover background
    coverUrl
      ? React.createElement("img", {
          src: coverUrl,
          style: {
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          },
        })
      : React.createElement("div", {
          style: {
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: `radial-gradient(circle at 20% 20%, ${accent} 0%, transparent 60%), radial-gradient(circle at 80% 80%, ${accent} 0%, transparent 60%)`,
            opacity: 0.5,
          },
        }),
    // Gradient overlay fade
    React.createElement("div", {
      style: {
        position: "absolute",
        bottom: 0,
        left: 0,
        width: "100%",
        height: "260px",
        background: "linear-gradient(to top, rgba(8, 8, 13, 0.95) 0%, rgba(8, 8, 13, 0.7) 60%, transparent 100%)",
      },
    }),
    // Bottom content container
    React.createElement(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          padding: "48px 56px",
          gap: "28px",
          zIndex: 10,
        },
      },
      avatarUrl
        ? React.createElement("img", {
            src: avatarUrl,
            style: {
              width: "128px",
              height: "128px",
              borderRadius: "64px",
              border: `3px solid ${accent}`,
              objectFit: "cover",
            },
          })
        : null,
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          },
        },
        overlayName
          ? React.createElement(
              "div",
              {
                style: {
                  fontSize: "50px",
                  fontWeight: 800,
                  color: "#ffffff",
                  lineHeight: 1.1,
                  maxWidth: "900px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                },
              },
              displayName
            )
          : null,
        overlayAddress
          ? React.createElement(
              "div",
              {
                style: {
                  fontSize: "26px",
                  fontWeight: 500,
                  color: "#d2d2dc",
                  letterSpacing: "0.02em",
                },
              },
              address
            )
          : null
      )
    )
  );

  const response = new ImageResponse(cardElement, {
    width: 1200,
    height: 630,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
      ETag: `W/"${username}-${String(bits.version || "0")}"`,
    },
  });

  try {
    const client = redis();
    if (client.status === "wait") await client.connect();
    const cloned = response.clone();
    const arrayBuffer = await cloned.arrayBuffer();
    const b64 = Buffer.from(arrayBuffer).toString("base64");
    await client.set(cacheKey, b64, "EX", 3600);
  } catch {
    // Ignore cache write error
  }


  return response;
}
