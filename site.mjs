// Build the GitHub Pages site in docs/: an index with every demo (score, player, facts, link to its replay page),
// the write-up of how it was built, and a copy of each demo page. Reads demos.json and out/<name>.json; no API calls.
import fs from "node:fs";
import path from "node:path";
import { renderPage, esc, pct, embedJson, TRANSPORT_CSS, TRANSPORT_JS, replaySeconds, clock } from "./lib/page.js";
import { toAbc } from "./lib/abc.js";

// Each demo's trace is kept next to its page in docs/demos/<name>.json, so a fresh clone (out/ is git-ignored)
// can rebuild the site. A demo with no trace anywhere stops the build rather than publishing an emptier index.
const manifest = JSON.parse(fs.readFileSync("demos.json", "utf8"));
for (const d of manifest) if (typeof d.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(d.name)) throw new Error(`invalid demo name ${JSON.stringify(d.name)}: letters, digits, - and _ only`);
fs.mkdirSync("docs/demos", { recursive: true });
const traceOf = (name) => [path.join("out", `${name}.json`), path.join("docs/demos", `${name}.json`)].find((f) => fs.existsSync(f));
const missing = manifest.filter((d) => !traceOf(d.name)).map((d) => d.name);
if (missing.length) {
  console.error(`no trace (out/<name>.json or docs/demos/<name>.json) for: ${missing.join(", ")}`);
  if (!process.argv.includes("--partial")) { console.error("refusing to publish an index without them; compose them first, or pass --partial"); process.exit(2); }
}
// The ABC and the per-note spans are recomputed from each trace, never trusted from the file.
const demos = manifest.filter((d) => traceOf(d.name)).map((d) => { const r = JSON.parse(fs.readFileSync(traceOf(d.name), "utf8")); r.abc = toAbc(r); return { ...d, r }; });
fs.writeFileSync("docs/.nojekyll", "");
for (const d of demos) {
  fs.writeFileSync(path.join("docs/demos", `${d.name}.html`), renderPage(d.r, d.r.abc));
  fs.writeFileSync(path.join("docs/demos", `${d.name}.json`), JSON.stringify(d.r, null, 2));
}
const cards = demos.map((d, i) => {
  const r = d.r, st = r.stats;
  const chords = r.barPlan.filter((b) => b.phrase === r.barPlan[0].phrase).map((b) => b.chord).join(" ");
  const chose = r.setupCall ? Object.entries(r.setupCall.picks).map(([q, v]) => `${q} ${v}${q === "tempo" ? " bpm" : ""} (${pct(r.setupCall.answers[q].confidence)})`).join(", ") : null;
  return `
<article class="demo" id="${esc(d.name)}">
  <div class="demo-head">
    <div>
      <span class="tag">${esc(d.tag)}</span>
      <h3>${esc(r.title)}</h3>
      <p class="meta">${esc(r.key)} · ${r.tempo} bpm · ${esc(r.formName)} · ${r.bars} bars, about ${r.seconds} s${r.mood ? ` · mood: “${esc(r.moodPreset ?? r.mood)}”` : ""}</p>
      <p class="blurb">${esc(d.blurb)}</p>
      <p class="meta">${chose ? `Jev chose ${esc(chose)}. ` : ""}First phrase: ${esc(chords)}. ${st.chordCalls ? `${st.chordCalls} chord calls, ` : ""}${st.jevSteps} note calls, ${r.model === "jev-latest" ? "" : "mock, "}about $${st.costUsd.toFixed(4)}; Jev agreed with code's first choice on ${pct(st.agreement)} of notes${st.chordCalls ? ` and ${pct(st.chordAgreement)} of chords` : ""}.</p>
    </div>
    <a class="button" href="demos/${encodeURIComponent(d.name)}.html?replay=1">Watch it being built in Jev's real time · ${clock(replaySeconds(r))} →</a>
  </div>
  <div class="paper" id="paper-${i}"></div>
  <div class="transport"><div class="audio" id="audio-${i}"></div></div>
</article>`;
}).join("\n");

