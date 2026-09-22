// Named moods: a fuller description for Jev to read, plus what the style needs from code. Any other text is
// passed to Jev as it is.
export const MOODS = {
  "bossa nova": {
    text: "bossa nova: gentle, warm and a little melancholy, Brazilian and cool; smooth seventh-chord harmony, a lilting melody that leans on off-beats and syncopation, long notes and space, never hurried",
    sevenths: true,
  },
  jazz: {
    text: "a jazz standard: sophisticated seventh-chord harmony moving through ii–V–I, a melody that sits on chord tones and colour tones, swings across the beat, and breathes with rests",
    sevenths: true,
  },
};
// "bossa", "Bossa Nova", "jazz ballad" all resolve; anything else returns null.
export function resolveMood(input) {
  if (!input) return null;
  const q = String(input).toLowerCase();
  for (const [name, m] of Object.entries(MOODS)) if (q.includes(name.split(" ")[0])) return { name, ...m };
  return null;
}
