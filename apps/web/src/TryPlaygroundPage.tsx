import { useCallback, useRef, useState } from "react";
import { ArrowRight, RotateCcw, Sparkles } from "lucide-react";
import { getTemplate, MindmapDocumentSchema, type MindmapDocument } from "@mindmap/core";
import { MindmapEditor } from "@mindmap/editor";
import { useWebAiRuntime } from "./ai.js";
import type { Session } from "./auth/shared.js";
import { useI18n } from "./i18n.js";
import { AppLink, navigate } from "./navigation.js";
import { Brand, LanguageToggle, ThemeToggle, type UiTheme } from "./ui.js";

const TRY_STORAGE_KEY = "loomind:try-playground:v1";

function loadTryDocument(): MindmapDocument {
  try {
    const raw = localStorage.getItem(TRY_STORAGE_KEY);
    if (raw) {
      const parsed = MindmapDocumentSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch {
    // Ignore storage read failures in private mode
  }
  return getTemplate("blank-organic").create();
}

export function TryPlaygroundPage({
  session,
  theme,
  toggleTheme,
}: {
  session: Session;
  theme: UiTheme;
  toggleTheme: () => void;
}) {
  const { locale, t } = useI18n();
  const [docKey, setDocKey] = useState(0);
  const [initialDoc, setInitialDoc] = useState<MindmapDocument>(() => loadTryDocument());
  const saveTimer = useRef<number | undefined>(undefined);

  const handleUpgrade = useCallback(() => {
    navigate(session.user ? "/app" : "/login?next=%2Fapp");
  }, [session.user]);

  const freeAiRuntime = useWebAiRuntime("free", handleUpgrade);

  const handleDocChange = useCallback((doc: MindmapDocument) => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try {
        const raw = JSON.stringify(doc);
        if (raw.length < 512 * 1024) {
          localStorage.setItem(TRY_STORAGE_KEY, raw);
        }
      } catch {
        // Ignore quota errors on guest playground
      }
    }, 300);
  }, []);

  const handleReset = () => {
    try {
      localStorage.removeItem(TRY_STORAGE_KEY);
    } catch {
      // ignore
    }
    setInitialDoc(getTemplate("blank-organic").create());
    setDocKey((k) => k + 1);
  };

  return (
    <div className="lm-try-shell">
      <header className="lm-try-bar">
        <div className="lm-try-bar-left">
          <Brand to="/" compact />
          <span className="lm-try-badge">
            <Sparkles size={12} />
            {t.tryPage.badge}
          </span>
          {freeAiRuntime.config && (
            <span className="lm-try-quota">
              {t.tryPage.quota(freeAiRuntime.config.remainingToday, freeAiRuntime.config.dailyLimit)}
            </span>
          )}
          {freeAiRuntime.config?.isMock && <span className="lm-try-mock-pill">{t.tryPage.mockBadge}</span>}
          <span className="lm-try-hint">{t.tryPage.bannerHint}</span>
        </div>
        <div className="lm-try-bar-right">
          <button type="button" className="lm-secondary-button lm-try-btn-sm" onClick={handleReset}>
            <RotateCcw size={13} /> {t.tryPage.resetCanvas}
          </button>
          <LanguageToggle compact />
          <ThemeToggle theme={theme} toggle={toggleTheme} compact />
          <AppLink href={session.user ? "/app" : "/login?next=%2Fapp"} className="lm-primary-button lm-try-btn-sm">
            {session.user ? t.tryPage.openProWorkspace : t.tryPage.unlockProCta} <ArrowRight size={13} />
          </AppLink>
        </div>
      </header>
      <div className="lm-try-editor-wrap">
        <MindmapEditor
          key={docKey}
          initialDoc={initialDoc}
          onDocumentChange={handleDocChange}
          chromeTheme={theme}
          initialRightPanel="ai"
          initialFormatPanelOpen={false}
          locale={locale}
          aiRuntime={freeAiRuntime}
        />
      </div>
    </div>
  );
}
