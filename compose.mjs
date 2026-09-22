#!/usr/bin/env node
// CLI: compose one song with Jev and write ABC, JSON (every call) and a playable HTML page into out/.
//   node compose.mjs --key C --mode major --tempo 100 --form aaba_32 --seed 7 --title "Morning"
//   node compose.mjs --mood "wistful, late night"      # Jev picks mode, tempo and form from the mood, then chords, then notes
//   node compose.mjs --order interleaved              # each bar's chord decided just before its notes (one bar ahead)
//   node compose.mjs --chords "C G Am F"              # chords given (cycled over every phrase), Jev writes only the melody
//   node compose.mjs --chords fixed                   # the hand-written progressions instead of Jev's chords
//   node compose.mjs --mood "bossa nova" / --mood jazz # named moods: a fuller brief for Jev, seventh chords offered (--sevenths adds them to any mood)
// Forms: mini_8, short_16, aabb_16, aaba_32, auto. Without TYPESAFE_API_KEY the seeded mock plays Jev's part.
import fs from "node:fs";
import path from "node:path";
for (const f of [".dev.vars", ".env"]) { try { process.loadEnvFile(f); break; } catch {} }
const { compose, ORDERS } = await import("./lib/melody.js");
const { FORMS } = await import("./lib/form.js");
const { toAbc } = await import("./lib/abc.js");
const { renderPage } = await import("./lib/page.js");
const { backend } = await import("./lib/jev.js");

const FLAGS = new Set(["quiet", "sevenths"]);
const VALUES = new Set(["key", "mode", "tempo", "form", "mood", "chords", "order", "seed", "title", "out", "name"]);
const fail = (msg) => { console.error(msg); process.exit(2); };
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--help" || a === "-h") { console.log(fs.readFileSync(new URL(import.meta.url)).toString().split("\n").slice(1, 9).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")); process.exit(0); }
  if (!a.startsWith("--")) fail(`unexpected argument "${a}" (options start with --; see --help)`);
  const k = a.slice(2);
  if (FLAGS.has(k)) { args[k] = true; continue; }
  if (!VALUES.has(k)) fail(`unknown option --${k} (see --help)`);
  const v = process.argv[i + 1];
  if (v == null || v.startsWith("--")) fail(`--${k} needs a value`);
  args[k] = v; i++;
}
if (args.seed != null && !Number.isFinite(Number(args.seed))) fail(`--seed must be a number, got "${args.seed}"`);
if (args.tempo != null && !Number.isFinite(Number(args.tempo))) fail(`--tempo must be a number, got "${args.tempo}"`);
const opts = {
  key: args.key ?? "C", mode: args.mode, tempo: args.tempo, form: args.form, mood: args.mood,
  chords: args.chords ?? "jev", order: args.order ?? "chords-first", sevenths: args.sevenths === true ? true : undefined,
  seed: args.seed ?? Math.floor(Math.random() * 9000) + 1000, title: args.title,
};
if (opts.form && opts.form !== "auto" && !Object.hasOwn(FORMS, opts.form)) fail(`unknown form "${opts.form}"; one of ${Object.keys(FORMS).join(", ")}, or auto`);
if (!ORDERS.includes(opts.order)) { console.error(`unknown order "${opts.order}"; one of ${ORDERS.join(", ")}`); process.exit(2); }
const be = backend(process.env);
const outDir = args.out ?? "out";
fs.mkdirSync(outDir, { recursive: true });

