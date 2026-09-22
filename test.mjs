import { test } from "node:test";
import assert from "node:assert/strict";
import { keyInfo, noteName, parseNote, chordOn, chordRole, degreeOf, scaleTones, ordinal, parseChord, parseProgression } from "./lib/theory.js";
import { FORMS, progression, formBars } from "./lib/form.js";
import { compose, plan, buildRequest, EIGHTHS, RANGE, DURATIONS, TEMPOS, MODE_TEXT } from "./lib/melody.js";
import { buildChordRequest, chordOptions } from "./lib/harmony.js";
import { MOODS, resolveMood } from "./lib/moods.js";
import { toAbc, abcPitch } from "./lib/abc.js";
import { renderPage } from "./lib/page.js";
import { rng, mockChoice, readAnswer, confidenceFrom, cleanProbs } from "./lib/jev.js";
import { resolveFile, safeFile, handler } from "./serve.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const mock = { kind: "mock" };

test("theory: keys, spelling, degrees", () => {
  const c = keyInfo("C", "major");
  assert.equal(c.tonicMidi, 60); assert.equal(c.flats, false); assert.equal(c.abcKey, "C");
  const f = keyInfo("F", "major");
  assert.equal(f.flats, true); assert.equal(noteName(70, f.flats), "Bb4"); assert.equal(f.tonicMidi, 65);
  const a = keyInfo("A", "minor");
  assert.equal(a.tonicMidi, 57); assert.equal(a.abcKey, "Am"); assert.equal(a.name, "A minor");
  assert.equal(parseNote("C#4"), 61); assert.equal(noteName(parseNote("Bb3"), true), "Bb3");
  assert.equal(degreeOf(71, c), 7); assert.equal(degreeOf(70, c), null);
  assert.deepEqual(scaleTones(c, 60, 72), [60, 62, 64, 65, 67, 69, 71, 72]);
  assert.equal(ordinal(1), "1st"); assert.equal(ordinal(2), "2nd"); assert.equal(ordinal(3), "3rd"); assert.equal(ordinal(5), "5th");
  assert.throws(() => keyInfo("Gb", "major"), /six accidentals/);
  assert.throws(() => keyInfo("H", "major"), /unknown key/);
});

test("theory: diatonic triads", () => {
  const c = keyInfo("C", "major");
  assert.deepEqual([chordOn(1, c).symbol, chordOn(2, c).symbol, chordOn(5, c).symbol, chordOn(7, c).symbol], ["C", "Dm", "G", "Bdim"]);
  assert.deepEqual([chordOn(1, c).roman, chordOn(2, c).roman, chordOn(7, c).roman], ["I", "ii", "vii°"]);
  const am = keyInfo("A", "minor");
  assert.equal(chordOn(5, am).symbol, "Em"); assert.equal(chordOn(5, am).roman, "v"); assert.equal(chordOn(6, am).symbol, "F");
});

test("theory: diatonic seventh chords", () => {
  const c = keyInfo("C", "major");
  assert.deepEqual([1, 2, 5, 7].map((d) => chordOn(d, c, true).symbol), ["Cmaj7", "Dm7", "G7", "Bm7b5"]);
  assert.deepEqual([1, 2, 5, 7].map((d) => chordOn(d, c, true).roman), ["Imaj7", "ii7", "V7", "viiø7"]);
  assert.equal(chordRole(71, chordOn(1, c, true)), "seventh"); assert.equal(chordRole(71, chordOn(1, c)), null);
  const am = keyInfo("A", "minor");
  assert.deepEqual([1, 3, 7].map((d) => chordOn(d, am, true).symbol), ["Am7", "Cmaj7", "G7"]);
});

test("moods: named presets resolve and bring seventh chords", async () => {
  assert.equal(resolveMood("Bossa Nova").name, "bossa nova"); assert.equal(resolveMood("a jazz ballad").name, "jazz"); assert.equal(resolveMood("wistful"), null);
  const r = await compose({ key: "F", mode: "major", seed: 6, mood: "bossa" }, mock);
  await check(r);
  assert.equal(r.moodPreset, "bossa nova"); assert.equal(r.sevenths, true); assert.equal(r.mood, MOODS["bossa nova"].text); assert.equal(r.title, "Bossa nova");
  const chordReq = r.trace.find((t) => t.kind === "chord" && t.io).io.request;
  const keys = Object.keys(chordReq.questions.chord.criteria);
  assert.equal(keys.length, 14); assert.ok(keys.includes("Fmaj7") && keys.includes("C7") && keys.includes("Em7b5") && keys.includes("F"));
  assert.match(chordReq.questions.chord.criteria.C7, /dominant seventh.*with its seventh/s);
  assert.match(chordReq.questions.chord.instructions, /bossa nova/);
  const cad = r.barPlan.find((b) => b.isCadence);
  assert.ok(/7$/.test(cad.chord), `cadence chord ${cad.chord} carries its seventh`);
  const plain = await compose({ key: "F", seed: 6, mood: "wistful", sevenths: true }, mock);
  assert.equal(plain.sevenths, true); assert.equal(plain.moodPreset, null);
  const triadsOnly = await compose({ key: "F", seed: 6, mood: "jazz", sevenths: false }, mock);
  assert.equal(triadsOnly.sevenths, false);
});

test("abc: octave marks and durations", () => {
  assert.equal(abcPitch(60, false), "C"); assert.equal(abcPitch(72, false), "c"); assert.equal(abcPitch(84, false), "c'");
  assert.equal(abcPitch(59, false), "B,"); assert.equal(abcPitch(48, false), "C,"); assert.equal(abcPitch(36, false), "C,,"); assert.equal(abcPitch(70, true), "B");
});

