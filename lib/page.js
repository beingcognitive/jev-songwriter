// A self-contained HTML page for one composition: the score and player (abcjs), a replay that rebuilds the
// sheet decision by decision at the speed Jev actually answered (setup, chords, notes), every decision with its
// probabilities, and the ABC.
import { PRICE_PER_M_INPUT } from "./jev.js";

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const pct = (x) => (x == null ? "–" : `${Math.round(x * 100)}%`);
// JSON that is safe inside a <script> element: no "<" or ">" survives (so neither "</script" nor "<!--<script"
// can appear), and the two line terminators JSON allows raw are escaped. JSON only has these characters inside
// strings, where \uXXXX means the same thing, so the parsed data is unchanged.
export const embedJson = (value) => JSON.stringify(value).replace(/[<>\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

export function renderPage(result, abc) {
  if (!result.notes.every((n) => n.abcStart != null)) throw new Error("renderPage needs the spans toAbc records on result.notes: call toAbc(result) first");
  const data = embedJson({ ...result, abc });
  const st = result.stats;
  const live = result.backend === "native";
  const cost = st.costUsd < 0.01 ? `$${st.costUsd.toFixed(4)}` : `$${st.costUsd.toFixed(3)}`;
  const callsLine = live
    ? `${st.calls} calls to ${esc(result.model)} · ${st.inputTokens.toLocaleString()} input tokens · about ${cost}`
    : `${st.calls} mock calls (${esc(result.model)}): no API call was made. Set TYPESAFE_API_KEY to hear the real Jev.`;
  const sc = result.setupCall;
  const chose = sc ? Object.entries(sc.picks).map(([q, v]) => `${q} ${esc(String(v))}${q === "tempo" ? " bpm" : ""} (${pct(sc.answers[q].confidence)})`).join(", ") : "";
  const moodLine = [
    result.mood ? `Mood: “${esc(result.mood)}”${result.sevenths ? " · seventh chords in play" : ""}` : null,
    sc ? `Jev chose ${chose}` : null,
    result.chordsMode === "jev" ? `chords by Jev, ${result.order === "interleaved" ? "each bar's chord decided just before its notes, one bar ahead" : "all chords first, then the notes"}`
      : result.chordsMode === "given" ? `chords given: ${esc(result.givenChords)} (Jev wrote the melody over them)` : "chords from the fixed tables",
  ].filter(Boolean).join(" · ");
  const decided = `Jev chose ${st.chordCalls ?? 0} chords and ${st.jevSteps} notes; code played ${st.forcedSteps} cadences and repeated ${st.reusedBars} bars. ` +
    `Agreement with code's first choice: notes ${pct(st.agreement)}${st.chordCalls ? `, chords ${pct(st.chordAgreement)}` : ""}; mean note confidence ${pct(st.meanConfidence)}${st.fallbacks ? `; ${st.fallbacks} answers fell back to code` : ""}.`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(result.title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/abcjs@6/abcjs-audio.css">
<style>
:root { color-scheme: light dark; --bg: #f7f6f2; --card: #ffffff; --ink: #1d1c1a; --muted: #6b675f; --line: #e4e1da; --accent: #2f6f4e; --accent-soft: #d9ece1; --hl: #f3c969; --bar: #8fbfa5; --chord: #a0522d; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #171614; --card: #201f1c; --ink: #ebe7df; --muted: #a09a8f; --line: #35322d; --accent: #7fc9a0; --accent-soft: #23392d; --hl: #b8892b; --bar: #3f7d5c; --chord: #e0956a; } }
:root[data-theme="dark"] { --bg: #171614; --card: #201f1c; --ink: #ebe7df; --muted: #a09a8f; --line: #35322d; --accent: #7fc9a0; --accent-soft: #23392d; --hl: #b8892b; --bar: #3f7d5c; --chord: #e0956a; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
main { max-width: 1280px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.01em; }
h2 { font-size: 16px; margin: 0 0 12px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }
h3 { font-size: 13px; margin: 0 0 6px; color: var(--muted); font-weight: 600; }
.meta { color: var(--muted); margin: 0 0 4px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-top: 16px; }
#paper svg { max-width: 100%; }
#paper .abcjs-note.hl, #paper .abcjs-rest.hl, #paper .hl path { fill: var(--hl) !important; stroke: var(--hl) !important; }
#paper .new path { fill: var(--accent) !important; stroke: var(--accent) !important; }
#paper .new text, #paper .new .abcjs-chord { fill: var(--chord) !important; font-weight: 700; }
#paper .abcjs-cursor { stroke: var(--accent); stroke-width: 2.5; opacity: .85; }
.stage { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; align-items: start; }
.call { display: flex; flex-direction: column; gap: 10px; } .call > * { flex: none; }
.pane { max-height: 250px; overflow: auto; }
.when { font-weight: 400; color: var(--muted); }
@media (min-width: 1100px) {
  .stage.live { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); }
  .stage.live .sheet { position: sticky; top: 8px; }
  .stage.live .call { max-height: calc(100vh - 24px); overflow: auto; border-left: 1px solid var(--line); padding-left: 20px; }
}
.row { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; margin-top: 8px; color: var(--muted); }
.controls { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.controls select { font: inherit; padding: 4px 6px; border-radius: 6px; border: 1px solid var(--line); background: var(--card); color: var(--ink); }
.controls input[type=range] { flex: 1; min-width: 140px; accent-color: var(--accent); }
#status { color: var(--ink); min-height: 1.5em; }
.think { display: flex; align-items: center; gap: 10px; margin: 4px 0 12px; font-variant-numeric: tabular-nums; color: var(--muted); font-size: 13px; }
.think-bar { flex: 1; height: 6px; background: var(--line); border-radius: 3px; overflow: hidden; }
.think-bar i { display: block; height: 100%; width: 0; background: var(--accent); }
.opts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 16px; }
.opt { display: grid; grid-template-columns: 56px 1fr 44px 30px; gap: 6px; align-items: center; font-size: 13px; font-variant-numeric: tabular-nums; padding: 1px 0; }
.opt .bar { height: 10px; background: var(--line); border-radius: 5px; overflow: hidden; }
.opt .bar i { display: block; height: 100%; width: 0; background: var(--bar); transition: width .35s ease-out; }
.opt.pick b { color: var(--accent); } .opt.pick .bar i { background: var(--accent); }
.opt small { color: var(--muted); }
.facts { font-size: 13px; color: var(--muted); margin: 0; }
#lat { display: flex; align-items: flex-end; gap: 2px; height: 44px; margin-top: 4px; flex-wrap: wrap; }
#lat i { display: block; width: 6px; background: var(--bar); border-radius: 2px 2px 0 0; min-height: 2px; }
#lat i.chord { background: var(--chord); opacity: .7; }
#lat i.cur { background: var(--accent); opacity: 1; }
.stats { color: var(--muted); font-size: 13px; margin-top: 0; font-variant-numeric: tabular-nums; }
details { margin-top: 10px; } summary { cursor: pointer; color: var(--muted); font-size: 13px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; white-space: nowrap; }
th { color: var(--muted); font-weight: 600; position: sticky; top: 0; background: var(--card); }
tr.hl td { background: var(--accent-soft); }
tr.forced td, tr.reuse td, tr.chord.forced td, tr.chord.reuse td { color: var(--muted); }
tr.chord td:nth-child(5) { color: var(--chord); font-weight: 600; }
td.note { white-space: normal; min-width: 240px; }
.tops { display: flex; flex-direction: column; gap: 2px; min-width: 200px; }
.top { display: grid; grid-template-columns: 52px 1fr 40px; gap: 6px; align-items: center; font-variant-numeric: tabular-nums; }
.top .bar { height: 8px; background: var(--line); border-radius: 4px; overflow: hidden; }
.top .bar i { display: block; height: 100%; background: var(--bar); }
.top.pick b { color: var(--accent); }
.badge { display: inline-block; padding: 1px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 12px; font-weight: 600; }
.wrap { overflow-x: auto; }
pre { white-space: pre-wrap; word-break: break-word; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--bg); padding: 12px; border-radius: 8px; margin: 0; }
pre.small { max-height: 320px; overflow: auto; }
button { font: inherit; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--ink); cursor: pointer; }
button:hover { border-color: var(--accent); } button:disabled { opacity: .5; cursor: default; }
button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.abcjs-inline-audio { background: var(--accent-soft) !important; border-radius: 8px; }
.abcjs-inline-audio .abcjs-btn { fill: var(--ink); }
#audio.off { opacity: .45; pointer-events: none; }
@media (max-width: 640px) { th:nth-child(9), td:nth-child(9) { display: none; } }
</style>
</head>
<body>
<main>
<h1>${esc(result.title)}</h1>
<p class="meta">${esc(result.key)} · 4/4 · ${result.tempo} bpm · ${esc(result.formName)} · ${result.bars} bars, about ${result.seconds} s · range ${esc(result.range)} · seed ${result.seed}</p>
<p class="meta">${moodLine}</p>
<p class="meta">${callsLine}</p>
<p class="meta">${decided}</p>

<section class="card">
  <div class="controls">
    <button id="replay" class="primary">Replay the composition</button>
    <button id="pause" disabled>Pause</button>
    <button id="prev" title="one step back">◀</button>
    <input type="range" id="scrub" min="0" value="0" step="1" title="drag to any step">
    <button id="next" title="one step forward">▶</button>
    <label>speed <select id="speed"><option value="1" selected>real time</option><option value="3">3×</option><option value="10">10×</option><option value="30">30×</option></select></label>
  </div>
  <p class="meta" id="status">Press Replay to watch Jev build it decision by decision at the speed it happened, or drag the slider to step through.</p>
  <div class="stage" id="stage">
    <div class="sheet">
      <div class="think"><div class="think-bar"><i id="think-fill"></i></div><span id="think-ms"></span></div>
      <div id="paper"></div>
      <div id="audio"></div>
      <div class="row">
        <label><input type="checkbox" id="chords" checked> play the chords under the melody</label>
        <span id="audio-note"></span>
      </div>
    </div>
    <aside class="call" id="answer" hidden>
      <h3>Raw response <span class="when" id="res-when"></span></h3>
      <pre class="pane" id="res"></pre>
      <h3>Request Jev received</h3>
      <pre class="pane" id="req"></pre>
      <div class="opts-grid" id="opts"></div>
      <p class="facts" id="facts"></p>
      <div id="lat" title="one bar per call; height is Jev's response time; brown bars are chord calls"></div>
      <div class="stats" id="stats"></div>
    </aside>
  </div>
</section>

<section class="card">
  <h2>Every decision</h2>
  <div class="wrap"><table id="trace">
    <thead><tr><th>#</th><th>Bar</th><th>Beat</th><th>By</th><th>Pick</th><th>Length</th><th>Conf.</th><th>Rank</th><th>Jev's top choices</th><th>ms</th></tr></thead>
    <tbody></tbody>
  </table></div>
</section>

<section class="card">
  <h2>ABC</h2>
  <p class="meta"><button id="copy">Copy ABC</button> Paste it into any ABC tool, or a DAW that imports ABC.</p>
  <pre id="abc"></pre>
</section>
</main>
<script src="https://cdn.jsdelivr.net/npm/abcjs@6/dist/abcjs-basic-min.js"></script>
<script>
const DATA = ${data};
const LEN = { eighth: "♪ eighth", quarter: "quarter", dotted_quarter: "dotted quarter", half: "half", dotted_half: "dotted half", whole: "whole" };
const $ = (id) => document.getElementById(id);
const pct = (x) => (x == null ? "–" : Math.round(x * 100) + "%");
const fmtMs = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(1) + " s" : Math.round(ms) + " ms");
const PRICE = ${PRICE_PER_M_INPUT};
// Every string that reaches innerHTML goes through this, including option keys, which come from the API response.
const h = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
$("abc").textContent = DATA.abc;
$("copy").onclick = () => navigator.clipboard.writeText(DATA.abc).then(() => { $("copy").textContent = "Copied"; });

// ---- decisions table
const tbody = document.querySelector("#trace tbody");
const tops = (top, pick) => '<div class="tops">' + (top || []).map(([k, p]) =>
  '<div class="top' + (k === pick ? " pick" : "") + '"><b>' + h(k) + '</b><span class="bar"><i style="width:' + Math.round(p * 100) + '%"></i></span><span>' + pct(p) + "</span></div>").join("") + "</div>";
for (const t of DATA.trace) {
  const tr = document.createElement("tr");
  tr.className = t.kind + (t.source ? " " + t.source : ""); tr.dataset.step = t.step;
  const by = t.io ? '<span class="badge">Jev</span>' + (t.source === "fallback" ? " → code" : "") : (t.kind === "reuse" || t.source === "reuse") ? "repeat" : "code";
  let cells;
  if (t.kind === "chord") cells = [t.step, t.bar, "", by, h(t.chord) + " (" + h(t.roman) + ")", "chord", t.io ? pct(t.confidence) : "", t.io ? "#" + t.heuristicRank + "/" + t.optionCount : "", t.io ? tops(t.answers.chord.top, t.chord) : '<span class="note">' + h(t.note) + "</span>", t.io ? t.latencyMs : ""];
  else if (t.kind === "jev") cells = [t.step, t.bar, t.beat, by, h(t.pitch), LEN[t.length] + (t.note ? " · " + h(t.note) : ""), pct(t.confidence), "#" + t.heuristicRank + "/" + t.optionCount, tops(t.answers.next_pitch.top, t.pitch), t.latencyMs];
  else cells = [t.step, t.bar, t.beat, by, h(t.pitch || ""), t.length ? LEN[t.length] : "", "", "", '<span class="note">' + h(t.note) + "</span>", ""];
  tr.innerHTML = cells.map((c, i) => "<td" + (i === 8 ? ' class="note"' : "") + ">" + c + "</td>").join("");
  tbody.appendChild(tr);
}
const rowFor = (step) => tbody.querySelector('tr[data-step="' + step + '"]');
const showPanel = (on) => { $("answer").hidden = !on; $("stage").classList.toggle("live", on); };
let typeRaf = 0;
function typeInto(el, text, ms) {
  cancelAnimationFrame(typeRaf);
  if (!ms) { el.textContent = text; return; }
  const start = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - start) / ms);
    el.textContent = text.slice(0, Math.floor(text.length * p));
    el.scrollTop = el.scrollHeight;
    if (p < 1) typeRaf = requestAnimationFrame(tick); else el.scrollTop = 0;
  };
  typeRaf = requestAnimationFrame(tick);
}

