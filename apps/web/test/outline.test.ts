import { describe, expect, it } from "vitest";
import { parseOutline } from "../src/outline.js";

describe("outline hierarchy", () => {
  it("keeps equally indented bullets together at any starting column", () => {
    for (const margin of ["", "  ", "    ", "\t"]) {
      const source = `Launch\n${margin}- Pricing\n${margin}  - Costs\n${margin}  - Margin\n${margin}- Timeline`;
      expect(parseOutline(source).children).toEqual([
        { title: "Pricing", children: [{ title: "Costs", children: [] }, { title: "Margin", children: [] }] },
        { title: "Timeline", children: [] },
      ]);
    }
  });

  it("starts a new indentation stack under a heading, retaining headings and plain-text levels", () => {
    const root = parseOutline("# Plan\n## Research\n    1. Interview\n       - Notes\n    2. Synthesis\n## Build\nRelease\n  Canary\n  General availability\nFollow-up");
    expect(root.children.map((section) => [section.title, ...section.children.map((child) => child.title)])).toEqual([
      ["Research", "Interview", "Synthesis"], ["Build", "Release", "Follow-up"],
    ]);
    expect(root.children[0].children[0].children.map((child) => child.title)).toEqual(["Notes"]);
    expect(root.children[1].children[0].children.map((child) => child.title)).toEqual(["Canary", "General availability"]);
  });

  it("preserves list-only roots and nested Markdown headings", () => {
    expect(parseOutline("  - First\n  - Second").children.map((node) => node.title)).toEqual(["First", "Second"]);
    const section = parseOutline("# Root\n## Group\n#### Deep\ntext\n### Next").children[0];
    expect(section.children).toEqual([{ title: "Deep", children: [{ title: "text", children: [] }] }, { title: "Next", children: [] }]);
  });
});
