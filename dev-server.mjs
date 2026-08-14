// Static file server for local development. Node only, no dependencies.
//
//   node dev-server.mjs        # then open http://localhost:4173
//
// Responses are sent with caching switched off — a caching dev server makes
// edited CSS/JS look like it "didn't work" after a reload.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dirname, "docs");
const PORT = Number(process.env.PORT ?? 4173);

const CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".webmanifest": "application/manifest+json",
};

const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);
    let requested = decodeURIComponent(pathname);
    if (requested.endsWith("/")) {
        requested += "index.html";
    }

    // normalize() collapses any ".." before it can escape ROOT
    const filePath = join(ROOT, normalize(requested));
    if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Forbidden");
        return;
    }

    try {
        const body = await readFile(filePath);
        res.writeHead(200, {
            "Content-Type":
                CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream",
            "Cache-Control": "no-store, must-revalidate",
        });
        res.end(body);
    } catch {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
    }
});

server.listen(PORT, () => {
    console.log(`Serving docs/ on http://localhost:${PORT}`);
});
