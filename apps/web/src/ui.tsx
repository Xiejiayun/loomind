import { ArrowUpRight, Languages, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "./i18n.js";
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
  const { t } = useI18n();
  return (
    <AppLink href={to} className={`lm-brand ${compact ? "lm-brand-compact" : ""}`} aria-label={t.common.brandHomeAria}>
      <LoomindMark size={compact ? 22 : 26} />
      <span className="lm-brand-wordmark">Loomind</span>
    </AppLink>
  );
}

export function ThemeToggle({ theme, toggle }: { theme: UiTheme; toggle: () => void }) {
  const { t } = useI18n();
  const dark = theme === "dark";
  const label = dark ? t.common.switchToLight : t.common.switchToDark;
  return (
    <button
      type="button"
      className="lm-icon-button"
      onClick={toggle}
      aria-label={label}
      title={label}
      aria-pressed={dark}
    >
      {dark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

export function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const { t, toggleLocale } = useI18n();
  return (
    <button
      type="button"
      className={compact ? "lm-icon-button-sm lm-lang-toggle" : "lm-icon-button lm-lang-toggle"}
      onClick={() => toggleLocale()}
      aria-label={t.common.switchLangAria}
      title={t.common.switchLangAria}
    >
      {compact ? (
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.02em" }}>{t.common.langToggleLabel}</span>
      ) : (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 500 }}>
          <Languages size={13} />
          <span>{t.common.langToggleLabel}</span>
        </span>
      )}
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
