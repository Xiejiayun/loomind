import type { MindmapDocument } from "../model/document.js";
import { collectAllTopics, validateDocumentInvariants } from "../model/invariants.js";
import { MindmapDocumentSchema } from "../model/schema.js";

export function importLoomindBackup(text: string): MindmapDocument {
  const document = MindmapDocumentSchema.parse(JSON.parse(text));
  const [violation] = validateDocumentInvariants(document);
  if (violation) throw new Error(violation.message);
  for (const sheet of document.sheets) {
    for (const topic of collectAllTopics(sheet).values()) {
      if (topic.image && !Object.hasOwn(document.assets, topic.image.resourceId)) {
        throw new Error(`Missing image: ${topic.image.resourceId}`);
      }
    }
  }
  return document;
}