const data = embedJson(demos.map((d) => ({ abc: d.r.abc, seconds: d.r.seconds })));
const index = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Jev, the songwriter</title>
<meta name="description" content="A decision model writes songs: code computes the legal notes, Jev judges which one comes next. Demos with every call replayable.">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/abcjs@6.7.1/abcjs-audio.css" integrity="sha384-eK1u60r2vqfWom2CLxO79qAvQKkjn5j1PjFslU5/+6gScaYuFJ92tkZ1N4z0hXbF" crossorigin="anonymous">
<style>
:root { color-scheme: light dark; --bg: #f7f6f2; --card: #ffffff; --ink: #1d1c1a; --muted: #6b675f; --line: #e4e1da; --accent: #2f6f4e; --accent-soft: #d9ece1; --hl: #f3c969; --chord: #a0522d; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #171614; --card: #201f1c; --ink: #ebe7df; --muted: #a09a8f; --line: #35322d; --accent: #7fc9a0; --accent-soft: #23392d; --hl: #b8892b; --chord: #e0956a; } }
:root[data-theme="dark"] { --bg: #171614; --card: #201f1c; --ink: #ebe7df; --muted: #a09a8f; --line: #35322d; --accent: #7fc9a0; --accent-soft: #23392d; --hl: #b8892b; --chord: #e0956a; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
main { max-width: 980px; margin: 0 auto; padding: 32px 16px 80px; }
h1 { font-size: 40px; line-height: 1.1; margin: 0 0 8px; letter-spacing: -0.02em; }
h2 { font-size: 22px; margin: 48px 0 12px; letter-spacing: -0.01em; }
h3 { font-size: 20px; margin: 4px 0 2px; }
p { margin: 0 0 12px; } .meta { color: var(--muted); font-size: 14px; } .lede { font-size: 19px; color: var(--muted); max-width: 720px; }
.blurb { margin: 6px 0; }
nav { display: flex; gap: 14px; flex-wrap: wrap; margin: 18px 0 8px; font-size: 14px; } nav a { color: var(--accent); }
.demo { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 18px; margin-top: 18px; }
.demo-head { display: flex; gap: 16px; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; }
.tag { display: inline-block; padding: 2px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 12px; font-weight: 600; }
.button { display: inline-block; padding: 8px 14px; border-radius: 10px; background: var(--accent); color: #fff; text-decoration: none; font-weight: 600; white-space: nowrap; }
.paper svg { max-width: 100%; } .paper { margin-top: 8px; }
.paper .abcjs-note.hl, .paper .abcjs-rest.hl, .paper .hl path { fill: var(--hl) !important; stroke: var(--hl) !important; }
.paper .abcjs-cursor { stroke: var(--accent); stroke-width: 2.5; opacity: .85; }
${TRANSPORT_CSS}
.how { max-width: 760px; } .how li { margin-bottom: 8px; }
code, pre { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; } pre { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; overflow-x: auto; }
table { border-collapse: collapse; font-size: 14px; } td, th { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line); } th { color: var(--muted); font-weight: 600; }
footer { margin-top: 56px; color: var(--muted); font-size: 14px; }
a { color: var(--accent); }
</style>
</head>
<body>
<main>
<h1>Jev, the songwriter</h1>
<p class="lede">Jev is TypeSafe AI's decision model. It cannot write a note. Given a state and a list of options it returns one choice with a probability for every option. So we let code do everything that only needs to be legal, and let Jev do the judging: which chord, which note, how long. Every call is recorded, and every song below can be rebuilt on screen call by call, at the speed Jev actually answered.</p>
<nav><a href="#demos">The demos</a><a href="#how">How we built it</a><a href="#found">What we found</a><a href="#run">Run it yourself</a><a href="https://jev-go.chardonn.ai">Beat Jev at Go</a></nav>

<h2 id="demos">The demos</h2>
<p class="meta">Press play on any score; the cursor follows the notes. “Watch it being built in Jev's real time” opens the replay: the empty grid, then the chords landing, then the notes, with Jev's probabilities and raw responses for every call, each taking exactly as long as Jev took (a speed control is there if you want the gist). These were recorded on 22 September 2026 against jev-1.13.0, before the engine gained its rest rule, so a replay can show a rest offered next to a long length; the notes played are the ones Jev chose then.</p>
${cards}

<section class="how">
<h2 id="how">How we built it</h2>
<p><strong>The doctrine, borrowed from <a href="https://jev-go.chardonn.ai">jev-go</a>: code computes, Jev judges.</strong> Jev never generates text or notes. It picks from options that code enumerated, so it cannot write an illegal note, a bar that does not add up, or a chord outside the key. What it can do is prefer.</p>
<ol>
<li><strong>Setup.</strong> Given a mood such as “wistful, late night”, one call asks Jev for the mode (major or minor), the tempo (five bands) and the song form (an 8-bar period, a 16-bar period, AABB, or the classic 32-bar AABA), unless you pinned them. The mood text then rides along in every later call.</li>
<li><strong>Chords, one call per fresh bar.</strong> The options are the seven diatonic triads, plus the seventh chords for jazz and bossa. Each option carries facts computed by code: its quality and harmonic function, the root motion from the previous chord and how many tones they share, how usual the move is in songs, and what it does right before the coming cadence. Cadence chords are set by the form. A repeated phrase keeps its model's chords. In the interleaved variant the chord for a bar is decided just before its notes, one bar ahead, so it can see the melody so far.</li>
<li><strong>Notes, one call per note.</strong> Code offers the scale tones within an octave of the last note, plus a rest, and the lengths that still fit in the bar. Each pitch says what interval it makes, whether it is a chord tone, whether it resolves a leap, whether it is a new high point, how far it is from the cadence note. Each length says where it starts and ends and whether it syncopates. Jev answers both questions in one call.</li>
<li><strong>Forced moves, no call.</strong> The last bar of every phrase holds the closing degree, tonic or dominant. The answering phrase repeats the opening phrase bar for bar except that last bar, and the return repeats the answer. Repetition is what makes sixteen bars of choices sound like a song.</li>
</ol>
<p>Output is real ABC notation, a JSON trace of every request and response, and a page that renders the score with abcjs, plays it with the chords underneath, and replays the whole composition decision by decision.</p>
</section>

<section class="how">
<h2 id="found">What we found</h2>
<ul>
<li><strong>Jev has a preference, and it is consistency.</strong> With the same options in front of it, it favours the chord tone, the same rhythm as the last bar, the same chord as the last bar. That gives motifs for free, and it also gives chains: the first bridge we got was seven whole notes, and Jev's probability for “hold again” climbed from 64% to 94% over three bars even when told the previous bars were held. A jazz bridge later sat on C7 for five bars.</li>
<li><strong>So code got two rules of the game.</strong> A whole note is not offered in the first bar of a phrase or right after a bar that held one note. A chord root is not offered for a third bar in a row. Everything else is Jev's.</li>
<li><strong>Mood reaches the music.</strong> “Wistful, late night” came back minor at 100% confidence and 72 bpm. “Jazz” came back F major at 97% and walked ii–V–I in sevenths. “Bossa nova” split the mode almost evenly, which is fair, and leaned the whole tune on off-beats. Tempo answers are softer, 30% to 70%, so pin the tempo if you care.</li>
<li><strong>Jev is not echoing code's ranking.</strong> Code ranks every option with a one-ply score of its own; Jev's pick was code's first choice between 35% and 80% of the time depending on the tune, and the page shows the rank of every pick.</li>
<li><strong>It is fast and nearly free.</strong> A call takes about 250 ms and about 1,600 input tokens; a 32-bar AABA is 60 to 80 calls, roughly twenty seconds and half a cent.</li>
</ul>
</section>

<section class="how">
<h2 id="run">Run it yourself</h2>
<pre>npm test
npm run compose -- --mood "wistful, late night"          # Jev picks mode, tempo, form, chords, notes
npm run compose -- --mood jazz --key F                    # named moods: jazz, bossa nova (seventh chords)
npm run compose -- --chords "C G Am F" --mood "a bright pop chorus" --tempo 120 --form aaba_32
npm run compose -- --mood "triumphant" --order interleaved
npm run serve                                             # http://localhost:3222</pre>
<p class="meta">Needs Node 22.15+ (for <code>--use-system-ca</code>) and a TypeSafe API key in <code>.dev.vars</code>; without one a seeded mock plays Jev's part so the whole pipeline runs offline. Jev bills input only, $0.042 per million tokens.</p>
</section>

<footer>Built with Claude Code, for fun. Jev is <a href="https://typesafe.ai">TypeSafe AI</a>'s System One decision model; scores and audio by <a href="https://www.abcjs.net">abcjs</a>.</footer>
</main>
<script src="https://cdn.jsdelivr.net/npm/abcjs@6.7.1/dist/abcjs-basic-min.js" integrity="sha384-gO9mym1Z3WJwxNm4ZpC6ZQbMyiu+72akLTHzztpwTs6KYVd3NnfkQigzPk+Oqzqy" crossorigin="anonymous"></script>
<script>
const DEMOS = ${data};
${TRANSPORT_JS}
const controls = [];
DEMOS.forEach((d, i) => {
  const visualObj = ABCJS.renderAbc("paper-" + i, d.abc, { responsive: "resize", add_classes: true })[0];
  if (!ABCJS.synth.supportsAudio()) return;
  const paper = document.getElementById("paper-" + i);
  const cursor = {
    onStart() { controls.forEach((c, j) => { if (j !== i) c.pause(); }); const svg = paper.querySelector("svg"); if (svg && !svg.querySelector(".abcjs-cursor")) { const l = document.createElementNS("http://www.w3.org/2000/svg", "line"); l.setAttribute("class", "abcjs-cursor"); svg.appendChild(l); } },
    onFinished() { paper.querySelectorAll(".hl").forEach((el) => el.classList.remove("hl")); const l = paper.querySelector(".abcjs-cursor"); if (l) l.remove(); },
    onEvent(ev) {
      if (ev.measureStart && ev.left === null) return;
      paper.querySelectorAll(".hl").forEach((el) => el.classList.remove("hl"));
      for (const set of ev.elements || []) for (const el of set) el.classList.add("hl");
      const l = paper.querySelector(".abcjs-cursor");
      if (l && ev.left != null) { l.setAttribute("x1", ev.left - 2); l.setAttribute("x2", ev.left - 2); l.setAttribute("y1", ev.top); l.setAttribute("y2", ev.top + ev.height); }
    },
  };
  const sc = new ABCJS.synth.SynthController();
  sc.load("#audio-" + i, cursor, { displayLoop: true, displayRestart: true, displayPlay: true, displayProgress: true, displayWarp: true });
  addTotal(document.getElementById("audio-" + i), d.seconds);
  sc.setTune(visualObj, false, { chordsOff: false }).catch(() => {});
  controls.push(sc);
});
window.addEventListener("pagehide", () => controls.forEach((c) => c.pause()));
</script>
</body>
</html>
`;
fs.writeFileSync("docs/index.html", index);
console.log(`docs/index.html with ${demos.length} demos; pages in docs/demos/`);
