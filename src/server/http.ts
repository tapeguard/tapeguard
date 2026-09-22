/**
 * The service: API and site from one Node process, no framework.
 *
 * A long-lived process on a VM rather than a serverless function, because
 * the relayer holds a funded key and a scheduled HTTP endpoint that spends
 * gas is one cron misconfiguration away from a silent, unfunded stop.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { allVerdicts, health, verdictFor } from "./feed.ts";
import { renderHome, renderWhy } from "./pages.ts";
import { renderDocs } from "./docs.ts";
import { SITE } from "./layout.ts";

const PORT = Number(process.env["PORT"] ?? 8080);
const HOST = process.env["HOST"] ?? "127.0.0.1";
const PUBLIC_DIR = new URL("../../public/", import.meta.url).pathname;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};

function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  type: string,
  cache = "no-store",
): void {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": cache,
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  });
  res.end(body);
}

const json = (res: ServerResponse, status: number, value: unknown, cache = "no-store"): void =>
  send(res, status, JSON.stringify(value, null, 2), MIME[".json"] as string, cache);

async function serveStatic(res: ServerResponse, pathname: string): Promise<boolean> {
  // normalize collapses any ../ before it can escape the public directory.
  const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, "").replace(/^\/+/, "");
  if (rel === "") return false;
  const file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return false;
  try {
    const info = await stat(file);
    if (!info.isFile()) return false;
    const body = await readFile(file);
    const type = MIME[extname(file)] ?? "application/octet-stream";
    // Immutable for a year on hashed-ish assets, an hour otherwise: this is a
    // small site and a stale stylesheet is worse than a revalidation.
    send(res, 200, body, type, "public, max-age=3600");
    return true;
  } catch {
    return false;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const p = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method !== "GET" && req.method !== "HEAD") {
    return json(res, 405, { error: "method not allowed" });
  }

  try {
    switch (p) {
      case "/":
        return send(res, 200, renderHome((await allVerdicts()).verdicts), MIME[".html"] as string);
      case "/why":
        return send(res, 200, renderWhy(), MIME[".html"] as string);
      case "/docs":
        return send(res, 200, renderDocs(), MIME[".html"] as string);

      case "/api/health":
        return json(res, 200, health());

      case "/api/verdicts": {
        const { verdicts, failures } = await allVerdicts();
        // 207 when some instruments failed: a caller polling this must not
        // read a partial board as a complete one.
        return json(res, failures.length === 0 ? 200 : 207, {
          asOf: Math.floor(Date.now() / 1000),
          verdicts,
          failures,
        });
      }

      case "/robots.txt":
        return send(
          res,
          200,
          `User-agent: *\nAllow: /\nSitemap: ${SITE.url}/sitemap.xml\n`,
          MIME[".txt"] as string,
        );

      case "/sitemap.xml": {
        const urls = ["/", "/why", "/docs"]
          .map((u) => `  <url><loc>${SITE.url}${u}</loc></url>`)
          .join("\n");
        return send(
          res,
          200,
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
          "application/xml; charset=utf-8",
        );
      }
    }

    const quote = /^\/api\/quote\/([A-Za-z.]{1,10})$/.exec(p);
    if (quote) {
      try {
        return json(res, 200, await verdictFor(quote[1] as string));
      } catch (err) {
        return json(res, 404, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (await serveStatic(res, p)) return;
    return send(res, 404, "404\n", MIME[".txt"] as string);
  } catch (err) {
    // 503 rather than 500: the failure is an upstream that did not answer,
    // and a scheduler reads the status and nothing else.
    return json(res, 503, { error: err instanceof Error ? err.message : String(err) });
  }
}

createServer((req, res) => {
  handle(req, res).catch(() => {
    if (!res.headersSent) send(res, 500, "500\n", MIME[".txt"] as string);
  });
}).listen(PORT, HOST, () => {
  console.log(`tapeguard listening on http://${HOST}:${PORT}`);
});
