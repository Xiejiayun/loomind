import { ArrowUpRight, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { AppLink } from "./navigation.js";

export type UiTheme = "dark" | "light";

export function LoomindMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="lm-brand-svg"
    >
      <path
        d="M11 7C10.2 14.5 10.5 20.5 12.2 22.8C13.8 25 18.8 24.2 23.5 21.5"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <path
        d="M14.5 14C17.8 11.2 21.2 10.2 24 10.8"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeOpacity="0.52"
      />
      <circle cx="24" cy="10.8" r="1.5" fill="currentColor" fillOpacity="0.72" />
    </svg>
  );
}

export function Brand({ to = "/app", compact = false }: { to?: string; compact?: boolean }) {
  return (
    <AppLink href={to} className={`lm-brand ${compact ? "lm-brand-compact" : ""}`} aria-label="Loomind 首页">
      <LoomindMark size={compact ? 22 : 26} />
      <span className="lm-brand-wordmark">Loomind</span>
    </AppLink>
  );
}

export function ThemeToggle({ theme, toggle }: { theme: UiTheme; toggle: () => void }) {
  const dark = theme === "dark";
  return (
    <button
      type="button"
      className="lm-icon-button"
      onClick={toggle}
      aria-label={dark ? "切换到亮色模式" : "切换到深色模式"}
      title={dark ? "切换到亮色模式" : "切换到深色模式"}
      aria-pressed={dark}
    >
      {dark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

export function ArrowLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <AppLink href={to} className="lm-arrow-link">
      {children}
      <ArrowUpRight size={15} />
    </AppLink>
  );
}
