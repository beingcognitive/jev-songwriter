// Tiny static server for the generated pages, so their soundfont loads over http rather than file://.
// Serves only out/ and docs/, only on localhost: the repository root (and any .dev.vars in it) is never exposed.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const PORT = Number(process.env.PORT || 3222);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = process.cwd();
const SERVED = ["out", "docs"];
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".abc": "text/plain; charset=utf-8", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// The file a request may read, or null. Decoded, normalised, then required to sit under out/ or docs/ with
// no dot-segment left and no hidden component. A sibling directory that shares the root's name prefix is
// not under the root.
export function resolveFile(root, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  const file = path.resolve(root, "." + path.posix.normalize("/" + decoded));
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  if (!SERVED.includes(parts[0]) || parts.some((p) => p.startsWith("."))) return null;
  if (!TYPES[path.extname(file)]) return null;
  return file;
}

// The path resolveFile allows, re-checked after following symlinks: a link inside out/ that points at a
// secret elsewhere is refused too.
export function safeFile(root, pathname) {
  const file = resolveFile(root, pathname);
  if (!file) return null;
  try {
    const real = fs.realpathSync(file), rel = path.relative(fs.realpathSync(root), real);
    const parts = rel.split(path.sep);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || !SERVED.includes(parts[0]) || parts.some((p) => p.startsWith(".")) || !TYPES[path.extname(real)]) return null;
    return fs.statSync(real).isFile() ? real : null;
  } catch { return null; }
}

export function handler(req, res) {
  let url;
  try { url = new URL(req.url, "http://localhost"); } catch { res.writeHead(400); return res.end("bad request"); }
  if (url.pathname === "/") {
    const files = fs.existsSync("out") ? fs.readdirSync("out").filter((f) => f.endsWith(".html")).sort((a, b) => fs.statSync(path.join("out", b)).mtimeMs - fs.statSync(path.join("out", a)).mtimeMs) : [];
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(`<!doctype html><meta charset="utf-8"><title>Jev songwriter</title><body style="font-family:system-ui;max-width:640px;margin:40px auto;padding:0 16px"><h1>Compositions</h1>${files.length ? `<ul>${files.map((f) => `<li><a href="/out/${encodeURIComponent(f)}">${esc(f)}</a></li>`).join("")}</ul>` : "<p>Nothing yet. Run <code>npm run compose</code>.</p>"}<p><a href="/docs/index.html">The site (docs/)</a></p>`);
  }
  const file = safeFile(ROOT, url.pathname);
  if (!file) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] });
  fs.createReadStream(file).pipe(res);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  http.createServer(handler).listen(PORT, HOST, () => console.log(`http://localhost:${PORT}/`));
}
