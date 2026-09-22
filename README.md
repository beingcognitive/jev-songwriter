# Jev songwriter

Jev, TypeSafe AI's System One decision model, writes a melody. Jev does not generate text or notes: it takes a
state and a typed question with a list of options and returns one choice with a probability for every option.
So the doctrine is the same as in [jev-go](../jev-go): **code computes, Jev judges.**

- Code owns the grid: the song form, its phrases, the bars, and the cadences.
- **Setup.** Given a `--mood`, Jev picks whatever you did not pin: mode (major or minor), tempo (five bands) and
  form, in one call. The mood then travels in every state and every instruction. Two named moods, `bossa nova`
  and `jazz`, expand to a fuller brief and put the diatonic seventh chords (Cmaj7, Dm7, G7, Bm7b5, ...) into the
  chord options next to the triads; `--sevenths` does that for any mood.
- **Chords.** For every fresh bar Jev picks the chord from the seven diatonic triads, each annotated with facts:
  quality and harmonic function, motion from the previous chord and common tones, how usual the move is in songs,
  what it does right before the coming cadence. Cadence chords are set by the form; a repeated phrase keeps its
  model's chords. `--order chords-first` (default) decides the whole harmony before the first note;
  `--order interleaved` decides each bar's chord just before its notes, one bar ahead, so the chord can react to
  the melody so far. `--chords fixed` uses the hand-written progressions instead.
- **Notes.** For every note, code enumerates the legal next pitches (scale tones in range, within an octave of
  the last note, plus a rest) and the lengths that fit in the bar, and annotates each with facts: interval from
  the last note, chord tone or tension, whether it resolves a leap, where the beat falls, how far the cadence is.
  Jev answers two questions per note, `next_pitch` and `length`, in one call. Its pick is played.
- Forced moves are played by code without a call: the cadence bar of every phrase holds the closing degree,
  and a repeated phrase repeats its model verbatim except for that last bar. Repetition is what makes eight
  bars of notes sound like a song.
