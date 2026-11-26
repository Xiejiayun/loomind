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
      <rect
        x="2.5"
        y="2.5"
        width="27"
        height="27"
        rx="6.5"
        fill="currentColor"
        fillOpacity="0.04"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeOpacity="0.42"
      />
      <text
        x="16"
        y="21.4"
        textAnchor="middle"
        fill="currentColor"
        fontFamily='"Instrument Serif", Georgia, "Times New Roman", serif'
        fontSize="16"
        fontStyle="italic"
        letterSpacing="-0.5"
      >
        Lm
      </text>
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
