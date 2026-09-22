// Re-render the HTML pages in out/ from their JSON traces, after a change to lib/page.js or lib/abc.js. The ABC
// and the per-note spans are recomputed from the trace (never trusted from the file) and written back. No API calls.
//   node render.mjs                 # every out/*.json
//   node render.mjs out/x.json ...  # just these
import fs from "node:fs";
import path from "node:path";
import { renderPage } from "./lib/page.js";
import { toAbc } from "./lib/abc.js";
const files = process.argv.length > 2 ? process.argv.slice(2) : fs.readdirSync("out").filter((f) => f.endsWith(".json")).map((f) => path.join("out", f));
for (const f of files) {
  if (!/\.json$/i.test(f)) throw new Error(`expected a .json trace, got ${f}`);
  const r = JSON.parse(fs.readFileSync(f, "utf8"));
  r.abc = toAbc(r);
  const out = f.replace(/\.json$/i, ".html");
  fs.writeFileSync(out, renderPage(r, r.abc));
  fs.writeFileSync(f, JSON.stringify(r, null, 2));
  console.log("rendered", out);
}