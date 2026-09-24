// Synthetic transcript for fixtures/video/sample_10s.mp4: 19 words of 400 ms
// separated by 100 ms, starting at 0.5 s. Word w5 is a profanity (censorship tests).
const text = "hola a todos hoy les cuento una mierda que me pasó ayer en el trabajo. fue increíble de verdad";
const words = text.split(" ").map((t, i) => ({
  id: `w${i}`,
  text: t,
  startMs: 500 + i * 500,
  endMs: 900 + i * 500,
  speaker: i < 12 ? "S0" : "S1",
  confidence: 0.95,
}));
const sentences = [];
let cur = [];
for (const w of words) {
  cur.push(w);
  if (/[.!?]$/.test(w.text) || w === words[words.length - 1]) {
    sentences.push({ id: `s${sentences.length}`, startMs: cur[0].startMs, endMs: cur[cur.length - 1].endMs, wordIds: cur.map((x) => x.id), speaker: cur[0].speaker });
    cur = [];
  }
}
const transcript = {
  assetId: "fixture_sample_10s",
  language: "es",
  provider: "fixture",
  providerVersion: "1",
  durationMs: 10000,
  words,
  speakers: [{ id: "S0", label: "Hablante 1" }, { id: "S1", label: "Hablante 2" }],
  sentences,
};
console.log(JSON.stringify(transcript, null, 2));
