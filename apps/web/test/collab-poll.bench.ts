import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDocument, createSheet, createTopic } from "@mindmap/core/model";
import { bench } from "vitest";
import { getPlatformProxy, type PlatformProxy } from "wrangler";
import { OWNER_HEADER } from "../src/drafts/shared.js";
import { handleCollab } from "../worker/collab.js";

const configPath = fileURLToPath(new URL("./fixtures/wrangler.jsonc", import.meta.url));
const schema = await Promise.all([
  "0001_account_drafts", "0002_mindmaps", "0004_collaboration", "0007_mindmap_collab",
  "0013_live_checkpoints",
].map((name) => readFile(new URL(`../migrations/${name}.sql`, import.meta.url), "utf8")));

function documentWithTitle(title: string) {
  return JSON.stringify(createDocument([createSheet("sheet", "Map", createTopic("root", title))]));
}

for (const sizeKiB of [8, 512]) {
  const document = documentWithTitle("x".repeat(sizeKiB * 1024 - Buffer.byteLength(documentWithTitle("x")) + 1));
  for (const readerCount of [1, 8]) {
    const mapId = crypto.randomUUID();
    const readers = Array.from({ length: readerCount }, (_, index) => {
      const subject = `reader-${index}`;
      const request = new Request(`https://loomind.test/api/mindmaps/${mapId}/collab?since=0`, {
        headers: { [OWNER_HEADER]: subject },
      });
      return { subject, request };
    });
    let platform: PlatformProxy<Env>;

    bench(`idle poll: ${sizeKiB} KiB, ${readerCount} concurrent reader(s)`, async () => {
      await Promise.all(readers.map(async ({ request, subject }) => {
        const response = await handleCollab(request, platform.env, subject, mapId);
        if (!response.ok) throw new Error(`Unexpected poll status: ${response.status}`);
        await response.json();
      }));
    }, {
      warmupTime: 0, warmupIterations: 5, time: 0, iterations: 21,
      async setup() {
        platform = await getPlatformProxy<Env>({ configPath, persist: false, remoteBindings: false });
        const db = platform.env.DB;
        for (const migration of schema) {
          for (const statement of migration.split(";").map((part) => part.trim()).filter(Boolean)) {
            await db.prepare(statement).run();
          }
        }
        await db.prepare("INSERT INTO mindmaps (id, owner, title, revision, document) VALUES (?, 'owner', 'Map', 1, ?)")
          .bind(mapId, document).run();
        await db.batch(readers.map(({ subject }) => db.prepare(
          "INSERT INTO mindmap_members (mindmap_id, subject, role) VALUES (?, ?, 'viewer')",
        ).bind(mapId, subject)));
      },
      teardown: () => platform.dispose(),
    });
  }
}
