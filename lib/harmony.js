// Chords as decisions. The options are the seven diatonic triads of the key, each annotated with facts computed by
// code: quality, harmonic function, motion from the previous chord, common tones, how usual the move is in songs,
// and what it does right before the coming cadence. Code's own score ranks the pool and drives the mock.
import { chordOn, chordRole, noteName, KIND_TEXT } from "./theory.js";
import { ROLE_TEXT, formSummary } from "./form.js";

const FUNCTION = {
  major: {
    1: ["tonic", "home, rest"], 2: ["predominant", "moves away from home and leads to V"], 3: ["tonic colour", "a softer shade of home"],
    4: ["predominant", "moves away from home, leads to V or back to I"], 5: ["dominant", "tension that wants to resolve to I"],
    6: ["relative minor", "home's darker twin"], 7: ["leading-tone chord", "tense, usually passes to I"],
  },
  minor: {
    1: ["tonic", "home, rest"], 2: ["predominant, diminished", "tense, leads to v"], 3: ["relative major", "home's brighter twin"],
    4: ["predominant", "moves away from home, leads to v or VII"], 5: ["minor dominant", "a soft pull back to i"],
    6: ["submediant", "warm, often before VII or iv"], 7: ["subtonic", "a modal pull back to i"],
  },
};
// Moves songs make all the time, by degree. Anything else is "less usual".
const COMMON = {
  major: { 1: [4, 5, 6, 2], 2: [5, 4], 3: [6, 4], 4: [5, 1, 2, 6], 5: [1, 6, 4], 6: [4, 2, 5], 7: [1] },
  minor: { 1: [6, 4, 7, 3, 5], 2: [5, 1], 3: [7, 4, 6], 4: [5, 7, 1], 5: [1, 6], 6: [7, 4, 3], 7: [1, 3, 6] },
};
const VERY = {
  major: new Set(["1>4", "1>5", "4>5", "5>1", "6>4", "2>5", "1>6", "4>1"]),
  minor: new Set(["1>6", "6>7", "7>1", "1>4", "4>5", "5>1", "1>7", "3>7"]),
};
const MOTION = ["repeats", "root steps up a 2nd", "root rises a 3rd", "root falls a 5th (rises a 4th), the strongest pull", "root rises a 5th (falls a 4th)", "root falls a 3rd", "root steps down a 2nd"];
const brightness = (q) => (q === "major" ? "bright" : q === "minor" ? "darker" : "tense and unstable");
const commonTones = (a, b) => a.pcs.filter((p) => b.pcs.includes(p)).length;
const usual = (mode, p, d) => (VERY[mode].has(`${p}>${d}`) ? "a very common move" : COMMON[mode][p].includes(d) ? "a common move" : "a less usual move");

export function describeChord(ctx, ch) {
  const { key, prev, cadNext, cadChord, barsSinceTonic } = ctx;
  const [fn, fnText] = FUNCTION[key.mode][ch.degree];
  const parts = [`${ch.symbol} (${ch.roman}), ${KIND_TEXT[ch.kind]}, ${fn}: ${fnText}`];
  if (ctx.sevenths) parts.push(ch.seventh ? "with its seventh: a richer, jazz and bossa colour" : "a plain triad");
  if (!prev) parts.push(ch.degree === 1 ? "the first chord of the piece; starting on the tonic states the key" : "the first chord of the piece; starting away from the tonic leaves the key open");
  else {
    const m = (ch.degree - prev.degree + 7) % 7, ct = commonTones(prev, ch);
    if (m === 0) parts.push(ch.symbol === prev.symbol ? `repeats ${prev.symbol}${ctx.barsOnPrev >= 2 ? ` for a ${ctx.barsOnPrev + 1}th bar` : ""}` : `keeps the root of ${prev.symbol}, recoloured as ${ch.symbol}`);
    else parts.push(`${MOTION[m]} from ${prev.symbol}, ${ct} common tone${ct === 1 ? "" : "s"}`, `${usual(key.mode, prev.degree, ch.degree)} (${prev.roman} to ${ch.roman})`);
  }
  if (cadNext) {
    const c = cadChord.degree, d = ch.degree;
    parts.push(
      d === c ? "the cadence chord itself, one bar early: the cadence would arrive as a repeat"
        : c === 5 && (d === 2 || d === 4) ? `a predominant right before the ${cadChord.roman} cadence: the classic preparation`
        : c === 1 && d === 5 ? `the dominant right before the ${cadChord.roman} cadence: the classic preparation`
        : c === 1 && d === 4 ? `${ch.roman} right before ${cadChord.roman}: a plagal, gentle close`
        : c === 1 && d === 7 ? `the leading-tone chord before ${cadChord.roman}: tense, resolving`
        : "does not prepare the coming cadence chord",
    );
  }
  if (ch.degree === 1 && barsSinceTonic >= 3) parts.push(`returns home after ${barsSinceTonic} bars away`);
  if (ctx.lastNote != null) {
    const role = chordRole(ctx.lastNote, ch), nn = noteName(ctx.lastNote, key.flats);
    parts.push(role ? `the melody's last note ${nn} is its ${role}` : `the melody's last note ${nn} is not in it`);
  }
  if (ch.quality === "dim") parts.push("rarely a resting chord in a song");
  parts.push(brightness(ch.quality));
  return `${parts.join(". ")}.`;
}

