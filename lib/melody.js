// The songwriter. Code builds the grid (form, phrases, bars, cadences), enumerates and annotates every legal
// option, plays the forced moves itself (cadences, repeated phrases), and asks Jev to judge the rest: a setup
// call when a mood is given (mode, tempo, form), one call per fresh bar for its chord, one call per note.
import { keyInfo, noteName, degreeOf, scaleTones, ordinal, intervalName, chordOn, chordRole, parseProgression } from "./theory.js";
import { FORMS, progression, formSeconds, describeForm, formSummary, ROLE_TEXT } from "./form.js";
import { ask, readAnswer, pack, mockChoice, rng, modelFor, PRICE_PER_M_INPUT } from "./jev.js";
import { buildChordRequest, moodHint } from "./harmony.js";
import { resolveMood } from "./moods.js";

export const EIGHTHS = 8; // 4/4, counted in eighths
export const DURATIONS = [
  { key: "eighth", e: 1, short: "e", label: "eighth note, half a beat" },
  { key: "quarter", e: 2, short: "q", label: "quarter note, one beat" },
  { key: "dotted_quarter", e: 3, short: "q.", label: "dotted quarter, a beat and a half" },
  { key: "half", e: 4, short: "h", label: "half note, two beats" },
  { key: "dotted_half", e: 6, short: "h.", label: "dotted half, three beats" },
  { key: "whole", e: 8, short: "w", label: "whole note, the full bar" },
];
const MAX_REST_E = 4;
export const RANGE = { below: 3, above: 16 }; // semitones around the tonic: A3..E5 in C
export const TEMPOS = [
  { key: "slow_72", bpm: 72, text: "72 bpm: slow, a ballad" },
  { key: "easy_88", bpm: 88, text: "88 bpm: relaxed, a stroll" },
  { key: "medium_104", bpm: 104, text: "104 bpm: medium, an easy sing-along" },
  { key: "upbeat_120", bpm: 120, text: "120 bpm: upbeat, a steady dance pulse" },
  { key: "fast_140", bpm: 140, text: "140 bpm: fast, driving" },
];
export const MODE_TEXT = {
  major: "major: bright and open; the default for warm, cheerful or plain-spoken songs",
  minor: "minor: darker and more inward; suits sad, tense, mysterious or dramatic songs",
};
export const ORDERS = ["chords-first", "interleaved"];

export const beatStr = (onset) => `${Math.floor(onset / 2) + 1}${onset % 2 ? "-and" : ""}`;
const beatsText = (e) => (e === 1 ? "half a beat" : e === 2 ? "one beat" : e % 2 ? `${(e - 1) / 2}½ beats` : `${e / 2} beats`);
export const shortDur = (e) => DURATIONS.find((d) => d.e === e)?.short ?? `${e}e`;
export const noteText = (n, flats) => `${n.midi == null ? "z" : noteName(n.midi, flats)}/${shortDur(n.e)}`;
const motionWord = (a) => (a === 0 ? "repeat" : a <= 2 ? "step" : a <= 4 ? "skip" : a < 12 ? "leap" : "octave leap");
const motionText = (semis) => (semis === 0 ? "repeated note" : `${motionWord(Math.abs(semis))} ${semis > 0 ? "up" : "down"} a ${intervalName(semis)}`);

// ---------- the grid ----------
// Structure only: chords are null until the chord phase fills them, unless chordsMode is "fixed" (the hand tables)
// or an array of chords the user gave, which is laid over every phrase from its first bar, cycling if shorter.
export function plan(formId, key, chordsMode = "jev") {
  const form = Object.hasOwn(FORMS, formId) ? FORMS[formId] : null;
  if (!form) throw new Error(`unknown form "${formId}"; one of ${Object.keys(FORMS).join(", ")}, or auto`);
  const bars = [];
  let bar = 1;
  for (const ph of form.phrases) {
    const prog = progression(ph.family, ph.bars, ph.cadence);
    for (let i = 0; i < ph.bars; i++, bar++) {
      const chord = chordsMode === "fixed" ? chordOn(prog[i], key) : Array.isArray(chordsMode) ? chordsMode[i % chordsMode.length] : null;
      bars.push({ bar, phrase: ph, barInPhrase: i + 1, phraseStart: bar - i, chord, isCadence: i === ph.bars - 1 });
    }
  }
  return { form, bars };
}