// ---- score
const HEADER_END = DATA.abc.indexOf("\\n", DATA.abc.indexOf("\\nK:") + 1) + 1;
let visualObj = null, renderedAbc = null;
function renderScore(abc) {
  if (abc === renderedAbc) return; // the SynthController holds this visualObj; do not replace it for nothing
  renderedAbc = abc;
  visualObj = ABCJS.renderAbc("paper", abc, { responsive: "resize", add_classes: true })[0];
}
renderScore(DATA.abc);

// ---- audio
const cursorControl = {
  onStart() {
    const svg = document.querySelector("#paper svg");
    if (svg && !svg.querySelector(".abcjs-cursor")) { const c = document.createElementNS("http://www.w3.org/2000/svg", "line"); c.setAttribute("class", "abcjs-cursor"); svg.appendChild(c); }
  },
  onFinished() {
    document.querySelectorAll("#paper .hl").forEach((el) => el.classList.remove("hl"));
    const c = document.querySelector("#paper .abcjs-cursor"); if (c) c.remove();
  },
  onEvent(ev) {
    if (ev.measureStart && ev.left === null) return;
    document.querySelectorAll("#paper .hl").forEach((el) => el.classList.remove("hl"));
    for (const set of ev.elements || []) for (const el of set) el.classList.add("hl");
    const c = document.querySelector("#paper .abcjs-cursor");
    if (c && ev.left != null) { c.setAttribute("x1", ev.left - 2); c.setAttribute("x2", ev.left - 2); c.setAttribute("y1", ev.top); c.setAttribute("y2", ev.top + ev.height); }
  },
};
let synthControl = null, loadSeq = 0;
const loadAudio = () => {
  if (!synthControl) return;
  const mine = ++loadSeq;
  synthControl.setTune(visualObj, false, { chordsOff: !$("chords").checked })
    .then(() => { if (mine === loadSeq) $("audio-note").textContent = ""; })
    .catch((e) => { if (mine === loadSeq) $("audio-note").textContent = "Audio failed to load: " + e; });
};
if (ABCJS.synth.supportsAudio()) {
  synthControl = new ABCJS.synth.SynthController();
  synthControl.load("#audio", cursorControl, { displayLoop: true, displayRestart: true, displayPlay: true, displayProgress: true, displayWarp: true });
  loadAudio();
  $("chords").onchange = () => { if (k === N) loadAudio(); }; // a partial score is never loaded; step N reloads it
  // Never play without a click: pause when the page is hidden or left, and come back paused if the browser
  // restores the page from its back/forward cache.
  window.addEventListener("pagehide", () => synthControl.pause());
  window.addEventListener("pageshow", (ev) => { if (ev.persisted) synthControl.pause(); });
} else {
  $("audio-note").textContent = "This browser cannot play audio here.";
}

