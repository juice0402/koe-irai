// Lyria の曲づくり（Gemini API・11/21 しょーくん「1000円分ちゃーじするから、しっかりお願いね」）
// 依頼書のいちばん上に engine: lyria と書いた依頼書だけ、こちらで作る。お金がかかる（前払いの残高から）。
// 確かめた公式ページ（2026-11-21）：ai.google.dev の interactions/music-generation と aistudio.google.com/docs/music-generation。
//   POST /v1beta/interactions（ヘッダ x-goog-api-key・Api-Revision）に model と input。3.5 は response_format で audio。
//   返事の steps[].content[] に audio（base64・ふだんは MP3）と text（歌詞・構成）。44.1kHz ステレオ・SynthID 入り。
//   lyria-3-clip-preview は30秒固定 $0.04／lyria-3.5 は2分くらい $0.08。無料枠なし。1回で作るだけ（直しのやりとりなし）
import { createHash } from 'node:crypto';
import YAML from 'yaml';

export const LYRIA_MODELS = {
  'lyria-3-clip-preview': { usd: 0.04, takesMax: 3, label: '30秒' },
  'lyria-3.5': { usd: 0.08, takesMax: 2, label: '2分くらい' },
};
export const LYRIA_MODEL_DEF = 'lyria-3-clip-preview';
export const LYRIA_MAX_PROMPT = 2000;
export const LYRIA_MAX_PER_RUN = Number(process.env.LYRIA_MAX_PER_RUN || 12); // 1回の「声を作る」で呼ぶ上限（まちがいでお金を使いすぎないように）
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export function isLyria(text) {
  try { return (YAML.parse(text) || {}).engine === 'lyria'; } catch { return false; }
}

// 依頼書を1曲ずつの形に（曲 → 依頼書のいちばん上 → 決まりの値）
export function parseLyria(game, set, text) {
  const doc = YAML.parse(text) || {};
  const songs = Array.isArray(doc.songs) ? doc.songs : [];
  return {
    game, set,
    songs: songs.map((s) => ({
      id: String(s?.id ?? ''),
      model: String(s?.model ?? doc.model ?? LYRIA_MODEL_DEF),
      prompt: String(s?.prompt ?? doc.prompt ?? '').trim(),
      takes: Number(s?.takes ?? doc.takes ?? 1),
      loop: (s?.loop ?? doc.loop) !== false,
      wav: (s?.wav ?? doc.wav) === true,
    })),
  };
}

export function validateLyria(req) {
  const errs = [];
  const where = `requests/${req.game}/${req.set}`;
  if (req.songs.length === 0) errs.push(`${where}：songs がない`);
  const seen = new Set();
  req.songs.forEach((s, i) => {
    const at = `${where} の ${i + 1} 曲め（${s.id || 'id なし'}）`;
    if (!ID_RE.test(s.id)) errs.push(`${at}：id は小文字の英数字と - _ だけ（ファイル名になる）`);
    if (seen.has(s.id)) errs.push(`${at}：id が重なっている`);
    seen.add(s.id);
    const m = LYRIA_MODELS[s.model];
    if (!m) errs.push(`${at}：model は ${Object.keys(LYRIA_MODELS).join('・')}`);
    const len = [...s.prompt].length;
    if (len === 0 || len > LYRIA_MAX_PROMPT) errs.push(`${at}：prompt は 1〜${LYRIA_MAX_PROMPT} 字`);
    const max = m ? m.takesMax : 3;
    if (!Number.isInteger(s.takes) || s.takes < 1 || s.takes > max) errs.push(`${at}：takes は 1〜${max}`);
    if (s.wav && s.model !== 'lyria-3.5') errs.push(`${at}：wav は lyria-3.5 だけ`);
  });
  return errs;
}

// 同じモデル・文・wav なら作りなおさない（お金がかかるので、--all でも作りなおさない）。
// 本数とループは鍵に入れない：takes をふやしたら足した本だけ作り、loop はある音から作る（お金はかからない）
export function lyriaKey(s) {
  const pick = { e: 'lyria', lv: 1, model: s.model, prompt: s.prompt, wav: !!s.wav };
  return createHash('sha1').update(JSON.stringify(pick)).digest('hex').slice(0, 16);
}

// 1本め <id>・2本め <id>_2・3本め <id>_3（拡張子なしの名前）
export function songBases(id, takes) {
  return Array.from({ length: takes }, (_, i) => (i === 0 ? id : `${id}_${i + 1}`));
}

export function costUsd(songs) {
  return Math.round(songs.reduce((a, s) => a + (LYRIA_MODELS[s.model]?.usd || 0) * s.takes, 0) * 100) / 100;
}

