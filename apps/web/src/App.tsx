import React, { useCallback, useEffect, useRef, useState } from "react";
import { getTemplate, MindmapDocumentSchema, type MindmapDocument } from "@mindmap/core";
import { MindmapEditor } from "@mindmap/editor";
import { loadSavedDocument, saveDocument } from "./persistence.js";

export const App: React.FC = () => {
  const [initialDoc, setInitialDoc] = useState<MindmapDocument | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    loadSavedDocument().then((saved) => {
      if (!active) return;
      if (saved && MindmapDocumentSchema.safeParse(saved).success) {
        setInitialDoc(saved);
      } else {
        setInitialDoc(getTemplate("blank-organic").create());
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const handleDocumentChange = useCallback((doc: MindmapDocument) => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void saveDocument(doc);
    }, 400);
  }, []);

  if (!initialDoc) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50 text-sm text-slate-400">
        正在加载 Mindmap Studio...
      </div>
    );
  }

  return <MindmapEditor initialDoc={initialDoc} onDocumentChange={handleDocumentChange} />;
};
