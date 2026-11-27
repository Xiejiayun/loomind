import { bench, describe } from "vitest";
import { createDocument, createRichText, createSheet, createTopic } from "../src/model/document.js";
import { LoroSyncAdapter } from "../src/store/loro-adapter.js";

for (const branchCount of [100, 300]) {
  describe(`${1 + 10 * branchCount} topics`, () => {
    const branches = Array.from({ length: branchCount }, (_, branchIndex) =>
      createTopic(`branch-${branchIndex}`, "Branch", {
        children: Array.from({ length: 9 }, (_, leafIndex) => createTopic(`leaf-${branchIndex}-${leafIndex}`, "Leaf")),
      }),
    );
    const root = createTopic("root", "Root", { children: branches });
    const adapter = new LoroSyncAdapter(createDocument([createSheet("sheet", "Map", root)]), 1n);
    const topicId = `leaf-${branchCount - 1}-8`;
    let revision = 0;

    bench(
      "rename the last leaf",
      () => {
        adapter.applyCommand({
          type: "topic/setTitle", sheetId: "sheet", topicId, title: createRichText(`Title ${++revision}`),
        });
      },
      { warmupTime: 0, warmupIterations: 5, time: 0, iterations: 21 },
    );
  });
}
