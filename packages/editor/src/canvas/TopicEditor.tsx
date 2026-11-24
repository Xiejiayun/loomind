import React, { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import { Bold, Highlighter, Italic, Strikethrough } from "lucide-react";
import type { RichTextDoc } from "@mindmap/core";

interface TopicEditorProps {
  initialDoc: RichTextDoc;
  initialChar?: string;
  fontSize: number;
  fontWeight: number;
  textColor: string;
  onCommit: (doc: RichTextDoc) => void;
  onCancel: () => void;
}

function normalizeTipTapJson(json: Record<string, unknown>): RichTextDoc {
  const rawContent = Array.isArray(json.content) ? json.content : [];
  const paragraphs = rawContent
    .filter((n: Record<string, unknown>) => n.type === "paragraph")
    .map((p: Record<string, unknown>) => {
      const nodes = Array.isArray(p.content)
        ? p.content
            .filter((t: Record<string, unknown>) => t.type === "text" && typeof t.text === "string")
            .map((t: Record<string, unknown>) => ({
              type: "text" as const,
              text: t.text as string,
              ...(Array.isArray(t.marks) && t.marks.length > 0 ? { marks: t.marks } : {}),
            }))
        : undefined;
      return {
        type: "paragraph" as const,
        ...(nodes && nodes.length > 0 ? { content: nodes } : {}),
      };
    });

  return {
    type: "doc",
    content: paragraphs.length > 0 ? paragraphs : [{ type: "paragraph" }],
  };
}

export const TopicEditor: React.FC<TopicEditorProps> = ({
  initialDoc,
  initialChar,
  fontSize,
  fontWeight,
  textColor,
  onCommit,
  onCancel,
}) => {
  const committedRef = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Link.configure({ openOnClick: false }),
    ],
    content: initialChar
      ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: initialChar }] }] }
      : initialDoc,
    autofocus: "end",
  });

  useEffect(() => {
    if (editor) {
      editor.commands.focus("end");
    }
  }, [editor]);

  const finishCommit = () => {
    if (committedRef.current || !editor) return;
    committedRef.current = true;
    onCommit(normalizeTipTapJson(editor.getJSON()));
  };

  const finishCancel = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCancel();
  };

  return (
    <div
      className="relative min-w-[48px]"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Strict Chinese IME guard
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          finishCommit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finishCancel();
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          finishCommit();
        }
      }}
    >
      {/* Floating Rich Text Format Bubble */}
      {editor && (
        <div
          className="absolute -top-9 left-1/2 z-50 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-slate-200 bg-white px-1.5 py-1 shadow-lg"
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className={`rounded p-1 text-slate-700 hover:bg-slate-100 ${editor.isActive("bold") ? "bg-blue-50 text-blue-600" : ""}`}
            onClick={() => editor.chain().focus().toggleBold().run()}
            title="加粗"
          >
            <Bold className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={`rounded p-1 text-slate-700 hover:bg-slate-100 ${editor.isActive("italic") ? "bg-blue-50 text-blue-600" : ""}`}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title="斜体"
          >
            <Italic className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={`rounded p-1 text-slate-700 hover:bg-slate-100 ${editor.isActive("strike") ? "bg-blue-50 text-blue-600" : ""}`}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            title="删除线"
          >
            <Strikethrough className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={`rounded p-1 text-slate-700 hover:bg-slate-100 ${editor.isActive("highlight") ? "bg-amber-100 text-amber-700" : ""}`}
            onClick={() => editor.chain().focus().toggleHighlight({ color: "#FEF08A" }).run()}
            title="高亮"
          >
            <Highlighter className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <EditorContent
        editor={editor}
        className="mindmap-tiptap outline-none"
        style={{
          fontSize,
          fontWeight,
          color: textColor,
          lineHeight: 1.42,
        }}
      />
    </div>
  );
};
