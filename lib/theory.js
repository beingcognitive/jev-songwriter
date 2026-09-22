// Music theory helpers: pitch names, scales, degrees, intervals, diatonic triads. Everything the melody
// engine needs to enumerate legal notes and describe them in plain words.
const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const PC = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
export const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
const DEGREE_NAMES = {
  major: ["tonic", "supertonic", "mediant", "subdominant", "dominant", "submediant", "leading tone"],
  minor: ["tonic", "supertonic", "mediant", "subdominant", "dominant", "submediant", "subtonic"],
};
// Keys spelled with flats; the rest use sharps. Six-accidental keys need Cb/E#/B# and are refused.
const FLAT_MAJOR = new Set([5, 10, 3, 8, 1]); // F Bb Eb Ab Db
const FLAT_MINOR = new Set([2, 7, 0, 5, 10]); // D G C F Bb
const BANNED = { major: new Set([6]), minor: new Set([3]) };

export function keyInfo(keyName = "C", mode = "major") {
  if (!Object.hasOwn(SCALES, String(mode))) throw new Error(`mode must be major or minor, got "${mode}"`);
  const pc = Object.hasOwn(PC, String(keyName)) ? PC[keyName] : null;
  if (pc == null) throw new Error(`unknown key "${keyName}" (use C, F#, Bb, ...)`);
  if (BANNED[mode].has(pc)) throw new Error(`${keyName} ${mode} needs six accidentals; pick a neighbouring key`);
  const flats = (mode === "major" ? FLAT_MAJOR : FLAT_MINOR).has(pc);
  const tonic = (flats ? FLAT : SHARP)[pc];
  const tonicMidi = 60 + (pc <= 6 ? pc : pc - 12); // C4..F#4, or G3..B3: keeps every key in one singing range
  const pcs = SCALES[mode].map((i) => (pc + i) % 12);
  return { tonic, mode, pc, flats, tonicMidi, pcs, name: `${tonic} ${mode}`, abcKey: mode === "major" ? tonic : `${tonic}m`, degreeNames: DEGREE_NAMES[mode] };
}