// ---- replay: the sheet after k steps. Step 0 is the empty grid; chords land when their step comes, then notes.
const STEPS = (DATA.setupCall ? [Object.assign({ kind: "setup", step: 0 }, DATA.setupCall)] : []).concat(DATA.trace);
const N = STEPS.length;
const isCall = (s) => !!s.io;
const CALLS = STEPS.filter(isCall);
const MAXMS = Math.max(1, ...CALLS.map((s) => s.latencyMs || 0));
const CHORD_STEP_AT = {};
STEPS.forEach((s, i) => { if (s.kind === "chord") CHORD_STEP_AT[s.bar] = i; });
const HAS_CHORD_STEPS = Object.keys(CHORD_STEP_AT).length > 0;
const chordShown = (bar, kk) => (HAS_CHORD_STEPS ? CHORD_STEP_AT[bar] < kk : true);
const NOTES_BY_BAR = {};
for (const n of DATA.notes) (NOTES_BY_BAR[n.bar] = NOTES_BY_BAR[n.bar] || []).push(n);
let k = N, playing = false, raf = 0, timer = 0, audioReady = true;
const speed = () => Number($("speed").value);
const dwell = (ms) => ms / speed();
$("scrub").max = N; $("scrub").value = N;

// ABC with only the notes up to index upto and only the chords decided by step kk; the rest of every bar is an
// invisible rest, so the grid is always complete.
function buildAbc(upto, kk) {
  let s = DATA.abc.slice(0, HEADER_END);
  const spans = {}, barSpans = {};
  for (const info of DATA.barPlan) {
    const ns = (NOTES_BY_BAR[info.bar] || []).filter((n) => n.index <= upto);
    if (info.bar > 1) s += info.barInPhrase === 1 || (info.bar - 1) % 4 === 0 ? "\\n" : " ";
    let prevHalf = -1, filled = 0;
    ns.forEach((n, i) => {
      const half = Math.floor(n.onset / 4);
      if (i > 0 && half !== prevHalf) s += " ";
      prevHalf = half;
      if (i === 0 && chordShown(info.bar, kk)) s += '"' + info.chord + '"';
      const start = s.length;
      s += DATA.abc.slice(n.abcStart, n.abcEnd);
      spans[n.index] = [start, s.length];
      filled = n.onset + n.e;
    });
    if (filled < 8) {
      const start = s.length;
      s += (ns.length ? " " : chordShown(info.bar, kk) ? '"' + info.chord + '"' : "") + "x" + (8 - filled === 1 ? "" : 8 - filled);
      if (!ns.length) barSpans[info.bar] = [start, s.length];
    }
    s += info.bar === DATA.barPlan.length ? " |]" : " |";
  }
  return { abc: s + "\\n", spans, barSpans };
}
function renderPartial(upto, kk, last) {
  const { abc, spans, barSpans } = buildAbc(upto, kk);
  renderScore(abc);
  const marks = [];
  if (last && last.noteIndices) for (const i of last.noteIndices) if (spans[i]) marks.push(spans[i]);
  if (last && last.kind === "chord" && barSpans[last.bar]) marks.push(barSpans[last.bar]);
  if (!marks.length) return;
  for (const line of visualObj.lines) for (const staff of line.staff || []) for (const voice of staff.voices) for (const el of voice) {
    if (el.el_type !== "note" || !el.abselem) continue;
    // abcjs counts the whitespace before a token as part of it, so test for overlap rather than containment
    if (marks.some(([a, b]) => el.startChar < b && (el.endChar != null ? el.endChar : el.startChar + 1) > a)) for (const g of el.abselem.elemset || []) g.classList.add("new");
  }
}

