// Re-render the HTML pages in out/ from their JSON traces, after a change to lib/page.js. No API calls.
//   node render.mjs                 # every out/*.json
//   node render.mjs out/x.json ...  # just these
import fs from "node:fs";
import path from "node:path";
import { renderPage } from "./lib/page.js";
const files = process.argv.length > 2 ? process.argv.slice(2) : fs.readdirSync("out").filter((f) => f.endsWith(".json")).map((f) => path.join("out", f));
for (const f of files) {
  const r = JSON.parse(fs.readFileSync(f, "utf8"));
  const out = f.replace(/\.json$/, ".html");
  fs.writeFileSync(out, renderPage(r, r.abc));
  console.log("rendered", out);
}