// ---------- what came before ----------
function recent(notes) {
  const pitched = notes.filter((n) => n.midi != null);
  const last = notes.at(-1) ?? null, lastP = pitched.at(-1) ?? null, prevP = pitched.at(-2) ?? null;
  const prevSemis = lastP && prevP ? lastP.midi - prevP.midi : 0;
  let run = 0, dir = 0;
  for (let i = pitched.length - 1; i > 0; i--) {
    const d = Math.sign(pitched[i].midi - pitched[i - 1].midi);
    if (d === 0) break;
    if (dir === 0) dir = d;
    if (d !== dir) break;
    run++;
  }
  let sinceRest = 0;
  for (let i = notes.length - 1; i >= 0 && notes[i].midi != null; i--) sinceRest++;
  const midis = pitched.map((n) => n.midi);
  return { last, lastP, prevP, prevSemis, run, dir, sinceRest, hi: midis.length ? Math.max(...midis) : null, lo: midis.length ? Math.min(...midis) : null };
}
const nearestOfDegree = (deg, near, key, range) => {
  const c = scaleTones(key, range.lo, range.hi).filter((m) => degreeOf(m, key) === deg);
  c.sort((a, b) => Math.abs(a - near) - Math.abs(b - near) || a - b);
  return c[0];
};

function makeCtx(S, barInfo, onset) {
  const rec = recent(S.notes);
  return {
    ...S, barInfo, chord: barInfo.chord, onset, rec,
    phraseNotes: S.notes.filter((n) => n.bar >= barInfo.phraseStart),
    cadDeg: barInfo.phrase.cadence === "full" ? 1 : 5,
    cadNext: barInfo.barInPhrase === barInfo.phrase.bars - 1,
  };
}
function makeChordCtx(S, barInfo) {
  const before = S.planBars.filter((b) => b.bar < barInfo.bar && b.chord);
  const prev = before.at(-1)?.chord ?? null;
  let barsOnPrev = 0;
  for (let i = before.length - 1; i >= 0 && before[i].chord.degree === prev?.degree; i--) barsOnPrev++;
  let barsSinceTonic = 0;
  for (let i = before.length - 1; i >= 0 && before[i].chord.degree !== 1; i--) barsSinceTonic++;
  const rec = recent(S.notes);
  return {
    ...S, barInfo, prev, barsOnPrev, barsSinceTonic,
    lastNote: rec.lastP ? rec.lastP.midi : null,
    cadChord: chordOn(barInfo.phrase.cadence === "full" ? 1 : 5, S.key, S.sevenths),
    cadNext: barInfo.barInPhrase === barInfo.phrase.bars - 1,
  };
}

// ---------- candidates: facts computed by code ----------
function describePitch(ctx, m) {
  const { key, chord, rec, range, phraseNotes } = ctx;
  const deg = degreeOf(m, key), name = noteName(m, key.flats);
  const parts = [`${name}, ${ordinal(deg)} degree (${key.degreeNames[deg - 1]})`];
  if (!rec.lastP) parts.push("the first note of the piece");
  else {
    const semis = m - rec.lastP.midi, a = Math.abs(semis), dirW = semis > 0 ? "up" : "down", from = noteName(rec.lastP.midi, key.flats);
    parts.push(a === 0 ? `repeats ${from}` : a === 12 ? `octave leap ${dirW} from ${from}` : `${motionWord(a)} ${dirW} from ${from} (${intervalName(a)})`);
    if (Math.abs(rec.prevSemis) >= 5 && a > 0) {
      if (a <= 2 && Math.sign(semis) === -Math.sign(rec.prevSemis)) parts.push("steps back after the leap, resolving it");
      else if (Math.sign(semis) === Math.sign(rec.prevSemis)) parts.push("keeps going in the direction of the leap");
    }
    if (rec.run >= 2 && semis !== 0) {
      const way = rec.dir > 0 ? "upward" : "downward";
      parts.push(Math.sign(semis) === rec.dir ? `extends the ${rec.run + 2}-note run ${way}` : `turns the line around after ${rec.run + 1} notes ${way}`);
    }
    if (rec.prevP && rec.prevP.midi === m && rec.lastP.midi === m) parts.push("would be the third repetition in a row");
  }
  const role = chordRole(m, chord);
  parts.push(role ? `chord tone, the ${role} of ${chord.symbol}` : `not in ${chord.symbol}, a tension against the chord`);
  if (deg === 7 && key.mode === "major") parts.push("the leading tone, pulls up to the tonic");
  if (m === range.hiTone) parts.push("the top of the range");
  else if (m === range.loTone) parts.push("the bottom of the range");
  else if (rec.hi != null && m > rec.hi) parts.push("a new high point for the piece");
  else if (rec.lo != null && m < rec.lo) parts.push("a new low point for the piece");
  if (phraseNotes.length >= 4 && phraseNotes[0].midi === m) parts.push("returns to the note this phrase started on");
  if (ctx.cadNext) {
    const cad = nearestOfDegree(ctx.cadDeg, m, key, range), d = m - cad;
    parts.push(d === 0 ? "the cadence note itself, one bar early" : `a ${intervalName(d)} ${d > 0 ? "above" : "below"} the coming cadence note ${noteName(cad, key.flats)}`);
  }
  return `${parts.join(". ")}.`;
}
function describeRest(ctx) {
  const parts = ["Rest: silence for the chosen length, a breath", `${ctx.rec.sinceRest} notes since the last rest`];
  if (ctx.cadNext) parts.push("the cadence is next bar");
  return `${parts.join(". ")}.`;
}
function describeDuration(ctx, d, left) {
  const parts = [d.label[0].toUpperCase() + d.label.slice(1), `starts on beat ${beatStr(ctx.onset)}`];
  if (d.e === left) parts.push(ctx.onset === 0 ? "fills the whole bar" : "fills the rest of the bar");
  else parts.push(`ends on beat ${beatStr(ctx.onset + d.e)}, leaving ${beatsText(left - d.e)} in the bar`);
  if (ctx.onset % 2 === 1) parts.push(d.e === 1 ? "completes the current beat" : "starts off the beat and crosses the next beat (syncopated)");
  if (ctx.rec.last && ctx.rec.last.e === d.e && ctx.rec.last.source !== "forced") parts.push("same length as the previous note");
  if (left - d.e === 1) parts.push("leaves a lone eighth to end the bar");
  return `${parts.join(". ")}.`;
}
// Was the bar just before this one a single held note? Only asked inside a phrase (a phrase's first bar is
// handled by its own clause), so the bar after a cadence hold never reaches here.
function heldBarBefore(ctx) {
  const ns = ctx.notes.filter((n) => n.bar === ctx.barInfo.bar - 1);
  return ns.length === 1 && ns[0].e === EIGHTHS;
}

