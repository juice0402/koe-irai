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

// 語尾（VOICEVOX は言い切りの読み方で語尾が下がる。掛け声は下げないほうが元気に聞こえる）
// sagaru＝エンジンのまま・taira＝下げない・agaru＝少し上げる・auto＝語尾の文字でえらぶ（書かなければ auto）
export const GOBI = ['sagaru', 'taira', 'agaru'];
export const GOBI_DEF = 'sagaru';
export const GOBI_AUTO = 'auto';

// おまかせ（11/17 しょーくんが聞きくらべて：そこだっ！＝agaru・決めるぜ！＝taira・いっくよー！＝agaru）
// ？で終わる → sagaru（エンジンが問いかけで上げる）・ー っ ッ で終わる → agaru・ほか → taira
export function autoGobi(text) {
  const t = String(text).trim();
  if (/[？?]$/.test(t)) return 'sagaru';
  const body = t.replace(/[！!。．.、,～〜♪…\s]+$/u, '');
  return /[ーっッ]$/.test(body) ? 'agaru' : 'taira';
}
const TAIRA_DROP = 0.08; // taira：いちばん高い音からこれより下げない（pitch は対数。0.1 で約1割）
const AGARU_UP = 0.15; // agaru：最後の音をいちばん高い音よりこれだけ上げる

// のばす音（11/19 しょーくん「うーんを1秒くらいにのばしたい」）：text の ー（長音）1つの母音を、決めた秒の長さにする。
// ー をいくつ重ねても VOICEVOX はまとめて短く読み、重ねすぎると息の音（無声）になるため
export const NOBASU_MIN = 0.05;
export const NOBASU_MAX = 3.0;

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
      const gobi = String(l?.gobi ?? defaults.gobi ?? GOBI_AUTO);
      line.gobi = gobi === GOBI_AUTO ? autoGobi(line.text) : gobi;
      line.nobasu = l?.nobasu == null ? null : Number(l.nobasu); // 行ごとだけ（defaults には書かない）
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
    if (!GOBI.includes(l.gobi)) errs.push(`${at}：gobi は ${[GOBI_AUTO, ...GOBI].join('・')}`);
    if (l.nobasu != null) {
      if (!Number.isFinite(l.nobasu) || l.nobasu < NOBASU_MIN || l.nobasu > NOBASU_MAX) errs.push(`${at}：nobasu は ${NOBASU_MIN}〜${NOBASU_MAX}（秒）`);
      const n = [...l.text].filter((c) => c === 'ー').length;
      if (n !== 1) errs.push(`${at}：nobasu の行は、text に ー を1つだけ書く（いま ${n} こ。重ねると息の音になる）`);
      const chars = [...l.text];
      const before = chars[chars.indexOf('ー') - 1];
      if (n === 1 && (!before || /[っッ、。，．！？!?…・「」\s]/u.test(before))) errs.push(`${at}：nobasu の ー の前が「${before ?? 'なし'}」なので、のばせない（っ のあとや文の頭の ー は、エンジンが音にしない。あ・う・ん などのあとに ー を書く）`);
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
  if (line.gobi && line.gobi !== GOBI_DEF) pick.gobi = line.gobi; // sagaru の行は前の鍵のまま（作りなおさない）
  if (line.nobasu != null) { pick.nobasu = line.nobasu; pick.nv = 2; } // nv：のばし方を変えたら上げる（nobasu の行だけ作りなおす）
  return createHash('sha1').update(JSON.stringify(pick)).digest('hex').slice(0, 16);
}

export function applyParams(query, line) {
  const q = { ...query };
  for (const [name, p] of Object.entries(PARAMS)) q[p.key] = line[name];
  q.outputStereo = false;
  let phrases = query.accent_phrases;
  if (line.nobasu != null) phrases = stretchChoon(phrases, line.nobasu, choonAtEnd(line.text), choonMode(line.text));
  if (line.gobi) phrases = shapeGobi(phrases, line.gobi);
  q.accent_phrases = phrases;
  return q;
}