const phraseOf = (bar) => { const b = DATA.barPlan[bar - 1]; return "phrase " + b.phrase + " (bar " + b.barInPhrase + ")"; };
function whereText(s) {
  if (s.kind === "setup") return "before the first bar";
  const b = DATA.barPlan[s.bar - 1];
  if (s.kind === "chord") return "bar " + s.bar + " · " + phraseOf(s.bar);
  return "bar " + s.bar + (s.kind === "jev" ? ", beat " + s.beat : "") + " · " + b.chord + " (" + b.roman + ") · " + phraseOf(s.bar);
}
const callIndex = (s) => CALLS.indexOf(s) + 1;
const kindCount = (s) => { const same = CALLS.filter((c) => c.kind === s.kind); return same.indexOf(s) + 1 + " of " + same.length; };

function optionBlock(container, name, q, a, s, animate) {
  const block = document.createElement("div");
  const keys = Object.keys(q.criteria);
  block.innerHTML = "<h3>" + name + " · " + keys.length + " option" + (keys.length === 1 ? "" : "s") + "</h3>";
  const probs = (a && a.probabilities) || Object.fromEntries((s.answers && s.answers[name] && s.answers[name].top) || []);
  const entries = Object.entries(probs).sort((x, y) => y[1] - x[1]);
  const pmax = entries.length ? entries[0][1] : 1;
  const pick = (a && a.choice) || (s.answers && s.answers[name] && s.answers[name].choice);
  const fills = [];
  for (const [key, p] of entries) {
    const div = document.createElement("div");
    div.className = "opt" + (key === pick ? " pick" : "");
    div.title = q.criteria[key] || "";
    div.innerHTML = "<b>" + h(key) + '</b><span class="bar"><i></i></span><span>' + pct(p) + "</span><small>#" + (keys.indexOf(key) + 1) + "</small>";
    block.appendChild(div);
    fills.push([div.querySelector("i"), (100 * p) / pmax]);
  }
  container.appendChild(block);
  if (animate) requestAnimationFrame(() => fills.forEach(([i, w]) => { i.style.width = w + "%"; }));
  else fills.forEach(([i, w]) => { i.style.transition = "none"; i.style.width = w + "%"; });
}