// Code's own one-ply opinion. Ranks the pool (so the page can show where Jev's pick landed) and drives the mock.
function scorePitch(ctx, m) {
  const { rec, chord, range, key, onset } = ctx;
  const strong = onset % 4 === 0;
  let s = 0;
  if (rec.lastP) {
    const semis = m - rec.lastP.midi, a = Math.abs(semis);
    s += a === 0 ? 0.4 : a <= 2 ? 2.0 : a <= 4 ? 1.2 : a < 12 ? 0.2 : -0.3;
    if (Math.abs(rec.prevSemis) >= 5 && a > 0) {
      if (a <= 2 && Math.sign(semis) === -Math.sign(rec.prevSemis)) s += 1.2;
      else if (Math.sign(semis) === Math.sign(rec.prevSemis)) s -= 0.8;
    }
    if (rec.run >= 3 && Math.sign(semis) === rec.dir) s -= 0.5;
    if (rec.prevP && rec.prevP.midi === m && rec.lastP.midi === m) s -= 1.5;
  } else {
    s += chordRole(m, chord) ? 1.0 : 0;
    s += Math.abs(m - key.tonicMidi) <= 7 ? 0.5 : 0;
  }
  s += chordRole(m, chord) ? (strong ? 1.5 : 0.6) : strong ? -0.6 : 0;
  if (m === range.hiTone || m === range.loTone) s -= 0.5;
  if (ctx.cadNext) {
    const d = Math.abs(m - nearestOfDegree(ctx.cadDeg, m, key, range));
    s += d <= 2 ? 1.0 : d <= 5 ? 0.4 : -0.5;
  }
  return s;
}
function scoreRest(ctx) {
  let s = -0.8;
  if (ctx.rec.sinceRest >= 6 && ctx.onset % 4 !== 0) s += 1.4;
  if (ctx.cadNext) s -= 0.5;
  return s;
}
function scoreDuration(ctx, d, left) {
  let s = { 1: 1.2, 2: 1.5, 3: 0.4, 4: 0.6, 6: -0.4, 8: -1.0 }[d.e];
  if (ctx.onset % 2 === 1) s += d.e === 1 ? 0.5 : -0.6;
  if (ctx.rec.last && ctx.rec.last.e === d.e && ctx.rec.last.source !== "forced") s += 0.3;
  if (left - d.e === 1) s -= 0.4;
  if (ctx.onset % 4 === 0 && d.e >= 4) s += 0.4;
  const hint = ctx.hint ?? moodHint(ctx.mood);
  if (hint.slow && d.e >= 4) s += 0.4;
  if (hint.fast && d.e <= 2) s += 0.4;
  if (hint.jazzy && ctx.onset % 2 === 1 && d.e >= 2) s += 0.9; // syncopation is the style
  return s;
}

