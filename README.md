# Jev, the songwriter

**A decision model that cannot write a single note writes songs.**
Live site with five tunes, each replayable call by call: **https://beingcognitive.github.io/jev-songwriter/**

Jev is [TypeSafe AI](https://typesafe.ai)'s System One decision model. It never generates text or notes. It takes a
state and a typed question with a list of options, and returns one choice with a probability for every option. So
this project follows the same doctrine as [Beat Jev at Go](https://jev-go.chardonn.ai): **code computes, Jev
judges.** Code does everything that only needs to be legal; Jev does the choosing: which chord, which note, how long.

## How a song gets written

1. **Setup.** Given a mood such as “wistful, late night”, one call asks Jev for the mode, the tempo and the song form,
   unless you pinned them. The mood text then rides along in every later call.
2. **Chords, one call per fresh bar.** The options are the seven diatonic triads (plus seventh chords when asked).
   Each option carries facts computed by code: quality and harmonic function, root motion from the previous chord
   and common tones, how usual the move is in songs, what it does right before the coming cadence. Cadence chords are
   set by the form; a repeated phrase keeps its model's chords.
3. **Notes, one call per note.** Code offers the scale tones within an octave of the last note, plus a rest, and the
   lengths that still fit in the bar. Each pitch says what interval it makes, whether it is a chord tone, whether it
   resolves a leap, how far it is from the cadence note; each length says where it starts and ends and whether it
   syncopates. Jev answers both questions in one call.
4. **Forced moves, no call.** The last bar of every phrase holds the closing degree. The answering phrase repeats the
   opening bar for bar except that last bar, and the return repeats the answer. Repetition is what makes sixteen bars
   of choices sound like a song.

Three rules govern what is offered, so every answer is legal by construction: no whole note in a phrase's first bar
or right after a held bar, no chord root offered for a third bar in a row, and a rest only where every length on
offer fits under a half note. The first two exist because Jev's one strong trait is consistency: left alone it held
a note for seven bars and sat on one chord for five.

Every run writes real [ABC notation](https://abcnotation.com), a JSON trace of every request and response, and a
self-contained HTML page. The page renders the score with [abcjs](https://www.abcjs.net), plays it with the chords
underneath, and **replays the composition**: the empty grid, then the chords landing bar by bar, then the notes,
each call taking exactly as long as Jev took, with the full probability distribution, the facts code attached to
the pick, and the raw response. A slider, ◀ ▶ buttons and the arrow keys step through it by hand.

## What we found

- Told “wistful, late night”, Jev chose minor at 100% confidence and 72 bpm. Told “playful, skipping down the
  street”, major at 100% and 120 bpm in skipping eighths. Told “restless, pacing the room at midnight”, it opened on
  the diminished chord, the one tense chord in the key, which code's own ranking had put last of seven.
- Jev is not echoing code's ranking: its pick was code's first choice between a fifth and four fifths of the time,
  and the page shows the rank of every pick.
- A call takes about 250 ms and about 1,600 input tokens. Jev bills input only, $0.042 per million tokens, so a
  32-bar song is 60 to 80 calls, roughly twenty seconds and half a cent.

## Run it yourself

Needs Node 22.15 or newer and a TypeSafe API key in the environment or in `.dev.vars` (copy `.dev.vars.example`).
Without a key, a seeded mock plays Jev's part, so everything runs offline and the same seed always gives the same
tune. There are no dependencies.

```bash
npm test
npm run compose -- --mood "wistful, late night"                 # Jev picks mode, tempo, form, chords, notes
npm run compose -- --mood "a bright pop chorus" --chords "C G Am F" --tempo 120 --form aaba_32
npm run compose -- --mood "triumphant, a fanfare" --order interleaved
npm run compose -- --key A --mode minor --form mini_8 --seed 7 --title "Small hours"
npm run serve                                                    # http://localhost:3222
```

| Option | Values | Notes |
|---|---|---|
| `--mood` | any text; `jazz` and `bossa nova` are named briefs | with a mood, anything you do not pass is Jev's to decide |
| `--key` | any major or minor key up to five accidentals | `C`, `F#`, `Bb`, ... |
| `--mode` | `major`, `minor` | default major without a mood |
| `--tempo` | 40 to 240 bpm | default 100 without a mood |
| `--form` | `mini_8`, `short_16`, `aabb_16`, `aaba_32`, `auto` | default AABA without a mood |
| `--chords` | `jev` (default), `fixed`, or a progression like `"C G Am F"` | a given progression is laid over every phrase; Jev writes only the melody |
| `--order` | `chords-first` (default), `interleaved` | interleaved decides each bar's chord just before its notes, one bar ahead |
| `--sevenths` | flag | offers the diatonic seventh chords with any mood |
| `--seed`, `--title`, `--name`, `--out`, `--quiet` | | the seed drives the mock; the name is the output file base |

`npm run compose` runs `node --use-system-ca compose.mjs`, which matters behind a proxy that re-signs TLS.
Outputs land in `out/`: `<name>.abc`, `<name>.json` (every call), `<name>.html` (the page).

`npm run site` builds `docs/` for GitHub Pages from `demos.json`: an index with every listed demo (score, player,
facts, a link to its replay) plus each demo page with its trace beside it, so a fresh clone can rebuild the site.
`npm run render` re-renders `out/*.html` from their traces after a change to the page.

## Layout

```
compose.mjs        CLI
render.mjs         re-render out/*.html from their JSON traces
site.mjs           build docs/ for GitHub Pages from demos.json
serve.mjs          static server for out/ and docs/, localhost only
lib/jev.js         Jev transport (native, mock, fake), probabilities, seeded rng
lib/theory.js      keys, scales, degrees, intervals, diatonic triads and sevenths
lib/form.js        song forms, phrase roles, the fixed chord tables
lib/harmony.js     chord options, their facts, code's ranking, the chord state
lib/moods.js       named moods: the brief Jev reads and what the style needs from code
lib/melody.js      setup by mood, note candidates and facts, the state, the compose loop
lib/abc.js         ABC rendering with character spans per note
lib/page.js        the HTML page and the replay
test.mjs           node:test, 32 tests, runs offline
```

## License

MIT. Jev is TypeSafe AI's model. Scores and audio in the pages come from [abcjs](https://www.abcjs.net) (MIT),
loaded from a CDN at a pinned version.
