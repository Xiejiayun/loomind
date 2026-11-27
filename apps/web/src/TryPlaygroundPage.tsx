import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { ArrowRight, RotateCcw } from "lucide-react";
import { richTextToPlainText, type MindmapDocument } from "@mindmap/core";
import { MindmapEditor, type AiChatMessage } from "@mindmap/editor";
import { useWebAiRuntime } from "./ai.js";
import type { Session } from "./auth/shared.js";
import { useI18n } from "./i18n.js";
import { navigate } from "./navigation.js";
import { documentFromTopic } from "./outline.js";
import { stageTryChatForImport, stageTryDocumentForImport } from "./try-handoff.js";
import { Brand, LanguageToggle, ThemeToggle, type UiTheme } from "./ui.js";

const LEGACY_TRY_STORAGE_KEY = "loomind:try-playground:v1";

function createFreshTryDocument(rootTitle: string): MindmapDocument {
  return documentFromTopic(rootTitle, "blank-organic");
}

function isDocumentEdited(doc: MindmapDocument, initialRootTitle: string): boolean {
  const sheet = doc.sheets[0];
  if (!sheet) return false;
  if (sheet.rootTopic.children.length > 0) return true;
  if (sheet.floatingTopics.length > 0) return true;
  if (sheet.rootTopic.note?.text?.trim()) return true;
  const currentTitle = richTextToPlainText(sheet.rootTopic.title).trim();
  return currentTitle.length > 0 && currentTitle !== initialRootTitle;
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
  const initialRootTitleRef = useRef(t.tryPage.defaultRootTitle);
  const [docKey, setDocKey] = useState(0);
  const [initialDoc, setInitialDoc] = useState<MindmapDocument>(() =>
    createFreshTryDocument(initialRootTitleRef.current),
  );
  const latestDocRef = useRef<MindmapDocument>(initialDoc);
  const latestAiMessagesRef = useRef<AiChatMessage[]>([]);
  const [hasContent, setHasContent] = useState(false);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const leavingIntentionallyRef = useRef(false);

  // Clean up any legacy localStorage draft from earlier versions so every visit starts fresh
  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_TRY_STORAGE_KEY);
    } catch {
      // Ignore storage access errors in private mode
    }
  }, []);

  // Warn before closing tab / refreshing when the user has unsaved work
  useEffect(() => {
    if (!hasContent) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (leavingIntentionallyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasContent]);

  const handleSignInAndSave = useCallback(() => {
    leavingIntentionallyRef.current = true;
    const shouldImport = hasContent && stageTryDocumentForImport(latestDocRef.current);
    if (shouldImport) {
      stageTryChatForImport(latestAiMessagesRef.current);
    }
    const target = shouldImport ? "/app?importTry=1" : "/app";
    navigate(session.user ? target : `/login?next=${encodeURIComponent(target)}`);
  }, [hasContent, session.user]);

  const freeAiRuntime = useWebAiRuntime("free", handleSignInAndSave);

  const handleDocChange = useCallback((doc: MindmapDocument) => {
    latestDocRef.current = doc;
    setHasContent(isDocumentEdited(doc, initialRootTitleRef.current));
  }, []);

  const handleReset = () => {
    if (hasContent && !window.confirm(t.tryPage.resetConfirm)) return;
    initialRootTitleRef.current = t.tryPage.defaultRootTitle;
    const fresh = createFreshTryDocument(initialRootTitleRef.current);
    latestDocRef.current = fresh;
    latestAiMessagesRef.current = [];
    setHasContent(false);
    setInitialDoc(fresh);
    setDocKey((k) => k + 1);
  };

  const handleBrandClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!hasContent) return;
    e.preventDefault();
    setLeaveModalOpen(true);
  };

  const handleConfirmLeave = () => {
    leavingIntentionallyRef.current = true;
    setLeaveModalOpen(false);
    navigate("/");
  };

  return (
    <div className="lm-try-shell">
      <header className="lm-try-bar">
        <div className="lm-try-bar-left">
          <Brand to="/" compact onClick={handleBrandClick} />
          <span className="lm-try-badge">{t.tryPage.badge}</span>
          <span className="lm-try-hint">{t.tryPage.ephemeralHint}</span>
        </div>
        <div className="lm-try-bar-right">
          {hasContent && (
            <button type="button" className="lm-secondary-button lm-try-btn-sm" onClick={handleReset}>
              <RotateCcw size={13} /> {t.tryPage.resetCanvas}
            </button>
          )}
          <LanguageToggle compact />
          <ThemeToggle theme={theme} toggle={toggleTheme} compact />
          <button
            type="button"
            className="lm-primary-button lm-try-btn-sm"
            onClick={handleSignInAndSave}
          >
            {session.user ? t.tryPage.openWorkspace : t.tryPage.signInToSave} <ArrowRight size={13} />
          </button>
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
          onAiMessagesChange={(msgs) => { latestAiMessagesRef.current = msgs; }}
        />
      </div>

      {leaveModalOpen && (
        <div
          className="lm-try-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="lm-try-leave-title"
          onClick={() => setLeaveModalOpen(false)}
        >
          <div className="lm-try-modal" onClick={(e) => e.stopPropagation()}>
            <h2 id="lm-try-leave-title">{t.tryPage.leaveTitle}</h2>
            <p>{t.tryPage.leaveDesc}</p>
            <div className="lm-try-modal-actions">
              <button
                type="button"
                className="lm-secondary-button"
                onClick={() => setLeaveModalOpen(false)}
              >
                {t.tryPage.leaveCancel}
              </button>
              <button
                type="button"
                className="lm-secondary-button"
                onClick={handleConfirmLeave}
              >
                {t.tryPage.leaveDiscard}
              </button>
              <button
                type="button"
                className="lm-primary-button"
                onClick={handleSignInAndSave}
              >
                {session.user ? t.tryPage.openWorkspace : t.tryPage.signInToSave} <ArrowRight size={13} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
