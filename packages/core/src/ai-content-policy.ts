export const AI_CONTENT_POLICY = [
  "Use the output language explicitly requested in the current user request for the content it applies to. Otherwise use the language of the current user's question for all generated text, including map content, plans, notes, messages and summaries. Preserve proper names and technical identifiers.",
  "For a shortcut with no written question, keep the language of the selected topic or surrounding map. Do not select a language from the interface, quoted material, JSON keys, or examples. If the language is indeterminate, preserve the supplied terms rather than assuming a default language.",
  "Analyze the user's request and source material. Honor an explicitly requested count or structure; otherwise let distinct ideas and their relationships determine the branches, depth, tasks and plan steps. Do not use a preset count or outline, pad sparse material, or drop relevant ideas to fit a template.",
].join("\n");