export const noteName = (midi, flats = false) => `${(flats ? FLAT : SHARP)[midi % 12]}${Math.floor(midi / 12) - 1}`;
export function parseNote(s) {
  const m = /^([A-G][#b]?)(-?\d)$/.exec(s);
  if (!m || !Object.hasOwn(PC, m[1])) throw new Error(`bad note "${s}"`);
  return (Number(m[2]) + 1) * 12 + PC[m[1]];
}
export function degreeOf(midi, key) { const i = key.pcs.indexOf(midi % 12); return i < 0 ? null : i + 1; }
export function scaleTones(key, lo, hi) {
  const out = [];
  for (let m = lo; m <= hi; m++) if (key.pcs.includes(m % 12)) out.push(m);
  return out;
}
export const ordinal = (n) => `${n}${n % 100 > 10 && n % 100 < 14 ? "th" : ["th", "st", "nd", "rd"][n % 10 < 4 ? n % 10 : 0]}`;
const INTERVALS = ["unison", "minor 2nd", "major 2nd", "minor 3rd", "major 3rd", "perfect 4th", "tritone", "perfect 5th", "minor 6th", "major 6th", "minor 7th", "major 7th", "octave"];
export const intervalName = (semis) => { const a = Math.abs(semis); return a <= 12 ? INTERVALS[a] : `${a} semitones`; };

// The diatonic triad on a scale degree (1..7), or the diatonic seventh chord when `seventh` is set.
export function chordOn(degree, key, seventh = false) {
  const d = degree - 1;
  const pcs = (seventh ? [0, 2, 4, 6] : [0, 2, 4]).map((k) => key.pcs[(d + k) % 7]);
  const third = (pcs[1] - pcs[0] + 12) % 12, fifth = (pcs[2] - pcs[0] + 12) % 12;
  const quality = fifth === 6 ? "dim" : third === 4 ? "major" : "minor";
  const names = key.flats ? FLAT : SHARP;
  const numeral = ["I", "II", "III", "IV", "V", "VI", "VII"][d];
  let roman = quality === "major" ? numeral : quality === "minor" ? numeral.toLowerCase() : `${numeral.toLowerCase()}°`;
  let symbol = names[pcs[0]] + (quality === "minor" ? "m" : quality === "dim" ? "dim" : "");
  let kind = quality;
  if (seventh) {
    const sev = (pcs[3] - pcs[0] + 12) % 12; // 11 = major seventh, 10 = minor seventh
    if (quality === "major" && sev === 11) { symbol = `${names[pcs[0]]}maj7`; roman = `${numeral}maj7`; kind = "maj7"; }
    else if (quality === "major") { symbol = `${names[pcs[0]]}7`; roman = `${numeral}7`; kind = "dom7"; }
    else if (quality === "minor") { symbol = `${names[pcs[0]]}m7`; roman = `${numeral.toLowerCase()}7`; kind = "m7"; }
    else { symbol = `${names[pcs[0]]}m7b5`; roman = `${numeral.toLowerCase()}ø7`; kind = "m7b5"; }
  }
  return { degree, pcs, quality, seventh, kind, root: names[pcs[0]], roman, symbol, tones: pcs.map((p) => names[p]).join(" ") };
}
export const KIND_TEXT = { major: "major", minor: "minor", dim: "diminished", maj7: "major seventh", dom7: "dominant seventh", m7: "minor seventh", m7b5: "half-diminished seventh", dim7: "diminished seventh" };
export function chordRole(midi, chord) { const i = chord.pcs.indexOf(midi % 12); return i < 0 ? null : ["root", "third", "fifth", "seventh"][i]; }

// A chord the user typed, such as "Am", "G7", "Fmaj7", "Bm7b5", "Ddim". Roman numerals are relative to the key
// when the root is diatonic; otherwise the symbol stands in.
const CHORD_KINDS = { "": ["major", [0, 4, 7], false], m: ["minor", [0, 3, 7], false], dim: ["dim", [0, 3, 6], false], 7: ["dom7", [0, 4, 7, 10], true], maj7: ["maj7", [0, 4, 7, 11], true], m7: ["m7", [0, 3, 7, 10], true], m7b5: ["m7b5", [0, 3, 6, 10], true], dim7: ["dim7", [0, 3, 6, 9], true] };
export function parseChord(symbol, key) {
  const m = /^([A-G][#b]?)(maj7|m7b5|dim7|m7|dim|m|7)?$/.exec(String(symbol).trim());
  if (!m) throw new Error(`cannot read chord "${symbol}"; use forms like C, Am, Bdim, G7, Fmaj7, Dm7, Bm7b5`);
  if (!Object.hasOwn(PC, m[1])) throw new Error(`cannot read chord "${symbol}": ${m[1]} is not spelled here; use its enharmonic (B for Cb, C for B#, F for E#, E for Fb)`);
  const [kind, steps, seventh] = CHORD_KINDS[m[2] || ""];
  const rootPc = PC[m[1]], pcs = steps.map((i) => (rootPc + i) % 12);
  const names = key.flats ? FLAT : SHARP;
  const degree = key.pcs.indexOf(rootPc) + 1 || null;
  const quality = kind === "major" || kind === "dom7" || kind === "maj7" ? "major" : kind === "minor" || kind === "m7" ? "minor" : "dim";
  let roman = m[1] + (m[2] || "");
  if (degree) {
    const numeral = ["I", "II", "III", "IV", "V", "VI", "VII"][degree - 1];
    const base = quality === "major" ? numeral : numeral.toLowerCase();
    roman = { major: base, minor: base, dim: `${base}°`, dom7: `${base}7`, maj7: `${base}maj7`, m7: `${base}7`, m7b5: `${base}ø7`, dim7: `${base}°7` }[kind];
  }
  return { degree, pcs, quality, seventh, kind, root: m[1], roman, symbol: m[1] + (m[2] || ""), tones: pcs.map((pc) => names[pc]).join(" "), given: true };
}
export const parseProgression = (text, key) => String(text).split(/[\s,|–-]+/).filter(Boolean).map((sym) => parseChord(sym, key));