export function pitchOptions(ctx) {
  const { key, range, rec } = ctx;
  let tones = scaleTones(key, range.lo, range.hi);
  if (rec.lastP) tones = tones.filter((m) => Math.abs(m - rec.lastP.midi) <= 12);
  const opts = tones.map((m) => ({ key: noteName(m, key.flats), midi: m, text: describePitch(ctx, m), score: scorePitch(ctx, m) }));
  // A rest is never longer than a half note. Pitch and length are answered in one call, so the rest is only
  // offered when every length on offer fits that cap; otherwise the two answers could combine illegally.
  // By design, then, a rest can only start on beat 2-and or later: no bar and no phrase begins with silence.
  const longLengthOffered = durationOptions(ctx).some((d) => d.e > MAX_REST_E);
  const restAllowed = ctx.notes.length > 0 && rec.last?.midi != null && !longLengthOffered;
  if (restAllowed) opts.push({ key: "rest", midi: null, text: describeRest(ctx), score: scoreRest(ctx) });
  return opts.sort((a, b) => b.score - a.score);
}
// A whole note is not offered in the first bar of a phrase, nor right after a bar that held one note (the
// cadence hold counts). Jev prizes consistency, so a bridge that starts on a hold would otherwise become a
// chain of holds; and a phrase that opens on a hold gets copied to right after a cadence hold.
export function durationOptions(ctx) {
  const left = EIGHTHS - ctx.onset;
  const noHold = ctx.barInfo.barInPhrase === 1 || heldBarBefore(ctx);
  return DURATIONS.filter((d) => d.e <= left && !(d.e === EIGHTHS && noHold))
    .map((d) => ({ key: d.key, e: d.e, text: describeDuration(ctx, d, left), score: scoreDuration(ctx, d, left) }))
    .sort((a, b) => b.score - a.score);
}
const scoresOf = (opts) => Object.fromEntries(opts.map((o) => [o.key, o.score]));

// ---------- the state Jev sees for a note ----------
function renderBars(ctx, fromBar, toBar) {
  const out = [];
  for (let b = fromBar; b <= toBar; b++) {
    const ns = ctx.notes.filter((n) => n.bar === b), info = ctx.planBars[b - 1];
    if (!ns.length && b !== toBar) continue;
    const label = b === toBar ? `bar ${b} (${info.chord.symbol}), so far` : `bar ${b} (${info.chord.symbol})`;
    out.push(`${label}: ${ns.length ? ns.map((n) => noteText(n, ctx.key.flats)).join(" ") : "(nothing yet)"}`);
  }
  return out;
}
export function buildState(ctx) {
  const { key, tempo, formId, planBars, total, range, notes, barInfo, onset, rec, chord, mood } = ctx;
  const ph = barInfo.phrase, start = barInfo.phraseStart, end = start + ph.bars - 1;
  const next = planBars[barInfo.bar]; // planBars is 0-based, bar is 1-based: this is the next bar
  const nn = (m) => noteName(m, key.flats);
  const piece = { key: key.name, meter: "4/4", tempo_bpm: tempo, form: formSummary(formId) };
  if (mood) piece.mood = mood;
  piece.range = `${nn(range.loTone)} to ${nn(range.hiTone)}, scale tones of ${key.name} only`;
  piece.character = "a simple, singable melody with a clear shape";
  return {
    piece,
    position: {
      bar: barInfo.bar, of_bars: total, beat: beatStr(onset),
      beat_strength: onset % 4 === 0 ? "strong" : onset % 2 === 0 ? "medium" : "weak, off the beat",
      eighths_left_in_bar: EIGHTHS - onset,
      phrase: `${ph.id}: ${ROLE_TEXT[ph.role]} (bars ${start}-${end})`,
      bar_in_phrase: `${barInfo.barInPhrase} of ${ph.bars}`,
      bars_until_cadence: ph.bars - barInfo.barInPhrase,
      cadence: `bar ${end} holds the ${key.degreeNames[ctx.cadDeg - 1]} (${ordinal(ctx.cadDeg)} degree) for the whole bar: a ${ph.cadence} cadence`,
    },
    harmony: {
      this_bar: `${chord.symbol} (${chord.roman}): ${chord.tones}`,
      next_bar: next ? (next.chord ? `${next.chord.symbol} (${next.chord.roman}): ${next.chord.tones}` : "not decided yet") : "none, the piece ends",
    },
    melody_so_far: renderBars(ctx, Math.max(1, start - 1), barInfo.bar),
    recent: {
      last_note: rec.last ? (rec.last.midi == null ? `rest, ${beatsText(rec.last.e)}` : `${nn(rec.last.midi)}, ${beatsText(rec.last.e)}`) : "none, this is the first note",
      previous_motion: rec.lastP && rec.prevP ? motionText(rec.prevSemis) : "none",
      direction_run: rec.run >= 2 ? `${rec.run + 1} notes ${rec.dir > 0 ? "upward" : "downward"} in a row` : "none",
      highest_so_far: rec.hi != null ? nn(rec.hi) : "none",
      lowest_so_far: rec.lo != null ? nn(rec.lo) : "none",
      notes_since_rest: rec.sinceRest,
      notes_in_this_bar: notes.filter((n) => n.bar === barInfo.bar).length,
    },
  };
}