- Three rules of the game, all about what is offered, so every answer is legal by construction. Two are against
  the same trait, Jev prizes consistency: a whole note is not offered in the first bar of a phrase, nor right
  after a bar that held a single note (its probability for "hold again" climbed from 64% to 94% over three bars
  in testing); a chord root is not offered to Jev for a third bar in a row (a jazz bridge sat on C7 for five
  bars; the form's cadence chord and a repeated phrase can still extend a run, by design). The third: a rest is
  never longer than a half note, and since pitch and length are one call, the rest is only offered when every
  length on offer fits that cap.

Output is real [ABC notation](https://abcnotation.com), a JSON trace of every call, and an HTML page that
renders the score, plays it with abcjs (chords under the melody, optional), and lists every decision with Jev's
probabilities and where its pick ranked in code's own one-ply ordering.

The page can also **replay the composition**: step 0 is the empty grid code hands to Jev; then each call
"thinks" for exactly as long as Jev took (1× to 30×) and reveals its answer, the full probability distribution
over the options, the facts code attached to the pick, and the raw response, while chords and then notes land on
the sheet and a strip of bars grows with every call's response time. A slider, ◀ ▶ buttons and the arrow keys
step through it by hand.

## Run

```bash
npm test
npm run compose                                    # C major, 100 bpm, AABA 32 bars, random seed
npm run compose -- --key A --mode minor --form mini_8 --tempo 90 --seed 7 --title "Small hours"
npm run compose -- --form auto                     # Jev picks the form too
npm run serve                                      # http://localhost:3222 lists the pages in out/
```

`npm run compose` is `node --use-system-ca compose.mjs`: behind a proxy that re-signs TLS, plain `node` rejects
the API's certificate chain. That flag needs Node 22.15 or newer. Everything after `--` is passed to the CLI.

```bash
```

Forms: `mini_8` (4+4), `short_16` (8+8), `aabb_16` (4+4, 4+4), `aaba_32` (8×4), or `auto`.
Keys: any major or minor key up to five accidentals (`C`, `F#`, `Bb`, ...). Without a mood the defaults are
major, 100 bpm, AABA; with one, anything you do not pass is Jev's to decide.

With `TYPESAFE_API_KEY` in the environment or in `.dev.vars`, every note is one
`POST https://api.typesafe.ai/v1/systemone` with model `jev-latest`. Without it a seeded heuristic mock plays
Jev's part, so the whole pipeline runs offline and the same seed always gives the same tune.

## The site

`npm run site` builds `docs/` for GitHub Pages: an index with every demo in `demos.json` (score, player, facts,
a link to its replay page), the write-up of how it was built and what we found, and a copy of each demo page
with its JSON trace next to it (`docs/demos/<name>.json`), so a fresh clone can rebuild the site although `out/`
is git-ignored. A demo with no trace anywhere stops the build; `--partial` overrides. Point GitHub Pages at the
`docs/` folder of `main`. `npm run serve` serves only `out/` and `docs/`, on localhost.

## Cost

Jev bills input only, $0.042 per million tokens. A note request is about 1,600 tokens and a chord request
less; a 32-bar AABA has 16 fresh bars, so about 15 chord calls plus 45 to 65 note calls, well under a cent.

## Layout

```
compose.mjs        CLI
render.mjs         re-render out/*.html from their JSON after a page change
site.mjs           build docs/ (GitHub Pages) from demos.json and out/*.json
serve.mjs          static server for out/
lib/jev.js         Jev transport (native, mock, fake), probabilities, seeded rng
lib/theory.js      keys, scales, degrees, intervals, diatonic triads
lib/form.js        song forms, phrase roles, the fixed chord tables
lib/harmony.js     chord options (triads, sevenths), their facts, code's ranking, the chord state
lib/moods.js       named moods: the brief Jev reads and what the style needs from code
lib/melody.js      setup by mood, note candidates and facts, the state, the compose loop
lib/abc.js         ABC rendering with character spans per note
lib/page.js        the HTML page
test.mjs           node:test
```

## Review log

2026-09-22, after the first commit: one `/codex review` plus a 1+3+3 fan-out (self review, three Codex and three
Opus reviewers on the same prompt, none seeing the others). Findings by how many of the seven raised them, with
what was done. All fixes carry a regression test.

| Finding | Raised by | Done |
|---|---|---|
| `serve.mjs` served the repository root (so any `.dev.vars`), admitted sibling directories through an encoded `..`, listened on all interfaces, threw on `/%` | 7/7 | serves only `out/` and `docs/`, on localhost, resolved and checked with `path.relative`; bad escapes are 400; the index escapes filenames |
| Odd answers corrupted the stats: an empty distribution scored 100% confidence, a supplied confidence was not clamped, a null envelope crashed, fallbacks counted as agreement | 7/7 | `confidenceFrom({})` is 0; confidence clamped to 0..1; every transport hands back a plain object; agreement and mean confidence are computed over answered steps only; probabilities are filtered to offered keys with finite values |
| Response keys reached `innerHTML` unescaped in the table and the replay panel | 6/7 | escaped in the page, and foreign keys are dropped at `readAnswer` |
| Setup: a prototype-key answer such as `constructor` crashed; fallbacks picked values never offered; the mode question offered modes the key cannot take; the cheap checks ran after the paid call | 6/7 | own-property lookups; option lists ranked by code so the first key is the fallback; only legal modes offered; key, pinned mode, tempo and form are checked before any call |
| With sevenths, the chord state named the triad cadence chord while code placed the seventh | 6/7 | the same `cadChord` everywhere; a test compares the state's cadence chord with the one placed |
| A newline in the title or mood injected ABC header fields | 6/7 | header fields are one line, always |
| The page: finishing or stepping past the end re-rendered the score under the player; an in-flight `setTune` was never sequenced; the dimmed player was keyboard-reachable; the chords checkbox could load a partial score | 7/7 in parts | rendering is idempotent per ABC string; `setTune` results are sequenced; the player is `inert` while partial; the checkbox reloads only a full score |
| A rest was offered next to lengths longer than the rest cap, then silently clamped, so the length facts were false | 5/7 | the rest is withheld whenever a long length is offered; the clamp is gone |
| `Cb`, `E#`, `B#`, `Fb` parsed to NaN pitch classes | 5/7 | rejected with the enharmonic to use |
| Natural-minor VII described as a leading-tone chord | 3/7 | subtonic wording in minor |
| Valueless flags became `true` and crashed after the paid calls; a non-numeric seed became NaN | 6/7 | strict argument parser, exits 2 before any call |
| `render.mjs` on `.JSON` overwrote its input | 3/7 | extension checked, case-insensitive |
| `npm run site` on a fresh clone overwrote the index with zero demos; demo names unvalidated; hrefs not URL-encoded | 3/7 (Opus) + 3/7 (Codex) | traces copied into `docs/demos/`, refusal without them unless `--partial`, names restricted, hrefs encoded |
| In minor keys the advertised range named two notes outside the key, and the range-edge facts were dead | 2/7 (Opus) | edges are the actual first and last scale tones |
| `--chords fixed` or a given progression with a sevenths mood claimed seventh chords | 1/7, verified | sevenths only when Jev picks the chords |
| `engines` said Node 20 while `--use-system-ca` needs 22.15 | 1/7, verified | engines bumped |
| Padding: the held-bar run count was never read; two chord-repeat branches were unreachable (and would have printed "3th bar"); "the first pitch after the opening rest" could not happen; the mood hint was recomputed per option; `esc`, `pct`, the price and the script escaping were duplicated | most | all removed or shared |

Declined: validating the whole distribution and discarding an answer whose probability map is incomplete (three
Codex reviewers); a legitimate choice with one missing key would be thrown away, so validity stays choice-based
and the map is sanitised. Backlog: the page re-derives the bar layout that `lib/abc.js` owns, and `toAbc` writes
spans back into `result.notes` (guarded by an assertion for now); a cadence chord or a repeated phrase can still
put three bars on one root, which the rule about what Jev is offered does not try to prevent.
