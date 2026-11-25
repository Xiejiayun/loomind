import { ArrowUpRight, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { AppLink } from "./navigation.js";

export type UiTheme = "dark" | "light";

export function Brand({ to = "/app", compact = false }: { to?: string; compact?: boolean }) {
  return <AppLink href={to} className={`lm-brand ${compact ? "lm-brand-compact" : ""}`} aria-label="Loomind 首页">
    <span className="lm-brand-symbol" aria-hidden="true">&gt;_</span><span>loomind</span>
  </AppLink>;
}

export function ThemeToggle({ theme, toggle }: { theme: UiTheme; toggle: () => void }) {
  const dark = theme === "dark";
  return <button type="button" className="lm-icon-button" onClick={toggle}
    aria-label={dark ? "切换到亮色模式" : "切换到深色模式"} title={dark ? "切换到亮色模式" : "切换到深色模式"}
    aria-pressed={dark}>{dark ? <Sun size={16}/> : <Moon size={16}/>}</button>;
}

export function ArrowLink({ to, children }: { to: string; children: ReactNode }) {
  return <AppLink href={to} className="lm-arrow-link">{children}<ArrowUpRight size={15}/></AppLink>;
}