// The detail panel for one step (the last completed one).
function detail(s, animate) {
  showPanel(true);
  const opts = $("opts"); opts.innerHTML = "";
  if (isCall(s)) {
    let label, picked, q, pickKey;
    if (s.kind === "setup") { label = "Setup"; picked = Object.entries(s.picks).map(([n, v]) => n + " " + v + (n === "tempo" ? " bpm" : "")).join(", "); }
    else if (s.kind === "chord") { label = "Chord " + kindCount(s) + " · " + whereText(s); picked = s.chord + " (" + s.roman + ")"; q = "chord"; pickKey = s.chord; }
    else { label = "Note " + kindCount(s) + " · " + whereText(s); picked = s.pitch + ", " + LEN[s.length]; q = "next_pitch"; pickKey = s.pitch; }
    $("status").textContent = label + " · call " + callIndex(s) + " of " + CALLS.length + " · Jev answered in " + s.latencyMs + " ms: " + picked +
      " (" + pct(s.confidence) + " sure" + (s.heuristicRank ? ", code's #" + s.heuristicRank + " of " + s.optionCount : "") + (s.source === "fallback" ? "; not an option, so code played its first choice" : "") + ")";
    $("think-fill").style.width = (100 * (s.latencyMs || 0)) / MAXMS + "%"; $("think-ms").textContent = s.latencyMs + " ms";
    const answers = (s.io.response && s.io.response.answers) || {};
    for (const [name, def] of Object.entries(s.io.request.questions)) optionBlock(opts, name, def, answers[name], s, animate);
    const crit = q && s.io.request.questions[q] && s.io.request.questions[q].criteria[pickKey];
    $("facts").textContent = crit ? "What code told Jev about its pick: " + crit : "";
    $("req").textContent = JSON.stringify(s.io.request, null, 1);
    $("res-when").textContent = "· arrived after " + s.latencyMs + " ms";
    typeInto($("res"), JSON.stringify(s.io.response, null, 1), animate ? dwell(450) : 0);
  } else {
    $("status").textContent = "No call · " + whereText(s) + " · " + (s.source === "reuse" || s.kind === "reuse" ? "repeat: " : "code: ") + s.note;
    $("think-fill").style.width = "0%"; $("think-ms").textContent = "0 ms (no call)";
    const why = s.kind === "chord" ? (s.source === "forced" ? "The cadence chord is set by the form; code places it without asking Jev." : "A repeated phrase keeps its model's chords; code copies them without asking Jev.")
      : s.kind === "forced" ? "A forced move: the cadence bar is played by code without asking Jev." : "A repeat: code copies the earlier bar without asking Jev.";
    opts.innerHTML = '<p class="meta">' + why + "</p>";
    $("facts").textContent = ""; $("req").textContent = ""; $("res-when").textContent = ""; typeInto($("res"), "(no call)", 0);
  }
}