export function lyriaBody(s) {
  const body = { model: s.model, input: s.prompt };
  if (s.model === 'lyria-3.5') body.response_format = s.wav ? { type: 'audio', mime_type: 'audio/wav' } : { type: 'audio' };
  return body;
}

// 返事から音と文を取り出す（steps[].content[] の形。前の形 outputs[] にも合わせる）
export function pickLyria(json) {
  const blocks = [];
  for (const st of json?.steps || []) if (st?.type === 'model_output' || !st?.type) blocks.push(...(st?.content || []));
  if (!blocks.length && Array.isArray(json?.outputs)) blocks.push(...json.outputs);
  const audio = [...blocks].reverse().find((b) => b?.type === 'audio' && b?.data);
  const text = blocks.filter((b) => b?.type === 'text' && b?.text).map((b) => b.text).join('\n\n').trim();
  if (!audio) return { audio: null, text, why: lyriaWhy(json, text) };
  const buf = Buffer.from(audio.data, 'base64');
  return { audio: buf, ext: audioExt(buf, audio.mime_type || audio.mimeType), text };
}

function lyriaWhy(json, text) {
  const e = json?.error?.message || json?.status_reason || json?.finish_reason || '';
  const s = String(json?.status || '');
  if (/safety|block|policy|prohibit|recitation/i.test(`${e} ${s} ${text}`)) return `安全フィルターで止まった（${(e || text || s).slice(0, 160)}）`;
  return `返事に音がない（${(e || s || text || '中身なし').slice(0, 160)}）`;
}

export function audioExt(buf, mime = '') {
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF') return 'wav';
  if (/wav/i.test(mime)) return 'wav';
  return 'mp3';
}

// 構成の文が JSON なら見やすく
export function prettyText(text) {
  if (!text) return '';
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

const URL = process.env.LYRIA_URL || 'https://generativelanguage.googleapis.com/v1beta/interactions'; // LYRIA_URL は手元のためしだけ
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WAITING = /^(in_progress|queued|pending|running|processing)$/i;

// 1本作る。429 は少し待って2回まで。402（残高切れ）・鍵・1日の上限は止める。まだ作っている返事なら作り終わるまで待つ
export async function synthLyria({ apiKey, song, fetchImpl = fetch, wait = sleep, pollMs = 10000, pollMax = 60 }) {
  if (!apiKey) throw new Error('Gemini の鍵（GitHub の Secrets の GEMINI_API_KEY）がない');
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey, 'Api-Revision': '2026-05-20' };
  for (let tryNo = 1; ; tryNo++) {
    const res = await fetchImpl(URL, { method: 'POST', headers, body: JSON.stringify(lyriaBody(song)), signal: AbortSignal.timeout(600000) });
    if (res.ok) {
      let json = await res.json();
      for (let i = 0; i < pollMax && !pickLyria(json).audio && WAITING.test(String(json?.status || '')) && json?.id; i++) {
        await wait(pollMs);
        const r2 = await fetchImpl(`${URL}/${encodeURIComponent(json.id)}`, { headers, signal: AbortSignal.timeout(120000) });
        if (!r2.ok) throw new Error(`Lyria ${r2.status}（作り終わりを待つ途中）：${(await r2.text()).slice(0, 160)}`);
        json = await r2.json();
      }
      const got = pickLyria(json);
      if (!got.audio) throw new Error(got.why);
      return got;
    }
    const body = (await res.text()).slice(0, 400);
    if (res.status === 402) throw new Error('Gemini API の残高切れ（402・しょーくんが AI Studio でチャージ → 「声を作る」をもう一度）');
    if (res.status === 429 && !/per ?day|PerDay|daily/i.test(body) && tryNo <= 2) { await wait(20000 * tryNo); continue; }
    if (res.status === 429) throw new Error('Gemini API の1日の回数を使いきった（あしたまた作る）');
    if (res.status === 400 && /API key not valid|API_KEY_INVALID/i.test(body)) throw new Error('Gemini の鍵がちがう（GEMINI_API_KEY を作りなおして入れなおす）');
    if (res.status === 400 && /safety|block|policy|prohibit|recitation/i.test(body)) throw new Error(`安全フィルターで止まった（prompt を見直す）：${body.slice(0, 160)}`);
    if (res.status === 403) throw new Error(`Lyria に断られた（403・鍵の権限か、この国・地域で使えない）：${body.slice(0, 160)}`);
    if (res.status >= 500 && tryNo <= 2) { await wait(15000 * tryNo); continue; }
    throw new Error(`Lyria ${res.status}：${body.slice(0, 200)}`);
  }
}
