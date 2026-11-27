import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function pdfCharacterMaps(): Plugin {
  const folder = join(dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")), "cmaps");
  const names = new Set(readdirSync(folder).filter((name) => name.endsWith(".bcmap") || name === "LICENSE"));
  return {
    name: "pdf-character-maps",
    configureServer(server) {
      server.middlewares.use("/pdf-cmaps", (request, response, next) => {
        const name = request.url?.split("?")[0].slice(1) ?? "";
        if (!names.has(name)) return next();
        response.setHeader("Content-Type", "application/octet-stream"); response.end(readFileSync(join(folder, name)));
      });
    },
    generateBundle() {
      for (const name of names) this.emitFile({ type: "asset", fileName: `pdf-cmaps/${name}`, source: readFileSync(join(folder, name)) });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), pdfCharacterMaps()],
  resolve: {
    alias: {
      "loro-crdt": "loro-crdt/base64",
    },
  },
  optimizeDeps: {
    exclude: ["loro-crdt"],
    esbuildOptions: {
      target: "esnext",
    },
  },
  build: {
    target: "esnext",
  },
  server: {
    port: Number(process.env.LOOMIND_DEV_PORT ?? 5173),
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