export function buildRequest(ctx) {
  const pitches = pitchOptions(ctx), durs = durationOptions(ctx);
  const mood = ctx.mood ? ` for a song whose mood is "${ctx.mood}"` : "";
  const questions = {
    next_pitch: {
      type: "choice",
      instructions:
        `The pitch a good songwriter would write next in this ${ctx.key.name} melody${mood}: singable, shaped by what came ` +
        `before, fitting this bar's chord (${ctx.chord.symbol}), and heading for the cadence described in the state. ` +
        `Each option lists facts computed by code.`,
      criteria: Object.fromEntries(pitches.map((o) => [o.key, o.text])),
    },
  };
  if (durs.length > 1) {
    questions.length = {
      type: "choice",
      instructions: `How long the next note should last${mood}, given the beat it starts on and the rhythm so far. Only lengths that fit in the bar are offered.`,
      criteria: Object.fromEntries(durs.map((o) => [o.key, o.text])),
    };
  }
  return { state: buildState(ctx), questions, pitches, durs };
}

async function noteStep(ctx, be, rand) {
  const { state, questions, pitches, durs } = buildRequest(ctx);
  const call = await ask(be, state, questions, () => {
    const out = { next_pitch: mockChoice(scoresOf(pitches), rand) };
    if (durs.length > 1) out.length = mockChoice(scoresOf(durs), rand);
    return out;
  });
  // Two questions, two verdicts: the pitch answer carries the rank and the confidence, the length answer only
  // its own rank. `source` is "fallback" if either was unusable; the stats count steps whose pitch was answered.
  const pa = readAnswer(call.answers.next_pitch, pitches.map((o) => o.key));
  let pick = pitches.find((o) => o.key === pa.choice), pitchSource = "jev", lengthSource = "jev";
  if (!pick) { pick = pitches[0]; pitchSource = "fallback"; }
  let dur = durs[0], la = null, lengthRank = null;
  const note = durs.length === 1 ? "only one length fits the bar" : null;
  if (durs.length > 1) {
    la = readAnswer(call.answers.length, durs.map((o) => o.key));
    dur = durs.find((o) => o.key === la.choice);
    if (!dur) { dur = durs[0]; lengthSource = "fallback"; }
    lengthRank = durs.indexOf(dur) + 1;
  }
  const e = dur.e;
  return {
    midi: pick.midi, e, pitchKey: pick.key, lengthKey: DURATIONS.find((d) => d.e === e).key, note,
    source: pitchSource === "jev" && lengthSource === "jev" ? "jev" : "fallback", pitchSource, lengthSource,
    answers: { next_pitch: pack(pa), length: la ? pack(la) : null },
    heuristicRank: pitches.indexOf(pick) + 1, lengthRank, optionCount: pitches.length, confidence: pitchSource === "jev" ? pa.conf : 0, call,
  };
}

async function chordStep(ctx, be, rand) {
  const { state, questions, options } = buildChordRequest(ctx);
  const call = await ask(be, state, questions, () => ({ chord: mockChoice(scoresOf(options), rand) }));
  const a = readAnswer(call.answers.chord, options.map((o) => o.key));
  let pick = options.find((o) => o.key === a.choice), source = "jev";
  if (!pick) { pick = options[0]; source = "fallback"; }
  return { chord: pick.chord, source, answers: { chord: pack(a) }, heuristicRank: options.indexOf(pick) + 1, optionCount: options.length, confidence: a.conf, call };
}