// ー（長音）の音をさがす。エンジンは ー を「前の音と同じ母音で、子音のない音」にする（例：うーん → ウ・ウ・ン、あちゃー → ア・チャ・ア）
// text の ー が終わりにあれば最後の候補、ほかは最初の候補（nobasu の行は ー が1つだけ）
const MUSEI = { A: 'a', I: 'i', U: 'u', E: 'e', O: 'o' };
const boin = (m) => MUSEI[m?.vowel] || m?.vowel;
// んー（ん のあとの ー）は、ん（N）の音そのものをのばす（11/19 しょーくん「うーん」→「んー」：つむぎ・ひまりの声は「う」が弱く息っぽいため）
export function choonMode(text) {
  const c = [...String(text)];
  return /[んン]/u.test(c[c.indexOf('ー') - 1] || '') ? 'N' : 'boin';
}
function choonIndexes(all, mode = 'boin') {
  const idx = [];
  if (mode === 'N') {
    all.forEach((m, i) => { if (m.vowel === 'N') idx.push(i); });
    return idx;
  }
  all.forEach((m, i) => {
    if (m.text === 'ー') return idx.push(i);
    if (i === 0 || m.consonant) return;
    const v = boin(m);
    if ('aiueo'.includes(v) && v.length === 1 && v === boin(all[i - 1])) idx.push(i);
  });
  return idx;
}
export function choonAtEnd(text) {
  return String(text).replace(/[！!？?。．.、,～〜♪…\s]+$/u, '').endsWith('ー');
}

// ー（長音）の音の数（make.mjs が nobasu の行で 0 なら止める）
export function countChoon(phrases, mode = 'boin') {
  return choonIndexes((Array.isArray(phrases) ? phrases : []).flatMap((p) => p.moras || []), mode).length;
}

// ー の母音を sec 秒にのばす。息の音（無声＝母音が大文字・高さ 0）になっていたら声にもどす。元の query は変えない
export function stretchChoon(phrases, sec, atEnd = false, mode = 'boin') {
  if (!Array.isArray(phrases)) return phrases;
  const out = phrases.map((p) => ({ ...p, moras: (p.moras || []).map((m) => ({ ...m })) }));
  const all = out.flatMap((p) => p.moras);
  if (mode === 'N') return stretchN(out, sec, atEnd);
  const idx = choonIndexes(all, mode);
  if (idx.length === 0) return out;
  const i = atEnd ? idx[idx.length - 1] : idx[0];
  const m = all[i];
  if (MUSEI[m.vowel]) m.vowel = MUSEI[m.vowel];
  if (!(m.pitch > 0)) {
    const prev = all.slice(0, i).reverse().find((x) => x.pitch > 0);
    if (prev) m.pitch = prev.pitch;
  }
  m.vowel_length = sec;
  return out;
}

// んー：エンジンは ン・ン の2つの音にする。2つめ（や1つめ）だけをのばすと、声によって途中で小さくなる
// （11/19 ためしの枝 koe-try/uun：ひまりは2つめ・つむぎは1つめをのばすと -43〜-52dB）。
// ン が続く所を1つの ン にまとめ、高さを最初と最後のあいだにして、sec 秒にする（どちらの声も -26〜-41dB で止まらない）
function stretchN(out, sec, atEnd) {
  const all = out.flatMap((p) => p.moras);
  const runs = [];
  all.forEach((m, i) => {
    if (m.vowel !== 'N') return;
    if (i > 0 && all[i - 1].vowel === 'N' && runs.length) runs[runs.length - 1].push(m);
    else runs.push([m]);
  });
  if (runs.length === 0) return out;
  const run = atEnd ? runs[runs.length - 1] : runs[0];
  const [first, ...rest] = run;
  const last = run[run.length - 1];
  if (first.pitch > 0 && last.pitch > 0) first.pitch = (first.pitch + last.pitch) / 2;
  else if (!(first.pitch > 0)) first.pitch = last.pitch || first.pitch;
  first.vowel_length = sec;
  const drop = new Set(rest);
  const res = out.map((p) => ({ ...p, moras: p.moras.filter((m) => !drop.has(m)) })).filter((p) => p.moras.length);
  for (const p of res) p.accent = Math.max(1, Math.min(p.accent || 1, p.moras.length));
  return res;
}

// 語尾の高さを直す：最後のアクセント句の、いちばん高い音より後ろの音を下げすぎないようにする
// （無声の音〔ッ・無声化した母音〕は pitch 0 なので数えない）。元の query は変えない
export function shapeGobi(phrases, gobi) {
  if (!Array.isArray(phrases) || phrases.length === 0 || gobi === GOBI_DEF) return phrases;
  const out = phrases.map((p) => ({ ...p, moras: (p.moras || []).map((m) => ({ ...m })) }));
  const voiced = out[out.length - 1].moras.filter((m) => m.pitch > 0);
  if (voiced.length < 2) return out;
  let peakAt = 0;
  voiced.forEach((m, i) => { if (m.pitch > voiced[peakAt].pitch) peakAt = i; });
  const peak = voiced[peakAt].pitch;
  for (let i = peakAt + 1; i < voiced.length; i++) voiced[i].pitch = Math.max(voiced[i].pitch, peak - TAIRA_DROP);
  if (gobi === 'agaru') voiced[voiced.length - 1].pitch = peak + AGARU_UP;
  return out;
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
