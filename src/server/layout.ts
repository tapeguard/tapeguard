/** Shared document shell: metadata, fonts, the one stylesheet. */

import { statSync } from "node:fs";

export const SITE = {
  name: "tapeguard",
  domain: "tapeguard.xyz",
  url: "https://tapeguard.xyz",
  tagline: "The price, and the reason not to use it.",
  x: "https://x.com/tapeguard",
  telegram: "https://t.me/tapeguard",
  github: "https://github.com/tapeguard/tapeguard",
  launch: "24 Sept 2026 · 16:00 UTC",
  launchVenue: "Pons V2",
  chain: "Robinhood Chain",
  chainId: 4663,
} as const;

/**
 * Cache-busting asset URLs.
 *
 * Static assets are served with a long max-age, which is right for a small
 * site and wrong for every edit made to one: without a changing URL the
 * browser keeps last hour's stylesheet and shader, and the page under
 * development silently does not update. The mtime is read once at startup,
 * so this costs nothing per request.
 */
const ASSET_VERSIONS = new Map<string, string>();
const PUBLIC_ROOT = new URL("../../public/", import.meta.url);

/**
 * Memoised in production only.
 *
 * Caching the version for the process lifetime is correct once assets are
 * immutable, and actively misleading while they are being edited: the page
 * keeps emitting last-boot's version, the browser keeps serving its cached
 * copy, and an edit appears to have no effect at all. Which is a more
 * confusing failure than no cache-busting, because the mechanism looks like
 * it is working.
 */
const MEMOISE = process.env["NODE_ENV"] === "production";

export function asset(path: string): string {
  const cached = MEMOISE ? ASSET_VERSIONS.get(path) : undefined;
  if (cached !== undefined) return cached;
  let url = path;
  try {
    const mtime = statSync(new URL(path.replace(/^\//, ""), PUBLIC_ROOT)).mtimeMs;
    url = `${path}?v=${Math.floor(mtime).toString(36)}`;
  } catch {
    // A missing asset is a 404 the browser will report; do not fail the page.
  }
  if (MEMOISE) ASSET_VERSIONS.set(path, url);
  return url;
}

export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface PageMeta {
  title: string;
  description: string;
  path: string;
}

export function layout(meta: PageMeta, body: string, opts: { dither?: boolean } = {}): string {
  const fullTitle =
    meta.path === "/" ? `${SITE.name} — ${SITE.tagline}` : `${meta.title} — ${SITE.name}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(meta.description)}">
<link rel="canonical" href="${SITE.url}${meta.path}">

<link rel="icon" href="${asset("/favicon.svg")}" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#000000">
<meta name="color-scheme" content="dark">

<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE.name}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(meta.description)}">
<meta property="og:url" content="${SITE.url}${meta.path}">
<meta property="og:image" content="${SITE.url}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="tapeguard refusing a flagged price">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(fullTitle)}">
<meta name="twitter:description" content="${esc(meta.description)}">
<meta name="twitter:image" content="${SITE.url}/og.png">

<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${asset("/style.css")}">
</head>
<body>
${nav()}
${body}
${footer()}
${opts.dither ? `<script src="${asset("/dither.js")}" defer></script>` : ""}
<script src="${asset("/app.js")}" defer></script>
</body>
</html>`;
}

function nav(): string {
  return `<header class="nav"><div class="wrap nav-inner">
  <a class="brand" href="/"><img src="${asset("/mark.svg")}" alt="" width="22" height="22"><span>${SITE.name}</span></a>
  <nav class="nav-links">
    <a href="/#feed">Feed</a>
    <a href="/why">Why</a>
    <a href="/docs">Docs</a>
    <a href="${SITE.github}" rel="noopener">GitHub</a>
    <a href="${SITE.x}" rel="noopener">X</a>
  </nav>
  <span class="ca-pill" title="Contract address published at launch">
    <span class="dot"></span>CA: COMING SOON
  </span>
</div></header>`;
}

function footer(): string {
  return `<footer><div class="wrap foot-inner">
  <span>${SITE.name} · ${SITE.chain} (${SITE.chainId})</span>
  <span class="sp"></span>
  <a href="/docs">Docs</a>
  <a href="${SITE.github}" rel="noopener">GitHub</a>
  <a href="${SITE.x}" rel="noopener">X</a>
  <a href="${SITE.telegram}" rel="noopener">Telegram</a>
</div></footer>`;
}