// ---------- setup: with a mood, Jev picks whatever the user did not pin (mode, tempo, form) ----------
// `modes` are the modes the key can take (six-accidental keys allow only one). Option lists are ordered by
// code's own preference for the mood, so the first key of each question is code's pick and the fallback.
async function setup(opts, be, rand, tally, modes, hint) {
  const mood = opts.mood || null;
  const questions = {};
  const ranked = (scores) => Object.keys(scores).sort((a, b) => scores[b] - scores[a]);
  const scores = {
    mode: { major: hint.bright ? 1.5 : hint.dark ? -0.5 : 0.5, minor: hint.dark ? 1.5 : hint.bright ? -0.5 : 0 },
    tempo: Object.fromEntries(TEMPOS.map((t, i) => [t.key, hint.slow ? 2 - i : hint.fast ? i - 2 : -Math.abs(i - 2)])),
    form: { mini_8: 0.6, short_16: 1.0, aabb_16: 1.2, aaba_32: 1.4 },
  };
  if (opts.mode == null && mood && modes.length > 1) {
    questions.mode = { type: "choice", instructions: `The mode for a song whose mood is "${mood}".`, criteria: Object.fromEntries(ranked(scores.mode).filter((m) => modes.includes(m)).map((m) => [m, MODE_TEXT[m]])) };
  }
  if (opts.tempo == null && mood) {
    questions.tempo = { type: "choice", instructions: `The tempo for a song whose mood is "${mood}". Each option states the pulse.`, criteria: Object.fromEntries(ranked(scores.tempo).map((k) => [k, TEMPOS.find((t) => t.key === k).text])) };
  }
  if (opts.form === "auto" || (opts.form == null && mood)) {
    const at = Number(opts.tempo ?? 100);
    questions.form = { type: "choice", instructions: `The song form to write${mood ? ` for the mood "${mood}"` : ""}. Each option states its length and structure.`, criteria: Object.fromEntries(ranked(scores.form).map((id) => [id, describeForm(id, at)])) };
  }
  const given = { mode: opts.mode ?? (modes.includes("major") ? "major" : modes[0]), tempo: Number(opts.tempo ?? 100), formId: opts.form && opts.form !== "auto" ? opts.form : "aaba_32" };
  if (!Object.keys(questions).length) return { ...given, setupCall: null };
  const piece = { key: opts.key ?? "C", meter: "4/4", purpose: "a short instrumental melody written for fun; the listener hears it once" };
  if (mood) piece.mood = mood;
  const pinned = {};
  if (opts.mode != null) pinned.mode = opts.mode;
  if (opts.tempo != null) pinned.tempo_bpm = Number(opts.tempo);
  if (opts.form && opts.form !== "auto") pinned.form = opts.form;
  const state = { piece, pinned_by_the_user: Object.keys(pinned).length ? pinned : "nothing" };
  const mock = () => Object.fromEntries(Object.entries(questions).map(([q, def]) => [q, mockChoice(Object.fromEntries(Object.keys(def.criteria).map((k) => [k, scores[q][k]])), rand)]));
  const call = await ask(be, state, questions, mock);
  tally(call);
  const picks = {}, answers = {}, confs = [];
  let { mode, tempo, formId } = given;
  const read = (q) => {
    const keys = Object.keys(questions[q].criteria);
    const a = readAnswer(call.answers[q], keys);
    answers[q] = pack(a); confs.push(a.conf);
    return keys.includes(a.choice) ? a.choice : keys[0];
  };
  if (questions.mode) { mode = read("mode"); picks.mode = mode; }
  if (questions.tempo) { const tempoKey = read("tempo"); tempo = TEMPOS.find((t) => t.key === tempoKey).bpm; picks.tempo = tempo; }
  if (questions.form) { formId = read("form"); picks.form = formId; }
  return { mode, tempo, formId, setupCall: { picks, answers, confidence: confs.reduce((x, y) => x + y, 0) / confs.length, latencyMs: call.latencyMs, usage: call.usage, model: call.model, io: call.io } };
}

