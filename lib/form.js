// Song forms. Code owns the grid: phrases, their lengths, roles, cadences and chords. A phrase with `reuse`
// repeats another phrase's bars verbatim (except the cadence bar), which is what makes it sound like a song.
export const FORMS = {
  mini_8: {
    name: "8-bar period", label: "8 bars: a 4-bar question and its 4-bar answer",
    phrases: [
      { id: "A", bars: 4, family: "A", role: "opening", cadence: "half" },
      { id: "A'", bars: 4, family: "A", role: "answer", cadence: "full", reuse: "A" },
    ],
  },
  short_16: {
    name: "16-bar period", label: "16 bars: an 8-bar question and its 8-bar answer",
    phrases: [
      { id: "A", bars: 8, family: "A", role: "opening", cadence: "half" },
      { id: "A'", bars: 8, family: "A", role: "answer", cadence: "full", reuse: "A" },
    ],
  },
  aabb_16: {
    name: "AABB", label: "16 bars: a 4-bar question and answer, then a contrasting 4-bar question and answer",
    phrases: [
      { id: "A", bars: 4, family: "A", role: "opening", cadence: "half" },
      { id: "A'", bars: 4, family: "A", role: "answer", cadence: "full", reuse: "A" },
      { id: "B", bars: 4, family: "B", role: "contrast", cadence: "half" },
      { id: "B'", bars: 4, family: "B", role: "answer", cadence: "full", reuse: "B" },
    ],
  },
  aaba_32: {
    name: "AABA", label: "32 bars, the classic song form: opening, its answer, a bridge, and the return",
    phrases: [
      { id: "A", bars: 8, family: "A", role: "opening", cadence: "half" },
      { id: "A'", bars: 8, family: "A", role: "answer", cadence: "full", reuse: "A" },
      { id: "B", bars: 8, family: "B", role: "contrast", cadence: "half" },
      { id: "A''", bars: 8, family: "A", role: "return", cadence: "full", reuse: "A'" },
    ],
  },
};

export const ROLE_TEXT = {
  opening: "the opening phrase, which states the main idea and ends open",
  answer: "the answering phrase, which repeats the opening idea and closes on the tonic",
  contrast: "the contrasting phrase (the bridge): a new idea that ends open so the opening can return",
  return: "the return of the opening idea, closing the piece on the tonic",
};

// Chord degrees per bar. A phrase pair shares every bar but the last, so a repeated phrase sits on the
// same harmony; the last bar is V for a half cadence and I for a full one.
const FAMILY = {
  A: { 4: [1, 4, 5], 8: [1, 6, 4, 5, 1, 4, 5] },
  B: { 4: [6, 4, 5], 8: [6, 4, 1, 5, 6, 4, 5] },
};
export function progression(family, bars, cadence) {
  const body = FAMILY[family]?.[bars];
  if (!body) throw new Error(`no progression for family ${family} with ${bars} bars`);
  return [...body, cadence === "full" ? 1 : 5];
}

export const formBars = (form) => form.phrases.reduce((a, p) => a + p.bars, 0);
export const formSeconds = (form, tempo) => Math.round((formBars(form) * 4 * 60) / tempo);
export function formSummary(id) {
  const f = FORMS[id];
  return `${f.name} (${formBars(f)} bars): ${f.phrases.map((p) => `${p.id} ${p.role} ${p.bars} bars${p.reuse ? ` (repeats ${p.reuse})` : ""}`).join(", ")}`;
}
export function describeForm(id, tempo) {
  const f = FORMS[id];
  return `${f.name}: ${f.label}. ${formBars(f)} bars, about ${formSeconds(f, tempo)} seconds at ${tempo} bpm.`;
}