test("forms: bars, reuse targets, cadence chords", () => {
  for (const [id, f] of Object.entries(FORMS)) {
    assert.equal(formBars(f), Number(id.split("_")[1]), id);
    const seen = new Set();
    for (const p of f.phrases) { if (p.reuse) assert.ok(seen.has(p.reuse), `${id}: ${p.id} reuses ${p.reuse} before it exists`); seen.add(p.id); }
  }
  assert.deepEqual(progression("A", 4, "half"), [1, 4, 5, 5]);
  assert.deepEqual(progression("A", 4, "full"), [1, 4, 5, 1]);
  assert.equal(progression("B", 8, "half").length, 8);
});

test("plan: structure, and fixed chords on request", () => {
  const key = keyInfo("C", "major");
  const { bars } = plan("aaba_32", key);
  assert.equal(bars.length, 32); assert.equal(bars[0].chord, null); assert.equal(bars[7].isCadence, true); assert.equal(bars[16].phrase.id, "B");
  const fixed = plan("aaba_32", key, "fixed").bars;
  assert.equal(fixed[7].chord.symbol, "G"); assert.equal(fixed[15].chord.symbol, "C"); assert.equal(fixed[16].chord.symbol, "Am");
});

async function check(result) {
  const key = keyInfo(result.key.split(" ")[0], result.mode);
  const lo = key.tonicMidi - RANGE.below, hi = key.tonicMidi + RANGE.above;
  const triads = new Set([1, 2, 3, 4, 5, 6, 7].flatMap((d) => [chordOn(d, key).symbol].concat(result.sevenths ? [chordOn(d, key, true).symbol] : [])));
  const form = FORMS[result.form];
  for (const b of result.barPlan) {
    if (result.chordsMode !== "given") assert.ok(triads.has(b.chord), `bar ${b.bar} chord ${b.chord} is a diatonic triad`);
    const ns = result.notes.filter((n) => n.bar === b.bar).sort((a, c) => a.onset - c.onset);
    assert.equal(ns.reduce((a, n) => a + n.e, 0), EIGHTHS, `bar ${b.bar} fills exactly`);
    let onset = 0;
    for (const n of ns) { assert.equal(n.onset, onset); onset += n.e; }
    if (b.isCadence) {
      const ph = form.phrases.find((p) => p.id === b.phrase);
      assert.equal(ns.length, 1, `cadence bar ${b.bar} is one note`); assert.equal(ns[0].e, EIGHTHS);
      assert.equal(degreeOf(ns[0].midi, key), ph.cadence === "full" ? 1 : 5, `cadence degree in bar ${b.bar}`);
      if (result.chordsMode !== "given") assert.equal(b.chord, chordOn(ph.cadence === "full" ? 1 : 5, key, result.sevenths).symbol, `cadence chord in bar ${b.bar}`);
    }
  }
  assert.notEqual(result.notes[0].midi, null, "does not open with a rest");
  for (let i = 1; i < result.notes.length; i++) assert.ok(!(result.notes[i].midi == null && result.notes[i - 1].midi == null), "no two rests in a row");
  for (const n of result.notes) if (n.midi == null) assert.ok(n.e <= 4, `rest in bar ${n.bar} is no longer than a half note`);
  const pitched = result.notes.filter((n) => n.midi != null);
  for (let i = 1; i < pitched.length; i++) assert.ok(Math.abs(pitched[i].midi - pitched[i - 1].midi) <= 12, "within an octave of the last pitch");
  for (const t of result.trace) if (t.kind === "jev") {
    const q = t.io.request.questions;
    if (q.length && "rest" in q.next_pitch.criteria) for (const k of Object.keys(q.length.criteria)) assert.ok(DURATIONS.find((d) => d.key === k).e <= 4, `bar ${t.bar} beat ${t.beat}: rest offered next to ${k}`);
    assert.ok(t.pitchSource !== "fallback" || t.confidence === 0, "a pitch fallback carries no confidence");
    assert.equal(t.source, t.pitchSource === "jev" && t.lengthSource === "jev" ? "jev" : "fallback");
  }
  for (const t of result.trace) if (t.kind === "chord" && t.io) {
    const cad = /bar (\d+) is (\S+) /.exec(t.io.request.state.position.cadence);
    assert.equal(result.barPlan[Number(cad[1]) - 1].chord, cad[2], `the state's cadence chord for bar ${cad[1]} is the one code places`);
  }
  for (const n of result.notes) if (n.midi != null) { assert.ok(n.midi >= lo && n.midi <= hi, `in range ${n.midi}`); assert.ok(degreeOf(n.midi, key), "diatonic"); }
  for (const ph of form.phrases) if (ph.reuse) {
    const mine = result.barPlan.filter((b) => b.phrase === ph.id), src = result.barPlan.filter((b) => b.phrase === ph.reuse);
    for (let i = 0; i < ph.bars - 1; i++) {
      assert.equal(mine[i].chord, src[i].chord, `${ph.id} bar ${i + 1} keeps the chord of ${ph.reuse}`);
      const a = result.notes.filter((n) => n.bar === mine[i].bar).map((n) => `${n.midi}/${n.e}`), s = result.notes.filter((n) => n.bar === src[i].bar).map((n) => `${n.midi}/${n.e}`);
      assert.deepEqual(a, s, `${ph.id} bar ${i + 1} repeats ${ph.reuse}`);
    }
  }
  const st = result.stats;
  assert.equal(st.calls, st.jevSteps + st.chordCalls + (result.setupCall ? 1 : 0));
  assert.equal(result.trace.length, st.jevSteps + st.forcedSteps + st.reusedBars + st.chordSteps);
  if (result.chordsMode === "jev") assert.equal(st.chordSteps, result.bars, "one chord step per bar");
  else assert.equal(st.chordSteps, 0);
  for (const t of result.trace) if (t.io) {
    assert.ok(t.heuristicRank >= 1 && t.heuristicRank <= t.optionCount);
    if (t.source === "jev") assert.ok((t.kind === "chord" ? t.answers.chord : t.answers.next_pitch).top.length >= 1);
    const q = t.kind === "chord" ? "chord" : "next_pitch", pick = t.kind === "chord" ? t.chord : t.pitch;
    assert.ok(t.io.request.questions[q].criteria[pick] || t.source === "fallback");
  }
}