// Everything on the page after k steps: sheet, rows, latency strip, stats, detail panel, slider.
function showState(kk, animate) {
  k = Math.max(0, Math.min(N, kk));
  $("scrub").value = k;
  const done = STEPS.slice(0, k), last = done[done.length - 1];
  if (k === N) {
    renderScore(DATA.abc);
    if (!audioReady) { loadAudio(); audioReady = true; }
    $("audio").classList.remove("off"); $("audio").inert = false;
  } else {
    let upto = -1;
    for (const s of done) for (const i of s.noteIndices || []) upto = Math.max(upto, i);
    renderPartial(upto, k, last);
    if (synthControl && audioReady) synthControl.pause();
    audioReady = false; $("audio").classList.add("off"); $("audio").inert = true;
  }
  STEPS.forEach((s, i) => { const row = rowFor(s.step); if (!row || s.kind === "setup") return; row.hidden = i >= k; row.classList.toggle("hl", i === k - 1); });
  const calls = done.filter(isCall);
  const lat = $("lat"); lat.innerHTML = "";
  calls.forEach((s, i) => { const bar = document.createElement("i"); bar.style.height = Math.max(2, (44 * (s.latencyMs || 0)) / MAXMS) + "px"; bar.title = "call " + (i + 1) + " (" + s.kind + "): " + s.latencyMs + " ms"; bar.className = (s.kind === "chord" ? "chord" : "") + (i === calls.length - 1 ? " cur" : ""); lat.appendChild(bar); });
  const ms = calls.reduce((a, s) => a + (s.latencyMs || 0), 0), tokens = calls.reduce((a, s) => a + ((s.usage && s.usage.input) || 0), 0);
  $("stats").textContent = calls.length ? "Calls " + calls.length + "/" + CALLS.length + " · Jev thinking time " + fmtMs(ms) + " · mean " + Math.round(ms / calls.length) + " ms · fastest " + Math.min(...calls.map((s) => s.latencyMs || 0)) + " · slowest " + Math.max(...calls.map((s) => s.latencyMs || 0)) +
    (tokens ? " · " + tokens.toLocaleString() + " input tokens · $" + ((tokens * PRICE) / 1e6).toFixed(4) : " · mock: no tokens") : "";
  if (k === 0) {
    showPanel(false);
    $("status").textContent = "Step 0: code laid out " + DATA.bars + " bars and the phrase plan. " + (HAS_CHORD_STEPS
      ? (DATA.order === "interleaved" ? "Jev decides each bar's chord just before its notes, one bar ahead." : "Jev picks the chords bar by bar, then the notes.")
      : "The chords come from the fixed tables; every note from here is Jev's answer, a cadence rule, or a repeat.");
    $("think-fill").style.width = "0%"; $("think-ms").textContent = "";
  } else {
    detail(last, animate);
    if (k === N && !playing) $("status").textContent += " · Done: " + CALLS.length + " calls, " + fmtMs(ms) + " of Jev thinking time.";
  }
}

