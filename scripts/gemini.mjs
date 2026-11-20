// Gemini の読み上げ（Gemini API の TTS・11/20 しょーくん「Claude に頼むだけで商用の声ができる環境」）
// 依頼書のいちばん上に engine: gemini と書いた依頼書だけ、こちらで作る（ほかは VOICEVOX）。
// 確かめた公式ページ（2026-11-20）：ai.google.dev の speech-generation（2026-10-12 更新）・pricing・terms。
//   モデル gemini-3.8-flash-tts（日本語OK・preview ではない）と gemini-3.8-flash-lite-tts。無料枠あり（送った文は Google の改善に使われる）。
//   声は30種類。話し方は speech_metadata.style にことばで書く。<laugh> などの記号も使える。返ってくるのは WAV（24kHz・モノラル・16bit）
import { createHash } from 'node:crypto';
import YAML from 'yaml';

export const GEMINI_MODELS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'];
export const GEMINI_MODEL_DEF = 'gemini-3.8-flash-tts';
export const GEMINI_MAX_TEXT = 1000;
export const GEMINI_MAX_STYLE = 300;
export const TAKES_MAX = 3;
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

// 声の名前と、公式の一言（かっこの中は日本語の目安）
export const GEMINI_VOICES = {
  Zephyr: 'Bright（明るい）', Puck: 'Upbeat（元気）', Charon: 'Informative（説明じょうず）', Kore: 'Firm（しっかり）',
  Fenrir: 'Excitable（はしゃぐ）', Leda: 'Youthful（若い）', Orus: 'Firm（しっかり）', Aoede: 'Breezy（さわやか）',
  Callirrhoe: 'Easy-going（のんびり）', Autonoe: 'Bright（明るい）', Enceladus: 'Breathy（息まじり）', Iapetus: 'Clear（はっきり）',
  Umbriel: 'Easy-going（のんびり）', Algieba: 'Smooth（なめらか）', Despina: 'Smooth（なめらか）', Erinome: 'Clear（はっきり）',
  Algenib: 'Gravelly（ざらっと低め）', Rasalgethi: 'Informative（説明じょうず）', Laomedeia: 'Upbeat（元気）', Achernar: 'Soft（やわらか）',
  Alnilam: 'Firm（しっかり）', Schedar: 'Even（おだやか）', Gacrux: 'Mature（おとな）', Pulcherrima: 'Forward（前向き）',
  Achird: 'Friendly（親しみ）', Zubenelgenubi: 'Casual（くだけた）', Vindemiatrix: 'Gentle（やさしい）', Sadachbia: 'Lively（いきいき）',
  Sadaltager: 'Knowledgeable（物知り）', Sulafat: 'Warm（あたたかい）',
};

export function isGemini(text) {
  try { return (YAML.parse(text) || {}).engine === 'gemini'; } catch { return false; }
}

// 依頼書を1行ずつの形に（行 → 依頼書のいちばん上 → 決まりの値）
export function parseGemini(game, set, text) {
  const doc = YAML.parse(text) || {};
  const lines = Array.isArray(doc.lines) ? doc.lines : [];
  return {
    game, set,
    model: String(doc.model ?? GEMINI_MODEL_DEF),
    wav: doc.wav === true,
    lines: lines.map((l) => ({
      id: String(l?.id ?? ''),
      text: String(l?.text ?? ''),
      voice: String(l?.voice ?? doc.voice ?? ''),
      style: String(l?.style ?? doc.style ?? ''),
      takes: Number(l?.takes ?? doc.takes ?? 1),
    })),
  };
}

export function validateGemini(req) {
  const errs = [];
  const where = `requests/${req.game}/${req.set}`;
  if (!GEMINI_MODELS.includes(req.model)) errs.push(`${where}：model は ${GEMINI_MODELS.join('・')}`);
  if (req.lines.length === 0) errs.push(`${where}：lines がない`);
  const seen = new Set();
  req.lines.forEach((l, i) => {
    const at = `${where} の ${i + 1} 行め（${l.id || 'id なし'}）`;
    if (!ID_RE.test(l.id)) errs.push(`${at}：id は小文字の英数字と - _ だけ（ファイル名になる）`);
    if (seen.has(l.id)) errs.push(`${at}：id が重なっている`);
    seen.add(l.id);
    const len = [...l.text].length;
    if (len === 0 || len > GEMINI_MAX_TEXT) errs.push(`${at}：text は 1〜${GEMINI_MAX_TEXT} 字`);
    if (!GEMINI_VOICES[l.voice]) errs.push(`${at}：voice「${l.voice}」は Gemini の声にない（${Object.keys(GEMINI_VOICES).join('・')}）`);
    if ([...l.style].length > GEMINI_MAX_STYLE) errs.push(`${at}：style は ${GEMINI_MAX_STYLE} 字まで`);
    if (!Number.isInteger(l.takes) || l.takes < 1 || l.takes > TAKES_MAX) errs.push(`${at}：takes は 1〜${TAKES_MAX}`);
  });
  return errs;
}