const byJev = (v, what) => v ?? (opts.mood ? `(${what}: Jev decides)` : { mode: "major", tempo: 100, form: "aaba_32" }[what]);
console.log(`Jev songwriter · ${opts.key} ${byJev(opts.mode, "mode")} · ${byJev(opts.tempo, "tempo")} bpm · form ${byJev(opts.form, "form")} · chords ${opts.chords}${opts.chords === "jev" ? ", " + opts.order : ""}${opts.mood ? ` · mood "${opts.mood}"` : ""} · seed ${opts.seed} · backend ${be.kind === "native" ? "jev-latest" : "mock (no TYPESAFE_API_KEY)"}`);
process.on("uncaughtException", (e) => {
  if (e?.cause?.code === "SELF_SIGNED_CERT_IN_CHAIN" || e?.code === "SELF_SIGNED_CERT_IN_CHAIN") {
    console.error("TLS: Node does not trust the certificate chain (a corporate proxy, most likely). Run with the system trust store:\n  node --use-system-ca compose.mjs ...   (npm run compose does this)");
    process.exit(1);
  }
  throw e;
});
const t0 = Date.now();
let phase = "";
const onStep = (t) => {
  if (args.quiet) return;
  const next = opts.chords !== "jev" ? "melody" : opts.order === "interleaved" ? "both" : t.kind === "chord" ? "chords" : "melody";
  if (next === "melody" && phase === "" && opts.chords !== "jev") console.log(opts.chords === "fixed" ? "Chords from the fixed tables." : `Chords given: ${opts.chords}`);
  if (next !== phase) { phase = next; console.log({ chords: "Getting chords…", melody: "Writing the melody…", both: "Chords and melody, bar by bar…" }[phase]); }
  const where = `bar ${String(t.bar).padStart(2)}${t.kind === "jev" ? ` beat ${t.beat.padEnd(5)}` : "           "}`;
  if (t.kind === "chord") {
    if (t.io) console.log(`  ${where}  ${(t.chord + " (" + t.roman + ")").padEnd(12)} chord          ${t.source === "jev" ? "Jev " : "code"}  conf ${`${Math.round(t.confidence * 100)}%`.padStart(4)}  rank #${t.heuristicRank}/${t.optionCount}  ${t.latencyMs} ms`);
    else console.log(`  ${where}  ${t.source === "forced" ? "code" : "repeat"}: ${t.note}`);
  } else if (t.kind === "jev") {
    console.log(`  ${where}  ${t.pitch.padEnd(5)} ${t.length.padEnd(14)} ${t.source === "jev" ? "Jev " : "code"}  conf ${`${Math.round(t.confidence * 100)}%`.padStart(4)}  rank #${t.heuristicRank}/${t.optionCount}  ${t.latencyMs} ms${t.note ? `  (${t.note})` : ""}`);
  } else console.log(`  ${where}  ${t.kind === "forced" ? "code" : "repeat"}: ${t.note}`);
};
let result;
try { result = await compose(opts, be, onStep); }
catch (e) { if (e?.cause?.code === "SELF_SIGNED_CERT_IN_CHAIN" || e?.code === "SELF_SIGNED_CERT_IN_CHAIN") throw e; fail(String(e.message || e)); }
const abc = toAbc(result);
const name = args.name ?? `${result.abcKey}-${result.form}-${result.seed}-${be.kind === "native" ? "jev" : "mock"}`;
const base = path.join(outDir, name);
fs.writeFileSync(`${base}.abc`, abc);
fs.writeFileSync(`${base}.json`, JSON.stringify({ ...result, abc }, null, 2));
fs.writeFileSync(`${base}.html`, renderPage(result, abc));
const s = result.stats;
if (result.setupCall) console.log(`\nSetup: Jev read the mood and chose ${Object.entries(result.setupCall.picks).map(([q, v]) => `${q} ${v}${q === "tempo" ? " bpm" : ""} (${Math.round(result.setupCall.answers[q].confidence * 100)}%)`).join(", ")} in ${result.setupCall.latencyMs} ms.`);
if (result.moodPreset) console.log(`Mood preset "${result.moodPreset}": ${result.mood}`);
console.log(`\n${result.key}, ${result.tempo} bpm, ${result.formName}: ${result.bars} bars, about ${result.seconds} s. Jev chose ${s.chordCalls} chords and ${s.jevSteps} notes in ${((Date.now() - t0) / 1000).toFixed(1)} s; code played ${s.forcedSteps} cadences and repeated ${s.reusedBars} bars.`);
const pctOf = (x) => (x == null ? "–" : `${Math.round(x * 100)}%`);
if (be.kind === "native") console.log(`${s.calls} calls, ${s.inputTokens.toLocaleString()} input tokens, about $${s.costUsd.toFixed(4)}. Agreement with code's first choice: notes ${pctOf(s.agreement)}${s.chordCalls ? `, chords ${pctOf(s.chordAgreement)}` : ""}.`);
console.log(`\n${abc}`);
const servable = path.relative(process.cwd(), path.resolve(base)).startsWith(`out${path.sep}`);
console.log(`Wrote ${base}.abc, .json, .html\n${servable ? `Listen: npm run serve, then http://localhost:3222/${base}.html  (or open ${base}.html)` : `Open ${base}.html (npm run serve serves only out/ and docs/)`}`);
