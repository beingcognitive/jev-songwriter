// Tiny static server so the generated pages load their soundfont over http rather than file://.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const PORT = Number(process.env.PORT || 3222);
const ROOT = process.cwd();
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".abc": "text/plain; charset=utf-8", ".css": "text/css" };
http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/") {
    const files = fs.existsSync("out") ? fs.readdirSync("out").filter((f) => f.endsWith(".html")).sort((a, b) => fs.statSync(path.join("out", b)).mtimeMs - fs.statSync(path.join("out", a)).mtimeMs) : [];
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(`<!doctype html><meta charset="utf-8"><title>Jev songwriter</title><body style="font-family:system-ui;max-width:640px;margin:40px auto;padding:0 16px"><h1>Compositions</h1>${files.length ? `<ul>${files.map((f) => `<li><a href="/out/${f}">${f}</a></li>`).join("")}</ul>` : "<p>Nothing yet. Run <code>npm run compose</code>.</p>"}`);
  }
  const file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`http://localhost:${PORT}/`));
