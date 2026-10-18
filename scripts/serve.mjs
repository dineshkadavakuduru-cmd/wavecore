/**
 * Minimal static file server for the exported site.
 *
 * `next build` with `output: "export"` writes a pure static bundle to `out/` —
 * there is no Next server to run, and `next start` refuses to work against an
 * export ("next start" expects a server build). This serves `out/` with the
 * Node standard library alone, so a local preview needs no extra dependency.
 *
 *   node scripts/serve.mjs [root] [port]
 *
 * Defaults: root = out, port = 3000.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize, resolve as resolvePath } from "node:path";

const root = resolvePath(process.argv[2] ?? "out");
const port = Number(process.argv[3] ?? process.env.PORT ?? 3000);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/** Map a request path to a real file inside `root`, or null. */
async function resolveFile(pathname) {
  const clean = normalize(decodeURIComponent(pathname.split("?")[0])).replace(
    /^(\.\.[/\\])+/,
    "",
  );
  const rel = clean.replace(/^[/\\]/, "");
  const candidates = clean === "/" || clean === "\\" ? ["index.html"] : [rel, `${rel.replace(/\/$/, "")}.html`];
  for (const candidate of candidates) {
    try {
      const p = join(root, candidate);
      const s = await stat(p);
      if (s.isDirectory()) {
        const idx = join(p, "index.html");
        await stat(idx);
        return idx;
      }
      return p;
    } catch {
      /* try the next candidate */
    }
  }
  try {
    await stat(join(root, "404.html"));
    return join(root, "404.html");
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const file = await resolveFile(req.url ?? "/");
  if (!file) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }
  try {
    const body = await readFile(file);
    res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
    // Static export assets are content-hashed; the HTML must never be cached
    // across a rebuild.
    res.setHeader("cache-control", file.endsWith(".html") ? "no-store" : "public, max-age=31536000, immutable");
    res.statusCode = file.endsWith("404.html") ? 404 : 200;
    res.end(body);
  } catch {
    res.statusCode = 500;
    res.end("Internal error");
  }
});

server.listen(port, () => {
  console.log(`wavecore static preview → http://localhost:${port}  (root: ${root})`);
});