// ---------- compose ----------
export async function compose(opts = {}, be, onStep = () => {}) {
  const seed = Number(opts.seed ?? 1);
  const rand = rng(seed);
  const chordsArg = opts.chords ?? "jev";
  const chordsMode = chordsArg === "jev" || chordsArg === "fixed" ? chordsArg : "given";
  const order = opts.order ?? "chords-first";
  if (!ORDERS.includes(order)) throw new Error(`order must be one of ${ORDERS.join(", ")}, got "${order}"`);
  const stats = { calls: 0, inputTokens: 0, outputTokens: 0, ms: 0 };
  const tally = (r) => { stats.calls++; stats.inputTokens += r.usage?.input ?? 0; stats.outputTokens += r.usage?.output ?? 0; stats.ms += r.latencyMs; };

  const preset = resolveMood(opts.mood);
  const mood = preset ? preset.text : opts.mood ? String(opts.mood) : null;
  const hint = moodHint(mood);
  // Seventh chords only matter where Jev picks the chords; fixed or given progressions are played as written.
  const sevenths = chordsMode === "jev" && (opts.sevenths != null ? !!opts.sevenths : !!preset?.sevenths);
  // Everything that can be checked before a paid call is checked here: the key, a pinned mode, the tempo, the form.
  const keyName = opts.key ?? "C";
  const modes = Object.keys(MODE_TEXT).filter((m) => { try { keyInfo(keyName, m); return true; } catch { return false; } });
  if (!modes.length || (opts.mode != null && !modes.includes(opts.mode))) keyInfo(keyName, opts.mode ?? "major"); // throws with the real reason
  if (opts.tempo != null && !(Number(opts.tempo) >= 40 && Number(opts.tempo) <= 240)) throw new Error(`tempo must be 40..240 bpm, got ${opts.tempo}`);
  if (opts.form && opts.form !== "auto" && !Object.hasOwn(FORMS, opts.form)) throw new Error(`unknown form "${opts.form}"; one of ${Object.keys(FORMS).join(", ")}, or auto`);
  // The chord grammar does not depend on the key, so a typo in a given progression is caught here too.
  if (chordsMode === "given" && !parseProgression(chordsArg, keyInfo(keyName, modes[0])).length) throw new Error(`chords must be jev, fixed, or a progression like "C G Am F"`);
  const { mode, tempo, formId, setupCall } = await setup({ ...opts, mood }, be, rand, tally, modes, hint);
  if (!(tempo >= 40 && tempo <= 240)) throw new Error(`tempo must be 40..240 bpm, got ${opts.tempo}`);
  const key = keyInfo(keyName, mode);
  const given = chordsMode === "given" ? parseProgression(chordsArg, key) : null;
  if (given && !given.length) throw new Error(`chords must be jev, fixed, or a progression like "C G Am F"`);
  const lo = key.tonicMidi - RANGE.below, hi = key.tonicMidi + RANGE.above, inKey = scaleTones(key, lo, hi);
  const range = { lo, hi, loTone: inKey[0], hiTone: inKey.at(-1) }; // the edges named to Jev are notes it can be offered
  const { form, bars: planBars } = plan(formId, key, given ?? chordsMode);
  const total = planBars.length;
  const notes = [], trace = [];
  const S = { key, tempo, formId, form, planBars, total, range, notes, mood, hint, sevenths };
  const push = (n) => { n.index = notes.length; notes.push(n); return n; };
  const record = (t) => { t.step = trace.length + 1; trace.push(t); onStep(t); return t; };
  const phraseBars = (ph) => planBars.filter((b) => b.phrase === ph);
  const sourceOf = (ph) => form.phrases.find((p) => p.id === ph.reuse);

  // The chord of one bar: Jev's call for a fresh bar, a copy for a repeated phrase, the form's chord for a cadence bar.
  async function chordFor(b) {
    if (b.chord) return;
    const ph = b.phrase;
    if (b.isCadence) {
      b.chord = chordOn(ph.cadence === "full" ? 1 : 5, key, sevenths);
      record({ kind: "chord", source: "forced", bar: b.bar, chord: b.chord.symbol, roman: b.chord.roman, note: `${ph.cadence} cadence: ${b.chord.symbol} (${b.chord.roman}), set by the form` });
    } else if (ph.reuse) {
      const from = phraseBars(sourceOf(ph))[b.barInPhrase - 1];
      await chordFor(from);
      b.chord = from.chord;
      record({ kind: "chord", source: "reuse", bar: b.bar, chord: b.chord.symbol, roman: b.chord.roman, note: `bar ${b.bar} takes the chord of bar ${from.bar}: phrase ${ph.id} repeats ${sourceOf(ph).id}` });
    } else {
      const r = await chordStep(makeChordCtx(S, b), be, rand);
      tally(r.call);
      b.chord = r.chord;
      record({ kind: "chord", source: r.source, bar: b.bar, chord: b.chord.symbol, roman: b.chord.roman, answers: r.answers, heuristicRank: r.heuristicRank, optionCount: r.optionCount, confidence: r.confidence, latencyMs: r.call.latencyMs, usage: r.call.usage, model: r.call.model, io: r.call.io, note: null });
    }
  }
  if (chordsMode === "jev" && order === "chords-first") for (const b of planBars) await chordFor(b);

  for (const ph of form.phrases) {
    const phBars = phraseBars(ph);
    if (ph.reuse) {
      for (const b of phBars) await chordFor(b);
      const srcBars = phraseBars(sourceOf(ph));
      for (let i = 0; i < ph.bars - 1; i++) {
        const from = srcBars[i], to = phBars[i];
        const copied = notes.filter((n) => n.bar === from.bar).map((n) => ({ midi: n.midi, e: n.e, bar: to.bar, onset: n.onset, source: "reuse", traceIndex: trace.length }));
        copied.forEach(push);
        record({ kind: "reuse", bar: to.bar, beat: "1", onset: 0, pitch: null, length: null, eighths: EIGHTHS, note: `bar ${to.bar} repeats bar ${from.bar}: phrase ${ph.id} repeats ${src(ph)}`, noteIndices: copied.map((c) => c.index) });
      }
    } else {
      for (const b of phBars.slice(0, -1)) {
        // Interleaved: decide this bar's chord (seeing the melody so far) and keep one bar of harmony ahead.
        await chordFor(b);
        if (planBars[b.bar]) await chordFor(planBars[b.bar]);
        let onset = 0;
        while (onset < EIGHTHS) {
          const r = await noteStep(makeCtx(S, b, onset), be, rand);
          tally(r.call);
          const n = push({ midi: r.midi, e: r.e, bar: b.bar, onset, source: r.source, traceIndex: trace.length });
          record({
            kind: "jev", bar: b.bar, beat: beatStr(onset), onset, pitch: r.pitchKey, length: r.lengthKey, eighths: r.e, note: r.note, source: r.source, pitchSource: r.pitchSource, lengthSource: r.lengthSource,
            answers: r.answers, heuristicRank: r.heuristicRank, lengthRank: r.lengthRank, optionCount: r.optionCount, confidence: r.confidence,
            latencyMs: r.call.latencyMs, usage: r.call.usage, model: r.call.model, noteIndices: [n.index], io: r.call.io,
          });
          onset += r.e;
        }
      }
    }
    // The cadence bar is forced: the phrase's closing degree, held for the bar, in the octave nearest the last note.
    const cb = phBars.at(-1);
    await chordFor(cb);
    const rec = recent(notes), deg = ph.cadence === "full" ? 1 : 5;
    const midi = nearestOfDegree(deg, rec.lastP ? rec.lastP.midi : key.tonicMidi, key, range);
    const n = push({ midi, e: EIGHTHS, bar: cb.bar, onset: 0, source: "forced", traceIndex: trace.length });
    record({ kind: "forced", bar: cb.bar, beat: "1", onset: 0, pitch: noteName(midi, key.flats), length: "whole", eighths: EIGHTHS, note: `${ph.cadence} cadence: ${noteName(midi, key.flats)}, the ${key.degreeNames[deg - 1]}, held for the bar`, noteIndices: [n.index] });
  }
  function src(ph) { return sourceOf(ph).id; }

  const jev = trace.filter((t) => t.kind === "jev"), chords = trace.filter((t) => t.kind === "chord" && t.io);
  // Agreement and confidence describe pitch (or chord) answers Jev actually gave; a length-only fallback still
  // leaves a pitch answer to count. Fallbacks are counted separately.
  const answered = (ts) => ts.filter((t) => (t.pitchSource ?? t.source) === "jev");
  const rate = (ts) => (answered(ts).length ? answered(ts).filter((t) => t.heuristicRank === 1).length / answered(ts).length : null);
  const moodLabel = preset ? preset.name : mood;
  const title = opts.title != null ? String(opts.title) : moodLabel ? `${moodLabel[0].toUpperCase()}${moodLabel.slice(1)}` : `Jev in ${key.name}`;
  return {
    title, key: key.name, abcKey: key.abcKey, flats: key.flats, mode: key.mode, tempo, seed, mood, moodPreset: preset?.name ?? null, sevenths, chordsMode, order,
    givenChords: given ? given.map((c) => c.symbol).join(" ") : null,
    form: formId, formName: form.name, formLabel: form.label, bars: total, seconds: formSeconds(form, tempo),
    range: `${noteName(range.loTone, key.flats)}–${noteName(range.hiTone, key.flats)}`,
    model: modelFor(be), backend: be.kind, createdAt: new Date().toISOString(),
    barPlan: planBars.map((b) => ({ bar: b.bar, phrase: b.phrase.id, role: b.phrase.role, barInPhrase: b.barInPhrase, chord: b.chord.symbol, roman: b.chord.roman, isCadence: b.isCadence })),
    notes, trace, setupCall,
    stats: {
      ...stats, costUsd: (stats.inputTokens * PRICE_PER_M_INPUT) / 1e6,
      jevSteps: jev.length, chordCalls: chords.length, chordSteps: trace.filter((t) => t.kind === "chord").length,
      forcedSteps: trace.filter((t) => t.kind === "forced").length, reusedBars: trace.filter((t) => t.kind === "reuse").length,
      fallbacks: jev.filter((t) => t.source === "fallback").length + chords.filter((t) => t.source === "fallback").length,
      agreement: rate(jev),
      chordAgreement: rate(chords),
      meanConfidence: answered(jev).length ? answered(jev).reduce((a, t) => a + t.confidence, 0) / answered(jev).length : null,
    },
  };
}
