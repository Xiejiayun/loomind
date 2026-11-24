import { describe, expect, it } from "vitest";
import { createDocument, LocalImmerSyncAdapter, richTextToPlainText } from "@mindmap/core";
import { reconcileStreamingTree, runNodeAiAction } from "../src/index.js";

describe("@mindmap/ai streaming & actions", () => {
  it("reconciles streaming partial trees incrementally without duplicating nodes", () => {
    const doc = createDocument();
    const adapter = new LocalImmerSyncAdapter(doc);
    const sheetId = doc.activeSheetId;
    const rootId = doc.sheets[0].rootTopic.id;

    reconcileStreamingTree(
      adapter,
      sheetId,
      rootId,
      { title: "AI 规划", children: [{ title: "阶段一" }] },
      "testai",
    );
    reconcileStreamingTree(
      adapter,
      sheetId,
      rootId,
      {
        title: "AI 规划",
        children: [
          { title: "阶段一（更新）", children: [{ title: "子任务 A" }] },
          { title: "阶段二" },
        ],
      },
      "testai",
    );

    const root = adapter.getDocument().sheets[0].rootTopic;
    expect(richTextToPlainText(root.title)).toBe("AI 规划");
    const aiChildren = root.children.filter((c) => c.id.startsWith("testai-"));
    expect(aiChildren).toHaveLength(2);
    expect(richTextToPlainText(aiChildren[0].title)).toBe("阶段一（更新）");
    expect(aiChildren[0].children).toHaveLength(1);
  });

  it("executes node-level AI actions (expand, tasks, restyle)", async () => {
    const doc = createDocument();
    const adapter = new LocalImmerSyncAdapter(doc);
    const sheetId = doc.activeSheetId;
    const targetId = doc.sheets[0].rootTopic.children[0].id;

    await runNodeAiAction(adapter, sheetId, targetId, "tasks");
    const updated = adapter.getDocument().sheets[0].rootTopic.children[0];
    expect(updated.children).toHaveLength(4);
    expect(updated.children.every((c) => c.task?.status === "todo")).toBe(true);
  });
});