// 同じモデル・声・話し方・文・本数なら作りなおさない
export function geminiKey(req, l) {
  const pick = { e: 'gemini', gv: 1, model: req.model, voice: l.voice, style: l.style, text: l.text, takes: l.takes };
  return createHash('sha1').update(JSON.stringify(pick)).digest('hex').slice(0, 16);
}

// 1本め <id>.mp3・2本め <id>_2.mp3・3本め <id>_3.mp3
export function takeNames(id, takes, ext = 'mp3') {
  return Array.from({ length: takes }, (_, i) => (i === 0 ? `${id}.${ext}` : `${id}_${i + 1}.${ext}`));
}

// 送る中身。shape=new は公式の今の形（speech_metadata.style・voiceConfig.voice）、old は前の形（prebuiltVoiceConfig・話し方は文の前に）
export function geminiBody(l, shape = 'new') {
  if (shape === 'old') {
    const text = l.style ? `次のセリフを、${l.style}読み上げてください：${l.text}` : l.text;
    return {
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: l.voice } } } },
    };
  }
  const part = { text: l.text };
  if (l.style) part.speech_metadata = { style: l.style };
  return {
    contents: [{ role: 'user', parts: [part] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice: l.voice } } },
  };
}

// 返事から音を取り出して WAV にする（頭がないときは 24kHz・モノラル・16bit の頭をつける）
export function audioFromResponse(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const p = parts.find((x) => x?.inlineData?.data);
  if (!p) {
    const why = json?.candidates?.[0]?.finishReason || json?.promptFeedback?.blockReason || '音が入っていない';
    throw new Error(`Gemini の返事に音がない（${why}）`);
  }
  const buf = Buffer.from(p.inlineData.data, 'base64');
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF') return buf;
  const rate = Number((/rate=(\d+)/.exec(p.inlineData.mimeType || '') || [])[1]) || 24000;
  return pcmToWav(buf, rate);
}

export function pcmToWav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const URL_BASE = process.env.GEMINI_URL || 'https://generativelanguage.googleapis.com/v1beta/models'; // GEMINI_URL は手元のためしだけ
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1本作る。今の形で 400 なら前の形で1回。429 は少し待って2回まで（1日の回数を使いきったときは止める）
export async function synthGemini({ apiKey, model, line, fetchImpl = fetch, wait = sleep }) {
  if (!apiKey) throw new Error('Gemini の鍵（GitHub の Secrets の GEMINI_API_KEY）がない');
  let shape = 'new';
  for (let tryNo = 1; ; tryNo++) {
    const res = await fetchImpl(`${URL_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(geminiBody(line, shape)),
      signal: AbortSignal.timeout(180000),
    });
    if (res.ok) return audioFromResponse(await res.json());
    const body = (await res.text()).slice(0, 400);
    if (res.status === 400 && shape === 'new' && /speech_metadata|voiceConfig|Unknown name|Invalid JSON payload/i.test(body)) { shape = 'old'; continue; }
    if (res.status === 429 && !/per ?day|PerDay|daily/i.test(body) && tryNo <= 2) { await wait(20000 * tryNo); continue; }
    if (res.status === 429) throw new Error('Gemini の無料枠の回数を使いきった（あしたまた作る）');
    if (res.status === 400 && /API key not valid|API_KEY_INVALID/i.test(body)) throw new Error('Gemini の鍵がちがう（GEMINI_API_KEY を作りなおして入れなおす）');
    if (res.status === 403) throw new Error(`Gemini に断られた（403・鍵の権限かこの国・地域で使えない）：${body.slice(0, 160)}`);
    throw new Error(`Gemini ${res.status}：${body.slice(0, 200)}`);
  }
}