function showThinking(s) {
  const what = s.kind === "setup" ? "Setup" : s.kind === "chord" ? "Chord " + kindCount(s) : "Note " + kindCount(s);
  $("status").textContent = what + " · " + whereText(s) + " · asking Jev…";
  $("think-fill").style.width = "0%"; $("think-ms").textContent = "0 ms";
  showPanel(true);
  $("req").textContent = JSON.stringify(s.io.request, null, 1);
  $("res-when").textContent = "· waiting"; typeInto($("res"), "…", 0);
}
function think(ms, done) {
  const start = performance.now(), dur = dwell(ms);
  const tick = (now) => {
    if (!playing) return;
    const p = dur ? Math.min(1, (now - start) / dur) : 1;
    $("think-ms").textContent = Math.round(p * ms) + " ms";
    $("think-fill").style.width = (100 * p * ms) / MAXMS + "%";
    if (p < 1) raf = requestAnimationFrame(tick); else done();
  };
  raf = requestAnimationFrame(tick);
}
function step() {
  if (!playing) return;
  if (k >= N) return stop(true);
  const s = STEPS[k];
  if (isCall(s)) { showThinking(s); think(s.latencyMs || 0, () => { showState(k + 1, true); timer = setTimeout(step, dwell(350)); }); }
  else { showState(k + 1, true); timer = setTimeout(step, dwell(250)); }
}
function stop(finished) {
  playing = false; cancelAnimationFrame(raf); clearTimeout(timer);
  $("pause").disabled = true; $("pause").textContent = "Pause";
  $("replay").textContent = finished ? "Replay again" : "Replay from the start";
  if (finished) showState(N, false);
}
function start() {
  playing = true; $("pause").disabled = false; $("pause").textContent = "Pause"; $("replay").textContent = "Restart";
  step();
}
$("replay").onclick = () => { stop(false); showState(0, false); start(); };
$("pause").onclick = () => {
  if (playing) { playing = false; cancelAnimationFrame(raf); clearTimeout(timer); $("pause").textContent = "Resume"; }
  else if (k < N) { playing = true; $("pause").textContent = "Pause"; step(); }
};
const scrubTo = (kk) => { if (playing) { playing = false; cancelAnimationFrame(raf); clearTimeout(timer); $("pause").textContent = "Resume"; } showState(kk, false); $("pause").disabled = k >= N; };
$("scrub").oninput = (e) => scrubTo(Number(e.target.value));
$("prev").onclick = () => scrubTo(k - 1);
$("next").onclick = () => scrubTo(k + 1);
document.addEventListener("keydown", (e) => { if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return; if (e.key === "ArrowLeft") { scrubTo(k - 1); e.preventDefault(); } if (e.key === "ArrowRight") { scrubTo(k + 1); e.preventDefault(); } });
</script>
</body>
</html>
`;
}
