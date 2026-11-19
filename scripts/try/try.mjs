// ためし（main に入れない）：のばす音の直し方をくらべる。koe-try/** の枝に push すると try.yml が動き、out-try/ を artifact で出す
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findStyleId, choonAtEnd } from '../lib.mjs';
const ENGINE = process.env.VOICEVOX_URL || 'http://127.0.0.1:50021';
const OUT = 'out-try';
mkdirSync(OUT, { recursive: true });
const api = async (p, o = {}) => { const r = await fetch(ENGINE + p, o); if (!r.ok) throw new Error(p + ' ' + r.status); return r; };
const speakers = await (await api('/speakers')).json();
const MUSEI = { A: 'a', I: 'i', U: 'u', E: 'e', O: 'o' };
const boin = (m) => MUSEI[m?.vowel] || m?.vowel;
const clone = (ph) => ph.map((p) => ({ ...p, moras: p.moras.map((m) => ({ ...m })) }));
function choonIdx(all, atEnd) {
  const idx = [];
  all.forEach((m, i) => { if (m.text === 'ー') return idx.push(i); if (i && !m.consonant) { const v = boin(m); if ('aiueo'.includes(v) && v.length === 1 && v === boin(all[i - 1])) idx.push(i); } });
  return idx.length ? (atEnd ? idx[idx.length - 1] : idx[0]) : -1;
}
const near = (all, k) => { for (let j = k - 1; j >= 0; j--) if (all[j].pitch > 0) return all[j].pitch; for (let j = k + 1; j < all.length; j++) if (all[j].pitch > 0) return all[j].pitch; return 0; };
// v0：いまの main（ー だけ声にもどす）
function v0(ph, sec, atEnd) { const o = clone(ph), all = o.flatMap((p) => p.moras), i = choonIdx(all, atEnd); if (i < 0) return o; const m = all[i];
  if (MUSEI[m.vowel]) m.vowel = MUSEI[m.vowel]; if (!(m.pitch > 0)) { for (let j = i - 1; j >= 0; j--) if (all[j].pitch > 0) { m.pitch = all[j].pitch; break; } } m.vowel_length = sec; return o; }
// v1：ー と前の同じ母音の音（う・む）を声にもどす・高さは近くの声のある音
function v1(ph, sec, atEnd) { const o = clone(ph), all = o.flatMap((p) => p.moras), i = choonIdx(all, atEnd); if (i < 0) return o; const v = boin(all[i]);
  const fix = [i]; for (let j = i - 1; j >= 0 && boin(all[j]) === v; j--) fix.push(j);
  for (const k of fix.sort((a, b) => a - b)) { const x = all[k]; if (MUSEI[x.vowel]) x.vowel = MUSEI[x.vowel]; if (!(x.pitch > 0)) x.pitch = near(all, k); }
  all[i].vowel_length = sec; return o; }
// v2：v1 ＋ ー の高さを前の音から 0.1 より下げない
function v2(ph, sec, atEnd) { const o = v1(ph, sec, atEnd), all = o.flatMap((p) => p.moras), i = choonIdx(all, atEnd); if (i < 1) return o; const p = all[i - 1].pitch; if (p > 0 && all[i].pitch < p - 0.1) all[i].pitch = p - 0.1; return o; }
// v3：v2 ＋ のばす所を 0.2 秒ずつの同じ母音の音に分ける（長い1音は小さくなりやすい？）
function v3(ph, sec, atEnd) { const o = v2(ph, sec, atEnd), all = o.flatMap((p) => p.moras), i = choonIdx(all, atEnd); if (i < 0) return o; const m = all[i]; const n = Math.max(1, Math.round(sec / 0.2));
  for (const p of o) { const k = p.moras.indexOf(m); if (k < 0) continue; p.moras.splice(k, 1, ...Array.from({ length: n }, () => ({ ...m, vowel_length: sec / n }))); } return o; }
const VARIANTS = { v0, v1, v2, v3 };
const CASES = [
  { id: 'hono', text: 'うーん', voice: '春日部つむぎ', style: 'ノーマル', pitch: 0.03, speed: 1.0, intonation: 1.4, nobasu: 1.0 },
  { id: 'hono-mun', text: 'むーん', voice: '春日部つむぎ', style: 'ノーマル', pitch: 0.03, speed: 1.0, intonation: 1.4, nobasu: 1.0 },
  { id: 'mina', text: 'うーん', voice: '冥鳴ひまり', style: 'ノーマル', pitch: -0.05, speed: 0.85, intonation: 0.65, nobasu: 0.85 },
  { id: 'waka', text: 'うーん', voice: 'WhiteCUL', style: 'ノーマル', pitch: 0.07, speed: 0.78, intonation: 1.3, nobasu: 0.78 },
  { id: 'hono-achaa', text: 'あちゃー', voice: '春日部つむぎ', style: 'ノーマル', pitch: 0.06, speed: 1.0, intonation: 1.5, nobasu: 0.8 },
];
const dump = {};
for (const c of CASES) {
  const sid = findStyleId(speakers, c.voice, c.style);
  const q = await (await api(`/audio_query?speaker=${sid}&text=${encodeURIComponent(c.text)}`, { method: 'POST' })).json();
  dump[c.id] = { engine: q.accent_phrases.flatMap((p) => p.moras).map((m) => [m.text, m.consonant, m.vowel, +m.vowel_length.toFixed(3), +m.pitch.toFixed(2)]) };
  for (const [vn, fn] of Object.entries(VARIANTS)) {
    const ph = fn(q.accent_phrases, c.nobasu, choonAtEnd(c.text));
    dump[c.id][vn] = ph.flatMap((p) => p.moras).map((m) => [m.text, m.vowel, +m.vowel_length.toFixed(3), +m.pitch.toFixed(2)]);
    const body = { ...q, accent_phrases: ph, speedScale: c.speed, pitchScale: c.pitch, intonationScale: c.intonation, volumeScale: 1, prePhonemeLength: 0.05, postPhonemeLength: 0.1, outputStereo: false };
    const wav = Buffer.from(await (await api(`/synthesis?speaker=${sid}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).arrayBuffer());
    const w = join(OUT, `${c.id}-${vn}.wav`); writeFileSync(w, wav);
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', w, '-ac', '1', '-ar', '44100', '-codec:a', 'libmp3lame', '-q:a', '4', join(OUT, `${c.id}-${vn}.mp3`)]);
  }
}
writeFileSync(join(OUT, 'moras.json'), JSON.stringify(dump, null, 1));
console.log(JSON.stringify(dump));
