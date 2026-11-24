import React, { useEffect, useState } from "react";

interface EquationViewProps {
  latex: string;
}

export const EquationView: React.FC<EquationViewProps> = React.memo(({ latex }) => {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("katex")
      .then((katexMod) => {
        if (cancelled) return;
        const katex = katexMod.default ?? katexMod;
        const rendered = katex.renderToString(latex, {
          throwOnError: false,
          displayMode: false,
        });
        setHtml(rendered);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [latex]);

  if (!html) {
    return (
      <div className="mt-1 rounded bg-black/5 px-1.5 py-0.5 font-mono text-[11px]">
        {latex}
      </div>
    );
  }

  return (
    <div
      className="mt-1 overflow-x-auto text-xs"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
EquationView.displayName = "EquationView";
