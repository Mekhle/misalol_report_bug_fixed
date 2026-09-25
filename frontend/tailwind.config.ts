import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#f7f7f8",
        muted: "#8e8e98",
        panel: "#111116",
        line: "rgba(255,255,255,0.08)",
        accent: "#9b87f5",
      },
      boxShadow: {
        glow: "0 0 60px rgba(143, 103, 255, .16)",
      },
      fontFamily: {
        sans: ["var(--font-geist)", "ui-sans-serif", "system-ui"],
      },
    },
  },
  plugins: [],
};

export default config;