// Words in the mood that a stand-in can act on. Jev reads the mood itself; this only serves the mock and the rank.
export const moodHint = (mood = "") => ({
  dark: /sad|dark|melanch|wistful|lonely|night|rain|blue|grief|longing|tense|mystery|minor/i.test(mood),
  jazzy: /jazz|bossa|swing|blues|lounge|smooth/i.test(mood),
  bright: /happy|bright|joy|sunny|cheer|dance|party|playful|warm|hope|major/i.test(mood),
  slow: /slow|ballad|calm|quiet|sleep|lullaby|night|wistful|sad|tender|dream/i.test(mood),
  fast: /fast|dance|party|drive|energy|run|bounce|upbeat|excit/i.test(mood),
});

export function scoreChord(ctx, ch) {
  const { key, prev, cadNext, cadChord } = ctx;
  const d = ch.degree;
  let s = 0;
  if (!prev) s += d === 1 ? 3 : d === 6 || d === 4 ? 0.5 : 0;
  else if (d === prev.degree) s -= ctx.barsOnPrev >= 2 ? 1.5 : 0.6;
  else if (VERY[key.mode].has(`${prev.degree}>${d}`)) s += 2.0;
  else if (COMMON[key.mode][prev.degree].includes(d)) s += 1.3;
  else s -= 0.4;
  if (ch.quality === "dim") s -= 1.2;
  if (cadNext) {
    const c = cadChord.degree;
    if (d === c) s -= 0.5;
    else if (c === 5 && (d === 2 || d === 4)) s += 1.5;
    else if (c === 1 && d === 5) s += 1.8;
    else if (c === 1 && (d === 4 || d === 7)) s += 0.6;
  }
  if (ctx.lastNote != null) s += chordRole(ctx.lastNote, ch) ? 0.6 : -0.3;
  if (ctx.sevenths) s += ch.seventh ? 0.4 : 0;
  const hint = moodHint(ctx.mood);
  if (hint.dark && ch.quality === "minor") s += 0.5;
  if (hint.bright && ch.quality === "major") s += 0.5;
  return s;
}

// A chord root is not offered for a third bar in a row: Jev prizes consistency, and a bridge that lands on one
// chord would otherwise stay there (five bars of C7 in testing). The cadence bar is set by the form regardless.
export function chordOptions(ctx) {
  const degs = [1, 2, 3, 4, 5, 6, 7].filter((deg) => !(ctx.prev && deg === ctx.prev.degree && ctx.barsOnPrev >= 2));
  return degs.map((deg) => chordOn(deg, ctx.key)).concat(ctx.sevenths ? degs.map((deg) => chordOn(deg, ctx.key, true)) : [])
    .map((ch) => ({ key: ch.symbol, chord: ch, text: describeChord(ctx, ch), score: scoreChord(ctx, ch) }))
    .sort((a, b) => b.score - a.score);
}

export function buildChordState(ctx) {
  const { key, tempo, formId, planBars, total, barInfo, prev, mood } = ctx;
  const ph = barInfo.phrase, start = barInfo.phraseStart, end = start + ph.bars - 1;
  const from = Math.max(1, start - 1);
  const piece = { key: key.name, meter: "4/4", tempo_bpm: tempo, form: formSummary(formId) };
  if (mood) piece.mood = mood;
  piece.character = "a simple, singable song; the chords carry its mood and its shape";
  return {
    piece,
    position: {
      bar: barInfo.bar, of_bars: total,
      phrase: `${ph.id}: ${ROLE_TEXT[ph.role]} (bars ${start}-${end})`,
      bar_in_phrase: `${barInfo.barInPhrase} of ${ph.bars}`,
      bars_until_cadence: ph.bars - barInfo.barInPhrase,
      cadence: `bar ${end} is ${ctx.cadChord.symbol} (${ctx.cadChord.roman}), a ${ph.cadence} cadence set by the form`,
    },
    harmony_so_far: planBars.filter((b) => b.bar >= from && b.bar < barInfo.bar && b.chord).map((b) => `bar ${b.bar}: ${b.chord.symbol} (${b.chord.roman})`),
    recent: {
      last_chord: prev ? `${prev.symbol} (${prev.roman})` : "none, this is the first bar",
      bars_on_the_last_chord: prev ? ctx.barsOnPrev : 0,
      bars_since_the_tonic: ctx.barsSinceTonic,
    },
  };
}

export function buildChordRequest(ctx) {
  const options = chordOptions(ctx);
  const mood = ctx.mood ? ` and its mood, "${ctx.mood}"` : "";
  const questions = {
    chord: {
      type: "choice",
      instructions: `The chord for bar ${ctx.barInfo.bar} that best serves the song${mood}: it follows the chords so far, fits this phrase's role, and heads for the cadence in the state. Each option lists facts computed by code.`,
      criteria: Object.fromEntries(options.map((o) => [o.key, o.text])),
    },
  };
  return { state: buildChordState(ctx), questions, options };
}
