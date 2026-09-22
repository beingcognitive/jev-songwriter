// Render a composition as ABC notation (abcjs plays it in the browser) and record where each note landed in the
// string, so the page can light up the note and the decision that produced it while it plays.
import { noteName } from "./theory.js";

// C4 is "C", C5 is "c", C6 is "c'", C3 is "C,". Notes are diatonic, so the key signature carries the accidentals.
export function abcPitch(midi, flats) {
  const letter = noteName(midi, flats)[0], oct = Math.floor(midi / 12) - 1;
  return oct >= 5 ? letter.toLowerCase() + "'".repeat(oct - 5) : letter + ",".repeat(4 - oct);
}

export function toAbc(result) {
  const { notes, barPlan, flats } = result;
  let s = `X:1\nT:${result.title}\nC:${result.model === "jev-latest" ? "Jev (TypeSafe System One)" : `Jev stand-in (${result.model})`}\nM:4/4\nL:1/8\nQ:1/4=${result.tempo}\nK:${result.abcKey}\n`;
  const spans = [];
  for (const info of barPlan) {
    const ns = notes.filter((n) => n.bar === info.bar).sort((a, b) => a.onset - b.onset);
    if (info.bar > 1) s += info.barInPhrase === 1 || (info.bar - 1) % 4 === 0 ? "\n" : " ";
    let prevHalf = -1;
    ns.forEach((n, i) => {
      const half = Math.floor(n.onset / 4); // beam within half-bars: no space between notes of the same half
      if (i > 0 && half !== prevHalf) s += " ";
      prevHalf = half;
      const start = s.length;
      if (i === 0) s += `"${info.chord}"`;
      s += (n.midi == null ? "z" : abcPitch(n.midi, flats)) + (n.e === 1 ? "" : String(n.e));
      spans.push({ index: n.index, start, end: s.length });
    });
    s += info.bar === barPlan.length ? " |]" : " |";
  }
  s += "\n";
  for (const sp of spans) Object.assign(notes[sp.index], { abcStart: sp.start, abcEnd: sp.end });
  return s;
}