test("compose: every form on the mock is well formed, chords first", async () => {
  for (const id of Object.keys(FORMS)) {
    const r = await compose({ key: "C", form: id, seed: 3 }, mock);
    assert.equal(r.bars, formBars(FORMS[id]));
    await check(r);
    const firstNote = r.trace.findIndex((t) => t.kind === "jev"), lastChord = r.trace.map((t) => t.kind).lastIndexOf("chord");
    assert.ok(lastChord < firstNote, `${id}: all chords are decided before the first note`);
  }
});

test("compose: interleaved order decides each chord one bar ahead of its notes, after the melody so far", async () => {
  const r = await compose({ key: "G", form: "short_16", seed: 4, order: "interleaved" }, mock);
  await check(r);
  const idx = (pred) => r.trace.findIndex(pred);
  for (const b of r.barPlan.filter((x) => x.phrase === "A" && !x.isCadence)) {
    const firstNote = idx((t) => t.kind === "jev" && t.bar === b.bar);
    assert.ok(idx((t) => t.kind === "chord" && t.bar === b.bar) < firstNote, `chord of bar ${b.bar} before its notes`);
    assert.ok(idx((t) => t.kind === "chord" && t.bar === b.bar + 1) < firstNote, `chord of bar ${b.bar + 1} known before bar ${b.bar}'s notes`);
    if (b.bar > 2) assert.ok(idx((t) => t.kind === "chord" && t.bar === b.bar + 1) > idx((t) => t.kind === "jev" && t.bar === b.bar - 1), `chord of bar ${b.bar + 1} sees bar ${b.bar - 1}'s melody`);
  }
  const chordReq = r.trace.find((t) => t.kind === "chord" && t.bar === 3).io.request;
  assert.ok(chordReq.state.harmony_so_far.length >= 1);
  assert.match(JSON.stringify(chordReq.questions.chord.criteria), /melody's last note|first chord/);
});

test("compose: fixed chords still work and match the tables", async () => {
  const r = await compose({ key: "C", form: "aaba_32", seed: 2, chords: "fixed" }, mock);
  await check(r);
  assert.deepEqual(r.barPlan.slice(0, 8).map((b) => b.chord), ["C", "Am", "F", "G", "C", "F", "G", "G"]);
});

test("chords given: parsed, laid over every phrase, Jev writes only the melody", async () => {
  const c = keyInfo("C", "major");
  assert.deepEqual(parseChord("Am", c).pcs, [9, 0, 4]); assert.equal(parseChord("Am", c).roman, "vi"); assert.equal(parseChord("G7", c).roman, "V7");
  assert.equal(parseChord("Bm7b5", c).roman, "viiø7"); assert.equal(parseChord("D7", c).roman, "II7"); assert.equal(parseChord("Eb", c).roman, "Eb"); assert.equal(parseChord("Eb", c).degree, null);
  assert.equal(parseProgression("C | G - Am, F", c).map((x) => x.symbol).join(" "), "C G Am F");
  assert.throws(() => parseChord("H7", c), /cannot read chord/);
  const r = await compose({ key: "C", form: "aaba_32", seed: 4, chords: "C G Am F" }, mock);
  await check(r);
  assert.equal(r.chordsMode, "given"); assert.equal(r.givenChords, "C G Am F"); assert.equal(r.stats.chordSteps, 0); assert.equal(r.stats.chordCalls, 0);
  assert.deepEqual(r.barPlan.slice(0, 8).map((b) => b.chord), ["C", "G", "Am", "F", "C", "G", "Am", "F"]);
  assert.deepEqual(r.barPlan.slice(16, 24).map((b) => b.chord), ["C", "G", "Am", "F", "C", "G", "Am", "F"], "the bridge gets the same loop from its first bar");
  const noteReq = r.trace.find((t) => t.kind === "jev" && t.bar === 2).io.request;
  assert.equal(noteReq.state.harmony.this_bar, "G (V): G B D");
  const r2 = await compose({ key: "A", mode: "minor", form: "mini_8", seed: 4, chords: "Am E7" }, mock);
  await check(r2);
  assert.deepEqual(r2.barPlan.map((b) => b.chord), ["Am", "E7", "Am", "E7", "Am", "E7", "Am", "E7"]);
  await assert.rejects(compose({ key: "C", chords: "X" }, mock), /cannot read chord/);
});

test("compose: a mood makes Jev pick mode, tempo and form unless pinned", async () => {
  const r = await compose({ key: "D", seed: 8, mood: "wistful, late night" }, mock);
  await check(r);
  assert.ok(r.setupCall); assert.deepEqual(Object.keys(r.setupCall.picks), ["mode", "tempo", "form"]);
  assert.ok(MODE_TEXT[r.mode]); assert.ok(TEMPOS.some((t) => t.bpm === r.tempo)); assert.ok(FORMS[r.form]);
  assert.equal(r.setupCall.io.request.state.piece.mood, "wistful, late night");
  const noteReq = r.trace.find((t) => t.kind === "jev").io.request;
  assert.equal(noteReq.state.piece.mood, "wistful, late night"); assert.match(noteReq.questions.next_pitch.instructions, /wistful/);
  const chordReq = r.trace.find((t) => t.kind === "chord" && t.io).io.request;
  assert.equal(chordReq.state.piece.mood, "wistful, late night"); assert.match(chordReq.questions.chord.instructions, /wistful/);
  const pinned = await compose({ key: "D", seed: 8, mood: "bright and bouncy", tempo: 120, form: "mini_8" }, mock);
  assert.deepEqual(Object.keys(pinned.setupCall.picks), ["mode"]); assert.equal(pinned.tempo, 120); assert.equal(pinned.form, "mini_8");
  const plain = await compose({ key: "D", seed: 8 }, mock);
  assert.equal(plain.setupCall, null); assert.equal(plain.mode, "major"); assert.equal(plain.tempo, 100); assert.equal(plain.form, "aaba_32");
  const auto = await compose({ key: "D", form: "auto", seed: 8 }, mock);
  assert.deepEqual(Object.keys(auto.setupCall.picks), ["form"]);
});

test("compose: other keys, minor mode, tempo, errors", async () => {
  await check(await compose({ key: "Eb", mode: "major", form: "aabb_16", seed: 11, tempo: 132 }, mock));
  await check(await compose({ key: "F#", mode: "minor", form: "short_16", seed: 5 }, mock));
  await assert.rejects(compose({ key: "C", form: "nope" }, mock), /unknown form/);
  await assert.rejects(compose({ key: "C", tempo: 10 }, mock), /tempo/);
  await assert.rejects(compose({ key: "C", order: "sideways" }, mock), /order/);
  await assert.rejects(compose({ key: "C", chords: "maybe" }, mock), /cannot read chord/);
});

test("compose: seeds make it reproducible, and different", async () => {
  const a = await compose({ key: "G", form: "mini_8", seed: 42 }, mock), b = await compose({ key: "G", form: "mini_8", seed: 42 }, mock), c = await compose({ key: "G", form: "mini_8", seed: 43 }, mock);
  assert.equal(toAbc(a), toAbc(b)); assert.notEqual(toAbc(a), toAbc(c));
});

test("abc: header, bar count, spans, and the page", async () => {
  const r = await compose({ key: "F", form: "aabb_16", seed: 2, title: "Test tune", mood: "sunny" }, mock);
  const abc = toAbc(r);
  assert.match(abc, /^X:1\nT:Test tune\nC:.*\nM:4\/4\nL:1\/8\nQ:1\/4=\d+\nK:F\n/);
  const body = abc.slice(abc.indexOf("K:F\n") + 4);
  assert.equal((body.match(/\|/g) || []).length, 16, "one bar line per bar; the last is |]");
  assert.ok(body.endsWith(" |]\n"));
  assert.ok(!/[#^_=]/.test(body), "diatonic notes carry no accidentals");
  let last = -1;
  for (const n of r.notes) { assert.ok(n.abcStart > last && n.abcEnd > n.abcStart); last = n.abcStart; assert.match(abc.slice(n.abcStart, n.abcEnd), /^([A-Ga-gz][,']*)(\d)?$/, "a span is exactly the note token"); }
  const html = renderPage(r, abc);
  assert.ok(html.includes("abcjs-basic-min.js") && html.includes('"abc":') && html.includes("Test tune") && html.includes("sunny"));
  assert.ok(html.includes('has("replay")'), "the page starts the replay when opened with ?replay=1");
});

test("request: the note question Jev expects, and it stays small", () => {
  const key = keyInfo("C", "major");
  const { bars } = plan("short_16", key, "fixed");
  const S = { key, tempo: 100, formId: "short_16", form: FORMS.short_16, planBars: bars, total: 16, range: { lo: key.tonicMidi - RANGE.below, hi: key.tonicMidi + RANGE.above }, notes: [], mood: null };
  const ctx0 = { ...S, barInfo: bars[0], chord: bars[0].chord, onset: 0, rec: { last: null, lastP: null, prevP: null, prevSemis: 0, run: 0, dir: 0, sinceRest: 0, hi: null, lo: null }, phraseNotes: [], cadDeg: 5, cadNext: false };
  const req = buildRequest(ctx0);
  assert.equal(req.questions.next_pitch.type, "choice"); assert.equal(req.questions.length.type, "choice");
  assert.deepEqual(Object.keys(req.questions.next_pitch.criteria), req.pitches.map((o) => o.key));
  assert.ok(!("rest" in req.questions.next_pitch.criteria), "no rest as the first note");
  assert.equal(Object.keys(req.questions.length.criteria).length, DURATIONS.length - 1, "no whole note in a phrase's first bar");
  assert.equal(req.state.position.bar, 1); assert.equal(req.state.harmony.this_bar.split(" ")[0], "C");
  for (const v of Object.values(req.questions.next_pitch.criteria)) assert.ok(v.length > 20 && v.endsWith("."));
  assert.ok(JSON.stringify({ state: req.state, questions: req.questions }).length < 6000, "about a thousand tokens");
});

test("request: the chord question offers the seven triads with facts", () => {
  const key = keyInfo("A", "minor");
  const { bars } = plan("mini_8", key);
  const ctx = { key, tempo: 88, formId: "mini_8", form: FORMS.mini_8, planBars: bars, total: 8, notes: [], mood: "wistful", barInfo: bars[2], prev: chordOn(4, key), barsOnPrev: 1, barsSinceTonic: 1, lastNote: null, cadChord: chordOn(5, key), cadNext: true };
  bars[0].chord = chordOn(1, key); bars[1].chord = chordOn(4, key);
  const req = buildChordRequest(ctx);
  assert.deepEqual(Object.keys(req.questions.chord.criteria).sort(), ["Am", "Bdim", "C", "Dm", "Em", "F", "G"]);
  assert.match(req.questions.chord.instructions, /wistful/);
  assert.equal(req.state.piece.mood, "wistful"); assert.deepEqual(req.state.harmony_so_far, ["bar 1: Am (i)", "bar 2: Dm (iv)"]);
  assert.match(req.questions.chord.criteria.Em, /right before the v cadence|classic preparation|cadence chord itself/);
  assert.match(req.questions.chord.criteria.Dm, /repeats Dm/);
  assert.ok(chordOptions(ctx).every((o) => o.text.endsWith(".")));
});

test("fake backend: unknown answers fall back to code's first choice, long rests are clamped", async () => {
  const fake = { kind: "fake", answer: async (p) => Object.fromEntries(Object.keys(p.questions).map((q) => [q, { type: "choice", choice: "nonsense", probabilities: {} }])) };
  const r = await compose({ key: "C", form: "mini_8", seed: 1, mood: "odd" }, fake);
  await check(r);
  assert.equal(r.stats.fallbacks, r.stats.jevSteps + r.stats.chordCalls);
  assert.equal(r.stats.agreement, null, "no answered notes, no agreement figure"); assert.equal(r.stats.chordAgreement, null); assert.equal(r.stats.meanConfidence, null);
  assert.ok(FORMS[r.form] && TEMPOS.some((t) => t.bpm === r.tempo), "setup fell back to offered options");
  // rests whenever offered, and always the longest length offered: never longer than a half note, by construction
  const longest = (keys) => [...DURATIONS].reverse().find((d) => keys.includes(d.key)).key;
  const rests = { kind: "fake", answer: async (p) => { const out = {}; for (const [q, def] of Object.entries(p.questions)) { const keys = Object.keys(def.criteria); const pick = q === "next_pitch" ? (keys.includes("rest") ? "rest" : keys[0]) : q === "length" ? longest(keys) : keys[0]; out[q] = { type: "choice", choice: pick, probabilities: Object.fromEntries(keys.map((k) => [k, k === pick ? 0.9 : 0.1 / Math.max(1, keys.length - 1)])) }; } return out; } };
  const r2 = await compose({ key: "C", form: "short_16", seed: 1 }, rests);
  await check(r2);
  assert.ok(r2.notes.some((n) => n.midi == null), "the fake did get rests");
  assert.ok(!r2.trace.some((t) => /clamped/.test(t.note || "")), "nothing to clamp any more");
});

test("odd answers: empty or junk distributions, wild confidence, prototype keys, null envelopes", async () => {
  assert.equal(readAnswer({ choice: "G", probabilities: {} }, ["C", "G"]).conf, 0, "an empty distribution is no information");
  const near = (x, y) => Math.abs(x - y) < 1e-9;
  assert.ok(near(readAnswer({ choice: "G", probabilities: { C: 0.2, G: 0.8 }, confidence: 42 }, ["C", "G"]).conf, 0.6), "an out-of-range confidence is ignored, the map decides");
  assert.ok(near(readAnswer({ choice: "G", probabilities: { C: 0.2, G: 0.8 }, confidence: -3 }, ["C", "G"]).conf, 0.6));
  assert.equal(readAnswer({ choice: "G", probabilities: { G: null } }, ["C", "G"]).conf, 0, "null is not a probability");
  assert.doesNotThrow(() => readAnswer({ probabilities: { foreign: { toString: 0 } } }, ["C", "G"]));
  const twelve = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5", "D5", "E5", "F5", "rest"];
  assert.ok(readAnswer({ choice: "C4", probabilities: { Cb4: 0.5, C4: 0.3, Fb4: 0.2 } }, twelve).conf < 0.3, "dropping foreign keys must not inflate confidence");
  assert.ok(near(confidenceFrom({ C4: 0.3 }, 12), (12 * 0.3 - 1) / 11), "the offered count is the denominator");
  assert.throws(() => keyInfo("constructor", "major"), /unknown key/); assert.throws(() => keyInfo("C", "constructor"), /mode must be/);
  assert.equal(readAnswer({ choice: "G", probabilities: { C: 0.2, G: 0.8 }, confidence: Infinity }, ["C", "G"]).conf, readAnswer({ choice: "G", probabilities: { C: 0.2, G: 0.8 } }).conf);
  assert.equal(readAnswer({ choice: "nonsense", probabilities: { C: 0.2, G: 0.8 } }, ["C", "G"]).conf, 0, "a choice that was not offered carries no confidence");
  assert.deepEqual(readAnswer({ choice: "G", probabilities: { C: "high", G: 0.8, "<img src=x onerror=alert(1)>": 0.9 } }, ["C", "G"]).top, [["G", 0.8]], "junk and foreign keys are dropped");
  assert.deepEqual(cleanProbs("abc"), {}); assert.equal(readAnswer(null).choice, null); assert.equal(readAnswer(undefined).conf, 0);
  assert.equal(confidenceFrom({}), 0); assert.equal(confidenceFrom({ a: 1 }), 1); assert.equal(confidenceFrom({ a: NaN, b: "x" }), 0);
  const nulls = { kind: "fake", answer: async () => null };
  const r = await compose({ key: "C", form: "mini_8", seed: 2, mood: "odd" }, nulls);
  await check(r); assert.equal(r.stats.fallbacks, r.stats.jevSteps + r.stats.chordCalls);
  const proto = { kind: "fake", answer: async (p) => Object.fromEntries(Object.keys(p.questions).map((q) => [q, { choice: "constructor", probabilities: {} }])) };
  const r2 = await compose({ key: "C", seed: 2, mood: "odd" }, proto);
  await check(r2); assert.ok(FORMS[r2.form]); assert.ok(MODE_TEXT[r2.mode]);
  const r3 = await compose({ key: "C", seed: 2, form: "auto" }, proto);
  await check(r3); assert.ok(Object.hasOwn(FORMS, r3.form));
  const arrays = { kind: "fake", answer: async (p) => Object.fromEntries(Object.keys(p.questions).map((q) => [q, [1, 2, 3]])) };
  await check(await compose({ key: "G", form: "mini_8", seed: 3 }, arrays));
});

test("answers: a length-only fallback keeps the pitch answer, and setup reads each answer once", async () => {
  const halfbad = { kind: "fake", answer: async (p) => { const out = {}; for (const [q, def] of Object.entries(p.questions)) { const keys = Object.keys(def.criteria); out[q] = q === "length" ? { choice: "nonsense", probabilities: {} } : { choice: keys[0], probabilities: Object.fromEntries(keys.map((k) => [k, k === keys[0] ? 0.9 : 0.1 / (keys.length - 1)])) }; } return out; } };
  const r = await compose({ key: "C", form: "mini_8", seed: 1 }, halfbad);
  await check(r);
  assert.equal(r.stats.agreement, 1, "every pitch answer was code's first choice"); assert.ok(r.stats.meanConfidence > 0.5);
  assert.ok(r.trace.every((t) => t.kind !== "jev" || t.lengthRank == null || t.lengthSource === "fallback" || t.lengthRank >= 1));
  const tempoConf = { kind: "fake", answer: async (p) => Object.fromEntries(Object.entries(p.questions).map(([q, def]) => { const keys = Object.keys(def.criteria); const pick = q === "tempo" ? "fast_140" : keys[0]; return [q, { choice: pick, probabilities: Object.fromEntries(keys.map((k) => [k, k === pick ? 1 : 0])), confidence: q === "tempo" ? 1 : 0 }]; })) };
  const r2 = await compose({ key: "C", form: "mini_8", seed: 1, mood: "x" }, tempoConf);
  assert.equal(r2.setupCall.confidence, 0.5, "mode 0 and tempo 1, each read once"); assert.equal(r2.tempo, 140);
});

test("setup: only modes the key can take, and no paid call before the cheap checks", async () => {
  const eb = await compose({ key: "Eb", seed: 1, form: "mini_8", mood: "sad, dark, lonely" }, mock);
  assert.equal(eb.mode, "major"); assert.ok(!("mode" in (eb.setupCall?.io.request.questions ?? {})), "Eb has one legal mode, so no question");
  const fs_ = await compose({ key: "F#", seed: 1, form: "mini_8", mood: "happy sunny joy" }, mock);
  assert.equal(fs_.mode, "minor");
  let calls = 0;
  const counting = { kind: "fake", answer: async () => { calls++; return {}; } };
  await assert.rejects(compose({ key: "F#", mode: "major", mood: "x" }, counting), /six accidentals/);
  await assert.rejects(compose({ key: "C", tempo: 10, mood: "x" }, counting), /tempo/);
  await assert.rejects(compose({ key: "C", form: "nope", mood: "x" }, counting), /unknown form/);
  await assert.rejects(compose({ key: "C", chords: "Zz Q9", mood: "x" }, counting), /cannot read chord/);
  await assert.rejects(compose({ key: "C", chords: "   ", mood: "x" }, counting), /progression/);
  assert.equal(calls, 0, "nothing was asked before the checks failed");
  const r = await compose({ key: "D", seed: 8, mood: "wistful, late night" }, mock);
  for (const [q, def] of Object.entries(r.setupCall.io.request.questions)) assert.ok(Object.keys(def.criteria).length >= 2, `${q} offers real options`);
  const first = Object.keys(r.setupCall.io.request.questions.tempo.criteria)[0];
  assert.equal(first, "slow_72", "code ranks the options for the mood; a wistful night starts slow");
});

test("theory: unspelled enharmonics are rejected, not silently NaN", () => {
  const c = keyInfo("C", "major");
  for (const sym of ["Cb", "E#", "B#", "Fb", "Cbmaj7"]) assert.throws(() => parseChord(sym, c), /enharmonic/, sym);
  assert.throws(() => parseNote("E#4"), /bad note/);
  assert.deepEqual(parseChord("Bb", c).pcs, [10, 2, 5]);
});

test("abc and page: hostile titles cannot inject header fields or break the page script", async () => {
  const r = await compose({ key: "C", form: "mini_8", seed: 1, title: "Hack\nK:Gb\nw:x\r\nC8 |" }, mock);
  const abc = toAbc(r);
  assert.equal((abc.match(/^K:/gm) || []).length, 1, "one key line"); assert.match(abc, /^T:Hack K:Gb w:x C8 \|$/m);
  assert.equal(abc.split("\n").findIndex((l) => l.startsWith("K:")), 6, "header is X T C M L Q K");
  const r2 = await compose({ key: "C", form: "mini_8", seed: 1, title: "<!--<script></script><img src=x onerror=alert(1)>" }, mock);
  const html = renderPage(r2, toAbc(r2));
  const dataLine = html.split("\n").find((l) => l.startsWith("const DATA = "));
  assert.ok(!/[<>]/.test(dataLine), "no raw angle bracket inside the embedded JSON");
  assert.ok(!html.includes("<!--<script"), "the double-escape trap cannot open");
  assert.ok(html.includes("&lt;!--&lt;script&gt;"), "the title is shown escaped");
  const r3 = await compose({ key: "C", form: "mini_8", seed: 1, mood: "odd\nK:G" }, mock);
  assert.equal((toAbc(r3).match(/^K:/gm) || []).length, 1, "a mood-derived title is sanitised too");
});

test("abc: sharp keys and seventh chords stay well formed", async () => {
  for (const o of [{ key: "F#", mode: "minor" }, { key: "B", mode: "major", mood: "jazz" }, { key: "Eb", mode: "major", mood: "bossa nova" }]) {
    const r = await compose({ ...o, form: "aabb_16", seed: 4 }, mock);
    const abc = toAbc(r), body = abc.slice(abc.indexOf("\nK:") + 1).replace(/^K:.*\n/, "");
    assert.ok(!/[#^_=]/.test(body.replace(/"[^"]*"/g, "")), "accidentals only inside chord symbols");
    for (const n of r.notes) assert.match(abc.slice(n.abcStart, n.abcEnd), /^([A-Ga-gz][,']*)(\d)?$/);
    if (r.sevenths) assert.ok(r.barPlan.some((b) => /7/.test(b.chord)), "sevenths were actually used");
  }
});

test("range: the edges named to Jev are notes of the key, in minor too", async () => {
  const r = await compose({ key: "A", mode: "minor", form: "mini_8", seed: 1 }, mock);
  assert.equal(r.range, "G3–C5");
  const key = keyInfo("A", "minor");
  const [lo, hi] = r.trace.find((t) => t.kind === "jev").io.request.state.piece.range.match(/[A-G][#b]?\d/g);
  assert.ok(degreeOf(parseNote(lo), key) && degreeOf(parseNote(hi), key));
  const c = await compose({ key: "C", form: "mini_8", seed: 1 }, mock);
  assert.equal(c.range, "A3–E5");
});

test("sevenths only where Jev picks the chords; interleaved order works with given chords", async () => {
  const fixed = await compose({ key: "C", form: "mini_8", seed: 1, chords: "fixed", mood: "bossa nova" }, mock);
  assert.equal(fixed.sevenths, false); assert.ok(!renderPage(fixed, toAbc(fixed)).includes("seventh chords in play"));
  const given = await compose({ key: "C", form: "aabb_16", seed: 1, chords: "C G Am F", order: "interleaved", mood: "jazz" }, mock);
  await check(given); assert.equal(given.sevenths, false); assert.equal(given.stats.chordCalls, 0);
  assert.throws(() => renderPage({ ...given, notes: given.notes.map((n) => ({ ...n, abcStart: undefined })) }, given.abc), /toAbc/);
});

test("render: stale spans in a stored trace are recomputed, never trusted", async () => {
  const r = await compose({ key: "F", form: "mini_8", seed: 2, mood: "jazz" }, mock);
  const abc = toAbc(r);
  const stale = JSON.parse(JSON.stringify({ ...r, abc }));
  for (const n of stale.notes) if (n.onset === 0) n.abcStart -= 7; // the old convention: the span swallowed the chord symbol
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jsw-render-"));
  const f = path.join(dir, "t.json");
  fs.writeFileSync(f, JSON.stringify(stale));
  const run = spawnSync(process.execPath, [path.resolve("render.mjs"), f], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const back = JSON.parse(fs.readFileSync(f, "utf8"));
  assert.equal(back.abc, abc);
  for (const n of back.notes) assert.match(abc.slice(n.abcStart, n.abcEnd), /^([A-Ga-gz][,']*)(\d)?$/);
  assert.ok(fs.existsSync(path.join(dir, "t.html")));
  const upper = spawnSync(process.execPath, [path.resolve("render.mjs"), path.join(dir, "t.JSON")], { encoding: "utf8" });
  if (upper.status === 0) assert.doesNotThrow(() => JSON.parse(fs.readFileSync(f, "utf8")), "an uppercase extension never overwrites the trace with HTML"); // case-insensitive filesystems render it
  fs.copyFileSync(f, path.join(dir, "t.trace"));
  const other = spawnSync(process.execPath, [path.resolve("render.mjs"), path.join(dir, "t.trace")], { encoding: "utf8" });
  assert.equal(other.status, 1, "an unmatched extension is refused"); assert.match(other.stderr, /expected a \.json trace/);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(dir, "t.trace"), "utf8")), "and not overwritten");
});

test("serve: only out/ and docs/ files, never the root, dotfiles, siblings or bad escapes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jsw-serve-"));
  const ok = (p) => resolveFile(root, p);
  assert.equal(ok("/.dev.vars"), null); assert.equal(ok("/package.json"), null); assert.equal(ok("/lib/jev.js"), null);
  assert.equal(ok("/out/x.html"), path.join(root, "out", "x.html")); assert.equal(ok("/docs/demos/a.json"), path.join(root, "docs", "demos", "a.json"));
  assert.equal(ok("/out/%2e%2e/.dev.vars"), null); assert.equal(ok("/..%2f" + path.basename(root) + "-sibling%2fx.html"), null);
  assert.equal(ok("/%"), null, "a bad escape is refused, not thrown"); assert.equal(ok("/out/.hidden.html"), null); assert.equal(ok("/out/notes.txt"), null, "unknown types are not served");
  assert.equal(ok("/out/../docs/index.html"), path.join(root, "docs", "index.html"), "normalised paths that stay inside are fine");
  fs.mkdirSync(path.join(root, "out")); fs.writeFileSync(path.join(root, ".dev.vars"), "SECRET"); fs.writeFileSync(path.join(root, "out", "real.json"), "{}");
  fs.symlinkSync(path.join(root, ".dev.vars"), path.join(root, "out", "leak.json"));
  assert.equal(safeFile(root, "/out/leak.json"), null, "a symlink out of the served tree is refused");
  assert.equal(safeFile(root, "/out/real.json"), fs.realpathSync(path.join(root, "out", "real.json")));
  assert.equal(safeFile(root, "/out/none.json"), null);
  fs.symlinkSync(path.join(root, "gone.html"), path.join(root, "out", "dangling.html")); fs.writeFileSync(path.join(root, "out", "good.html"), "<p>");
  let status = 0, body = "";
  const res = { writeHead: (s) => { status = s; }, end: (b) => { body += b; } };
  assert.doesNotThrow(() => handler({ url: "/" }, res, root), "a dangling symlink cannot crash the index");
  assert.equal(status, 200); assert.ok(body.includes("good.html") && !body.includes("dangling"));
  status = 0; body = ""; handler({ url: "/out/leak.json" }, res, root); assert.equal(status, 404);
  status = 0; body = ""; handler({ url: "/%" }, res, root); assert.equal(status, 404);
});

test("site: refuses to publish without every demo's trace; cli: bad arguments fail before any call", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jsw-site-"));
  fs.writeFileSync(path.join(dir, "demos.json"), JSON.stringify([{ name: "missing-demo", tag: "x", blurb: "x" }]));
  const site = path.resolve("site.mjs");
  const r = spawnSync(process.execPath, [site], { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 2); assert.match(r.stderr, /refusing to publish/); assert.ok(!fs.existsSync(path.join(dir, "docs/index.html")));
  const r2 = spawnSync(process.execPath, [site, "--partial"], { cwd: dir, encoding: "utf8" });
  assert.equal(r2.status, 0); assert.ok(fs.existsSync(path.join(dir, "docs/index.html")));
  fs.writeFileSync(path.join(dir, "demos.json"), JSON.stringify([{ name: "../escape", tag: "x", blurb: "x" }]));
  assert.notEqual(spawnSync(process.execPath, [site], { cwd: dir, encoding: "utf8" }).status, 0);
  const cli = path.resolve("compose.mjs"), env = { ...process.env, TYPESAFE_API_KEY: "" };
  for (const [args, re] of [[["--mood"], /needs a value/], [["--seed", "abc"], /--seed/], [["--bogus", "1"], /unknown option/], [["--form", "constructor"], /unknown form/], [["--tempo", "fast"], /--tempo/], [["extra"], /unexpected argument/], [["--key", "H", "--mood", "x"], /unknown key/], [["--mode", "dorian"], /mode must be/], [["--chords", "Zz"], /cannot read chord/]]) {
    const c = spawnSync(process.execPath, [cli, ...args, "--out", dir], { encoding: "utf8", env });
    assert.equal(c.status, 2, args.join(" ")); assert.match(c.stderr, re);
  }
  const outDir = fs.mkdtempSync(path.join(process.cwd(), "out", "test-"));
  try {
    const ok = spawnSync(process.execPath, [cli, "--form", "mini_8", "--seed", "1", "--quiet", "--out", outDir, "--name", "review#1"], { encoding: "utf8", env });
    assert.equal(ok.status, 0, ok.stderr);
    const url = /http:\/\/localhost:3222(\S+)/.exec(ok.stdout)?.[1];
    assert.ok(url && url.includes("review%231") && !url.includes("//"), `the footer URL is servable: ${url}`);
    assert.ok(safeFile(process.cwd(), url), "the server would serve it");
    const elsewhere = spawnSync(process.execPath, [cli, "--form", "mini_8", "--seed", "1", "--quiet", "--out", dir], { encoding: "utf8", env });
    assert.match(elsewhere.stdout, /serves only out\/ and docs\//);
  } finally { fs.rmSync(outDir, { recursive: true, force: true }); }
});

test("rule: a whole note is never offered right after a bar that held one note", async () => {
  const holds = { kind: "fake", answer: async (p) => { const out = {}; for (const [q, def] of Object.entries(p.questions)) { const keys = Object.keys(def.criteria); const pick = q === "length" && keys.includes("whole") ? "whole" : keys.find((k) => k !== "rest"); out[q] = { type: "choice", choice: pick, probabilities: Object.fromEntries(keys.map((k) => [k, k === pick ? 0.9 : 0.1 / Math.max(1, keys.length - 1)])) }; } return out; } };
  const r = await compose({ key: "C", form: "aaba_32", seed: 1 }, holds);
  await check(r);
  const held = (bar) => { const ns = r.notes.filter((n) => n.bar === bar); return ns.length === 1 && ns[0].e === EIGHTHS; };
  let holdsSeen = 0;
  for (const b of r.barPlan) {
    if (b.isCadence) continue;
    if (held(b.bar)) { holdsSeen++; assert.ok(!held(b.bar - 1), `bar ${b.bar} holds right after a held bar`); }
  }
  assert.ok(holdsSeen > 0, "the fake did get to hold some bars");
  for (const t of r.trace) if (t.kind === "jev" && t.beat === "1" && held(t.bar - 1)) assert.ok(!("whole" in t.io.request.questions.length.criteria), `whole offered in bar ${t.bar}`);
});

test("rule: a chord root is never offered for a third bar in a row", async () => {
  // a fake that clings to the previous bar's chord whenever it is offered
  const cling = { kind: "fake", answer: async (p) => { const out = {}; for (const [q, def] of Object.entries(p.questions)) { const keys = Object.keys(def.criteria); let pick = keys[0]; if (q === "chord") { const last = (p.state.recent.last_chord || "").split(" (")[0]; if (keys.includes(last)) pick = last; } out[q] = { type: "choice", choice: pick, probabilities: Object.fromEntries(keys.map((k) => [k, k === pick ? 0.9 : 0.1 / Math.max(1, keys.length - 1)])) }; } return out; } };
  const r = await compose({ key: "C", form: "aaba_32", seed: 1 }, cling);
  await check(r);
  const key = keyInfo("C", "major");
  const deg = (sym) => [1, 2, 3, 4, 5, 6, 7].find((d) => chordOn(d, key).symbol === sym);
  let clung = 0;
  for (const t of r.trace) if (t.kind === "chord" && t.io) {
    const b = t.bar, d = deg(r.barPlan[b - 1].chord);
    if (b >= 3 && deg(r.barPlan[b - 2].chord) === d && deg(r.barPlan[b - 3].chord) === d) assert.fail(`bar ${b} is a third bar in a row on ${t.chord}`);
    if (b >= 2 && deg(r.barPlan[b - 2].chord) === d) clung++;
    if (b >= 3 && deg(r.barPlan[b - 2].chord) === deg(r.barPlan[b - 3].chord)) assert.ok(!Object.keys(t.io.request.questions.chord.criteria).some((k) => deg(k) === deg(r.barPlan[b - 2].chord)), `bar ${b} still offered the clung chord`);
  }
  assert.ok(clung > 0, "the fake did get to repeat a chord once");
});

test("jev helpers: rng, mock sampling, confidence", () => {
  const r1 = rng(9), r2 = rng(9);
  assert.equal(r1(), r2());
  const m = mockChoice({ a: 3, b: 0, c: -3 }, () => 0.01);
  assert.equal(m.choice, "a"); assert.ok(Math.abs(Object.values(m.probabilities).reduce((x, y) => x + y) - 1) < 1e-9);
  assert.equal(readAnswer({ probabilities: { x: 0.2, y: 0.8 } }).choice, "y");
  assert.equal(confidenceFrom({ x: 0.5, y: 0.5 }), 0); assert.equal(confidenceFrom({ x: 1, y: 0 }), 1);
});
