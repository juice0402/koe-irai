// 声の依頼箱の共通の部品（エンジンにさわらない部分。テストは test/lib.test.mjs）
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import YAML from 'yaml';

// 声の作り方の数字（VOICEVOX の audio_query の名前・使ってよい幅・ないときの値）
export const PARAMS = {
  speed: { key: 'speedScale', min: 0.5, max: 2.0, def: 1.0 },
  pitch: { key: 'pitchScale', min: -0.15, max: 0.15, def: 0.0 },
  intonation: { key: 'intonationScale', min: 0.0, max: 2.0, def: 1.0 },
  volume: { key: 'volumeScale', min: 0.0, max: 2.0, def: 1.0 },
  pre: { key: 'prePhonemeLength', min: 0.0, max: 1.5, def: 0.05 },
  post: { key: 'postPhonemeLength', min: 0.0, max: 1.5, def: 0.1 },
};

export const TEST_GAME = '_test'; // ためし用。約束を確かめていない声も使えるが、ゲームには入れない
export const MAX_TEXT = 60;
export const MAX_LINES = 200;
const GAME_RE = /^(_test|[a-z0-9][a-z0-9-]{0,39})$/;
const SET_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export function loadVoices(text) {
  const doc = YAML.parse(text) || {};
  const list = Array.isArray(doc.voices) ? doc.voices : [];
  return list.map((v) => ({
    name: String(v.name || ''),
    ok: v.ok === true,
    credit: v.credit ? String(v.credit) : `VOICEVOX:${v.name}`,
    terms: v.terms ? String(v.terms) : '',
    checked: v.checked ? String(v.checked) : '',
    note: v.note ? String(v.note) : '',
  }));
}

// requests/<game>/<set>.yml を全部さがす
export function listRequestFiles(root) {
  const dir = join(root, 'requests');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const game of readdirSync(dir).sort()) {
    const gdir = join(dir, game);
    if (!statSync(gdir).isDirectory()) continue;
    for (const f of readdirSync(gdir).sort()) {
      if (/\.ya?ml$/.test(f)) out.push({ game, set: basename(f).replace(/\.ya?ml$/, ''), path: join(gdir, f), rel: relative(root, join(gdir, f)) });
    }
  }
  return out;
}

// 依頼書を読んで、1行ずつの形にそろえる（声・数字は行 → 依頼書の defaults → 決まりの値 の順）
export function parseRequest(game, set, text) {
  const doc = YAML.parse(text) || {};
  const defaults = doc.defaults || {};
  const lines = Array.isArray(doc.lines) ? doc.lines : [];
  return {
    game,
    set,
    lines: lines.map((l) => {
      const line = { id: String(l?.id ?? ''), text: String(l?.text ?? ''), voice: String(l?.voice ?? doc.voice ?? ''), style: String(l?.style ?? doc.style ?? '') };
      for (const [name, p] of Object.entries(PARAMS)) {
        const v = l?.[name] ?? defaults[name] ?? p.def;
        line[name] = Number(v);
      }
      return line;
    }),
  };
}

// 依頼書の点検（エンジンなしでできる分）。まちがいの一覧を返す
export function validateRequest(req, voices) {
  const errs = [];
  const where = `requests/${req.game}/${req.set}`;
  if (!GAME_RE.test(req.game)) errs.push(`${where}：ゲームの記号は小文字の英数字と - だけ（ためしは _test）`);
  if (!SET_RE.test(req.set)) errs.push(`${where}：ファイル名は小文字の英数字と - _ だけ`);
  if (req.lines.length === 0) errs.push(`${where}：lines がない`);
  if (req.lines.length > MAX_LINES) errs.push(`${where}：1つの依頼書は ${MAX_LINES} 行まで`);
  const seen = new Set();
  req.lines.forEach((l, i) => {
    const at = `${where} の ${i + 1} 行め（${l.id || 'id なし'}）`;
    if (!ID_RE.test(l.id)) errs.push(`${at}：id は小文字の英数字と - _ だけ（ファイル名になる）`);
    if (seen.has(l.id)) errs.push(`${at}：id が重なっている`);
    seen.add(l.id);
    const len = [...l.text].length;
    if (len === 0 || len > MAX_TEXT) errs.push(`${at}：text は 1〜${MAX_TEXT} 字`);
    if (!l.voice) errs.push(`${at}：voice（声の名前）がない`);
    if (!l.style) errs.push(`${at}：style（声の種類）がない`);
    const v = voices.find((x) => x.name === l.voice);
    if (l.voice && !v) errs.push(`${at}：voice「${l.voice}」は voices.yml にない`);
    else if (v && !v.ok && req.game !== TEST_GAME) errs.push(`${at}：voice「${l.voice}」はまだ約束を確かめていない（voices.yml の ok が true の声だけ。ためしは requests/_test/）`);
    for (const [name, p] of Object.entries(PARAMS)) {
      const x = l[name];
      if (!Number.isFinite(x) || x < p.min || x > p.max) errs.push(`${at}：${name} は ${p.min}〜${p.max}`);
    }
  });
  return errs;
}

// エンジンの話者一覧から、声の名前と種類で番号をさがす
export function findStyleId(speakers, voice, style) {
  const sp = speakers.find((s) => s.name === voice);
  if (!sp) return null;
  const st = (sp.styles || []).find((s) => s.name === style);
  return st ? st.id : null;
}

// 同じ声・同じ文・同じ数字なら同じ鍵（作りなおすかを決める）
export function lineKey(engineVersion, styleId, line) {
  const pick = { engine: engineVersion, styleId, text: line.text };
  for (const name of Object.keys(PARAMS)) pick[name] = line[name];
  return createHash('sha1').update(JSON.stringify(pick)).digest('hex').slice(0, 16);
}

export function applyParams(query, line) {
  const q = { ...query };
  for (const [name, p] of Object.entries(PARAMS)) q[p.key] = line[name];
  q.outputStereo = false;
  return q;
}

// WAV の長さ（秒）。ヘッダから data の大きさを読む
export function wavSeconds(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return 0;
  let off = 12, rate = 0, block = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') { rate = buf.readUInt32LE(off + 12); block = buf.readUInt16LE(off + 20); }
    if (id === 'data') return rate && block ? Math.round((size / (rate * block)) * 1000) / 1000 : 0;
    off += 8 + size + (size % 2);
  }
  return 0;
}

// ゲームごとのクレジット（使った声だけ）
export function buildCredits(game, usedNames, voices) {
  const used = [...new Set(usedNames)].sort((a, b) => a.localeCompare(b, 'ja'));
  const rows = used.map((n) => voices.find((v) => v.name === n) || { name: n, credit: `VOICEVOX:${n}`, terms: '', checked: '' });
  const line = rows.length ? `音声合成：${rows.map((r) => r.credit).join('、')}` : '（まだ声がない）';
  const md = [
    `# ${game} の声のクレジット`,
    '',
    '自動で作るファイル（手で直さない）。ゲームのクレジット画面（設定やスタッフロール）に、次の1行をそのまま書く。',
    '',
    line,
    '',
    '## 声ごとの約束',
    ...rows.map((r) => `- ${r.name}：${r.terms || '（約束のページは voices.yml に）'}${r.checked ? `（確かめた日 ${r.checked}）` : ''}`),
    '',
  ].join('\n');
  return { line, md, json: { game, line, voices: rows.map((r) => ({ name: r.name, credit: r.credit, terms: r.terms, checked: r.checked })) } };
}

export function readText(path) {
  return readFileSync(path, 'utf8');
}
