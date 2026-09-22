// Jev transport, adapted from jev-go: TypeSafe System One when a key is set, a seeded heuristic mock otherwise,
// and a `fake` backend for tests. One call = one state + typed questions; the answer is a choice per question
// with a probability for every option. Jev never writes text.
const NATIVE_URL = "https://api.typesafe.ai/v1/systemone";
export const PRICE_PER_M_INPUT = 0.042; // USD, input tokens only

export function backend(env = process.env) {
  if (env.TYPESAFE_API_KEY) return { kind: "native", key: env.TYPESAFE_API_KEY };
  return { kind: "mock" };
}
export const modelFor = (be) => (be.kind === "native" ? "jev-latest" : be.kind === "fake" ? "fake" : "mock-heuristic");

const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

async function callJev(be, payload) {
  const r = await fetch(NATIVE_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${be.key}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  if (!r.ok) {
    const e = new Error(`upstream ${r.status}: ${text.slice(0, 300)}`);
    e.status = 502;
    throw e;
  }
  const data = JSON.parse(text);
  const obj = plain(data) ? data : {};
  const u = plain(obj.usage) ? obj.usage : {};
  return {
    answers: obj.answers,
    usage: { input: num(u.input_tokens ?? u.inputTokens), output: num(u.output_tokens ?? u.outputTokens) },
    model: typeof obj.model === "string" ? obj.model : payload.model,
    raw: data,
  };
}

// ask(): one round trip. `mock()` must return an answers object shaped like the API's.
export async function ask(be, state, questions, mock) {
  const payload = { model: modelFor(be), state, questions };
  const t0 = Date.now();
  let answers, usage = null, model = payload.model, raw;
  if (be.kind === "mock") {
    answers = mock();
    raw = { model, answers, usage: null, note: "mock backend: no API call was made" };
  } else if (be.kind === "fake") {
    answers = await be.answer(payload);
    raw = { model, answers, usage: null, note: "fake backend (tests)" };
  } else {
    ({ answers, usage, model, raw } = await callJev(be, payload));
  }
  // Whatever the backend returned, callers see a plain object (possibly empty): odd answers degrade, never crash.
  return { answers: plain(answers) ? answers : {}, usage, model, latencyMs: Date.now() - t0, io: { request: payload, response: raw } };
}
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// ---------- probabilities ----------
// TypeSafe's shape-based confidence, generalised to N options: (N*pmax - 1) / (N - 1).
export function confidenceFrom(probs) {
  const vals = Object.values(probs || {}).map(Number).filter((v) => Number.isFinite(v));
  const n = vals.length;
  if (n === 0) return 0; // no usable distribution is no information, not certainty
  if (n === 1) return 1; // one option: the answer could not have been anything else
  const pmax = Math.max(...vals);
  return Math.max(0, Math.min(1, (n * pmax - 1) / (n - 1)));
}
export function topK(probs, k = 5) {
  return Object.entries(probs || {}).map(([key, p]) => [key, Number(p)]).filter(([, p]) => Number.isFinite(p)).sort((a, b) => b[1] - a[1]).slice(0, k);
}
export const argmax = (probs) => topK(probs, 1)[0]?.[0] ?? null;

// Only offered keys with finite probabilities in [0, 1] survive; anything else the API sends is dropped here.
export function cleanProbs(probs, allowed) {
  if (!plain(probs)) return {};
  const out = {};
  for (const [k, v] of Object.entries(probs)) {
    const p = Number(v);
    if ((!allowed || allowed.includes(k)) && Number.isFinite(p) && p >= 0 && p <= 1) out[k] = p;
  }
  return out;
}
// One answer, read defensively. `allowed` is the list of option keys the question offered: a choice outside it
// is kept for the record (the caller falls back to code's first choice) but carries no confidence.
export function readAnswer(a, allowed) {
  const ok = plain(a) ? a : {};
  const probs = cleanProbs(ok.probabilities, allowed);
  const choice = (typeof ok.choice === "string" ? ok.choice : null) ?? argmax(probs);
  const usable = choice != null && (!allowed || allowed.includes(choice));
  const given = typeof ok.confidence === "number" && Number.isFinite(ok.confidence) ? Math.max(0, Math.min(1, ok.confidence)) : null;
  const conf = usable ? given ?? confidenceFrom(probs) : 0;
  return { choice, conf, top: topK(probs, 5) };
}
export const pack = (a) => ({ choice: a.choice, confidence: Number(a.conf.toFixed(3)), top: a.top.map(([k, v]) => [k, Number(v.toFixed(4))]) });

// ---------- mock ----------
// mulberry32: a small seeded generator so mock compositions are reproducible.
export function rng(seed) {
  let a = (Number(seed) || 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One mock answer: softmax over heuristic scores, the choice sampled from it (so different seeds differ).
export function mockChoice(scores, rand = Math.random, sharpness = 1.0) {
  const keys = Object.keys(scores);
  const max = Math.max(...keys.map((k) => scores[k]));
  const exps = keys.map((k) => [k, Math.exp((scores[k] - max) * sharpness)]);
  const z = exps.reduce((s, [, v]) => s + v, 0);
  const probabilities = Object.fromEntries(exps.map(([k, v]) => [k, v / z]));
  let r = rand(), choice = keys[keys.length - 1];
  for (const [k, p] of Object.entries(probabilities)) { r -= p; if (r <= 0) { choice = k; break; } }
  return { type: "choice", choice, probabilities };
}
