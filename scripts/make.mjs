// 依頼書から声を作る（Actions「声を作る」が VOICEVOX のエンジンを横で動かして呼ぶ）
// out/<game>/<set>/<id>.mp3・manifest.json と out/<game>/CREDITS.md・credits.json を作る。
// 同じ声・文・数字の行は作りなおさない（--all で全部作りなおす。Lyria の曲はお金がかかるので --all でも作りなおさない）。依頼書から消えた行の音は消す
// KOE_ONLY=requests/_test/lyria-（, で区切る）なら、その文字で始まる依頼書だけ作る（ためしの枝用。out の片づけ・クレジットはしない）
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync, mkdtempSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { listRequestFiles, loadVoices, parseRequest, validateRequest, findStyleId, lineKey, applyParams, countChoon, choonMode, wavSeconds, buildCredits, readText } from './lib.mjs';
import { isGemini, parseGemini, validateGemini, geminiKey, takeNames, synthGemini } from './gemini.mjs';
import { isLyria, parseLyria, validateLyria, lyriaKey, songBases, synthLyria, prettyText, LYRIA_MODELS, LYRIA_MAX_PER_RUN } from './lyria.mjs';

const root = process.cwd();
const ENGINE = process.env.VOICEVOX_URL || 'http://127.0.0.1:50021';
const all = process.argv.includes('--all');
const only = (process.env.KOE_ONLY || '').split(',').map((x) => x.trim()).filter(Boolean);
const picked = (f) => !only.length || only.some((p) => f.rel.startsWith(p));

async function api(path, opts = {}, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(ENGINE + path, { ...opts, signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      return res;
    } catch (e) {
      if (i >= tries) throw new Error(`${path}：${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

function toMp3(wav, mp3) {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-ar', '44100', '-codec:a', 'libmp3lame', '-q:a', '4', mp3]);
  if (r.status !== 0) throw new Error(`ffmpeg：${r.stderr}`);
}

const voices = loadVoices(readText(join(root, 'voices.yml')));
let engineVersion = '', speakers = null; // VOICEVOX は使うときに聞く（Gemini・Lyria だけの回はエンジンなしで動く）
async function engine() {
  if (speakers) return;
  engineVersion = (await (await api('/version')).text()).replace(/"/g, '').trim();
  speakers = await (await api('/speakers')).json();
}
const tmp = mkdtempSync(join(tmpdir(), 'koe-'));
const usedByGame = new Map();
let made = 0, kept = 0;
const summary = [];
const skipped = []; // 作れなかった行・依頼書（ほかは作る。前の音があれば残す・11/19【okashi-hiru】「1行のまちがいで全部止まる」）
let geminiMade = 0, geminiStop = ''; // Gemini で作った本数・回数を使いきった／残高切れならその回は呼ばない
let lyriaMade = 0, lyriaUsd = 0, lyriaStop = ''; // Lyria で作った本数と、かかったお金（ドル）

function probeSeconds(path) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { encoding: 'utf8' });
  const sec = Number(r.stdout.trim());
  if (r.status !== 0 || !(sec > 0)) throw new Error(`音として読めない（${path.split('/').pop()}）`);
  return Math.round(sec * 1000) / 1000;
}

function toMp3Stereo(src, mp3) {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-ac', '2', '-ar', '44100', '-codec:a', 'libmp3lame', '-b:a', '192k', mp3]);
  if (r.status !== 0) throw new Error(`ffmpeg：${r.stderr}`);
}

// ゲーム用のつなぎ目のないループ版（scripts/loop.py）
function makeLoop(src, out) {
  const r = spawnSync('python3', [join(root, 'scripts', 'loop.py'), src, out], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ループ版：${(r.stderr || '').trim().split('\n').pop()}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

// engine: lyria の依頼書（11/21）。takes 本ずつ <id>.mp3・<id>_2.mp3…（構成の文 .txt・ループ版 _loop.mp3）
// 1本ごとに残すので、とちゅうで止まっても作れた分は次の回に使う（お金をむだにしない）
async function makeLyria(f, raw, dir, mPath, old) {
  usedByGame.set(f.game, usedByGame.get(f.game) || []); // 曲はクレジットの義務なし（CREDITS.md は VOICEVOX の声だけ）
  let req;
  try {
    req = parseLyria(f.game, f.set, raw);
    const errs = validateLyria(req);
    if (errs.length) throw new Error(errs.join('\n'));
  } catch (e) {
    skipped.push(`${f.rel}：依頼書ごと飛ばした（前の音のまま）\n${e.message}`);
    return;
  }
  mkdirSync(dir, { recursive: true });
  const has = (x) => existsSync(join(dir, x));
  const oldById = new Map((old.songs || []).map((s) => [s.id, s]));
  const songs = [];
  for (const s of req.songs) {
    const key = lyriaKey(s);
    const prev = oldById.get(s.id);
    const prevTakes = prev && prev.key === key ? prev.takes : [];
    const bases = songBases(s.id, s.takes);
    const takes = [];
    let paid = 0;
    for (let t = 0; t < s.takes; t++) {
      let take = prevTakes[t] && has(prevTakes[t].file) ? { ...prevTakes[t] } : null;
      if (!take) {
        try {
          if (lyriaStop) throw new Error(lyriaStop);
          if (lyriaMade >= LYRIA_MAX_PER_RUN) throw new Error(`1回の上限 ${LYRIA_MAX_PER_RUN} 本に着いた（「声を作る」をもう一度動かすと続きを作る）`);
          const got = await synthLyria({ apiKey: process.env.GEMINI_API_KEY, song: s });
          lyriaMade++; paid++;
          lyriaUsd += LYRIA_MODELS[s.model].usd;
          const b = bases[t];
          take = { file: `${b}.mp3` };
          if (got.ext === 'wav') {
            writeFileSync(join(dir, `${b}.wav`), got.audio);
            toMp3Stereo(join(dir, `${b}.wav`), join(dir, take.file));
            take.wav = `${b}.wav`;
          } else writeFileSync(join(dir, take.file), got.audio);
          take.seconds = probeSeconds(join(dir, take.file));
          if (got.text) { writeFileSync(join(dir, `${b}.txt`), prettyText(got.text) + '\n'); take.text = `${b}.txt`; }
        } catch (e) {
          if (/残高切れ|使いきった|鍵|上限/.test(e.message)) lyriaStop = e.message;
          skipped.push(`${f.rel} の ${s.id}（${t + 1} 本め）：${e.message}（${takes.length ? '作れた分は残した' : prev ? '前の音のまま' : 'まだ音なし'}）`);
          break;
        }
      }
      if (s.loop && !(take.loop && has(take.loop.file))) {
        try {
          take.loop = { file: take.file.replace(/\.mp3$/, '_loop.mp3'), ...makeLoop(join(dir, take.wav || take.file), join(dir, take.file.replace(/\.mp3$/, '_loop.mp3'))) };
        } catch (e) {
          delete take.loop;
          skipped.push(`${f.rel} の ${s.id}（${t + 1} 本め）：${e.message}（原本はある）`);
        }
      }
      if (!s.loop) delete take.loop;
      takes.push(take);
    }
    if (takes.length) {
      songs.push({ id: s.id, model: s.model, prompt: s.prompt, loop: s.loop, wav: s.wav, key, takes });
      if (paid) made++; else kept++;
    } else if (prev) songs.push(prev); // ひとつも作れなかった：前の音のまま
  }
  const keep = new Set(songs.flatMap((s) => s.takes.flatMap((t) => [t.file, t.wav, t.text, t.loop?.file].filter(Boolean))));
  for (const name of readdirSync(dir)) if (/\.(mp3|wav|txt)$/.test(name) && !keep.has(name)) rmSync(join(dir, name));
  writeFileSync(mPath, JSON.stringify({ game: f.game, set: f.set, engine: 'lyria', request: f.rel, songs }, null, 2) + '\n');
  summary.push(`- ${f.rel}：${songs.length} 曲（Lyria）`);
}

// engine: gemini の依頼書（11/20）。takes 本ずつ作る（<id>.mp3・<id>_2.mp3・<id>_3.mp3。wav: true なら .wav も）
async function makeGemini(f, raw, dir, mPath, old) {
  let req;
  try {
    req = parseGemini(f.game, f.set, raw);
    const errs = validateGemini(req);
    if (errs.length) throw new Error(errs.join('\n'));
  } catch (e) {
    skipped.push(`${f.rel}：依頼書ごと飛ばした（前の音のまま）\n${e.message}`);
    usedByGame.set(f.game, usedByGame.get(f.game) || []);
    return;
  }
  mkdirSync(dir, { recursive: true });
  const oldById = new Map(old.lines.map((l) => [l.id, l]));
  const lines = [];
  for (const l of req.lines) {
    const key = geminiKey(req, l);
    const mp3s = takeNames(l.id, l.takes);
    const wavs = req.wav ? takeNames(l.id, l.takes, 'wav') : [];
    const prev = oldById.get(l.id);
    const prevOk = !!prev && (prev.files || [prev.file]).every((x) => existsSync(join(dir, x)));
    if (!all && prevOk && prev.key === key) {
      lines.push(prev);
      kept++;
      continue;
    }
    try {
      if (geminiStop) throw new Error(geminiStop);
      const seconds = [];
      for (let t = 0; t < l.takes; t++) {
        const wav = await synthGemini({ apiKey: process.env.GEMINI_API_KEY, model: req.model, line: l });
        const wavPath = join(tmp, `${f.game}-${f.set}-${l.id}-${t + 1}.wav`);
        writeFileSync(wavPath, wav);
        toMp3(wavPath, join(dir, mp3s[t]));
        if (req.wav) writeFileSync(join(dir, wavs[t]), wav);
        seconds.push(wavSeconds(wav));
        geminiMade++;
      }
      lines.push({ id: l.id, text: l.text, engine: 'gemini', model: req.model, voice: l.voice, style: l.style, takes: l.takes, file: mp3s[0], files: [...mp3s, ...wavs], seconds, key });
      made++;
    } catch (e) {
      if (/使いきった|残高切れ|鍵/.test(e.message)) geminiStop = e.message;
      if (prevOk) lines.push(prev);
      skipped.push(`${f.rel} の ${l.id}：${e.message}（${prevOk ? '前の音のまま' : 'まだ音なし'}）`);
    }
  }
  const keep = new Set(lines.flatMap((l) => l.files || [l.file]));
  for (const name of readdirSync(dir)) if (/\.(mp3|wav)$/.test(name) && !keep.has(name)) rmSync(join(dir, name));
  writeFileSync(mPath, JSON.stringify({ game: f.game, set: f.set, engine: 'gemini', model: req.model, request: f.rel, lines }, null, 2) + '\n');
  usedByGame.set(f.game, usedByGame.get(f.game) || []); // Gemini の声はクレジットの義務なし（CREDITS.md は VOICEVOX の声だけ）
  summary.push(`- ${f.rel}：${lines.length} 行（Gemini）`);
}

for (const f of listRequestFiles(root)) {
  if (!picked(f)) continue;
  const dir = join(root, 'out', f.game, f.set);
  const mPath = join(dir, 'manifest.json');
  const old = existsSync(mPath) ? JSON.parse(readFileSync(mPath, 'utf8')) : { lines: [] };
  const raw = readText(f.path);
  if (isGemini(raw)) {
    await makeGemini(f, raw, dir, mPath, old);
    continue;
  }
  if (isLyria(raw)) {
    await makeLyria(f, raw, dir, mPath, old);
    continue;
  }
  let req;
  try {
    req = parseRequest(f.game, f.set, raw);
    const errs = validateRequest(req, voices);
    if (errs.length) throw new Error(errs.join('\n'));
  } catch (e) {
    // 依頼書ごと作れない：out はさわらない（前の音のまま・クレジットも前の声で）
    skipped.push(`${f.rel}：依頼書ごと飛ばした（前の音のまま）\n${e.message}`);
    if (old.lines.length) usedByGame.set(f.game, (usedByGame.get(f.game) || []).concat(old.lines.map((l) => l.voice)));
    continue;
  }
  await engine();
  mkdirSync(dir, { recursive: true });
  const oldByKey = new Map(old.lines.map((l) => [l.id, l]));
  const lines = [];
  for (const l of req.lines) {
    const file = `${l.id}.mp3`;
    const prev = oldByKey.get(l.id);
    const keepPrev = (why) => {
      const has = prev && existsSync(join(dir, prev.file));
      if (has) lines.push(prev);
      skipped.push(`${f.rel} の ${l.id}：${why}（${has ? '前の音のまま' : 'まだ音なし'}）`);
    };
    const styleId = findStyleId(speakers, l.voice, l.style);
    if (styleId == null) {
      const styles = (speakers.find((s) => s.name === l.voice)?.styles || []).map((s) => s.name).join('・');
      keepPrev(`エンジンに「${l.voice}」の「${l.style}」がない（あるのは：${styles || 'なし'}）`);
      continue;
    }
    const key = lineKey(engineVersion, styleId, l);
    if (!all && prev && prev.key === key && existsSync(join(dir, file))) {
      lines.push(prev);
      kept++;
      continue;
    }
    try {
      const query = await (await api(`/audio_query?speaker=${styleId}&text=${encodeURIComponent(l.text)}`, { method: 'POST' })).json();
      if (l.nobasu != null && countChoon(query.accent_phrases, choonMode(l.text)) === 0) throw new Error('nobasu の ー の音がエンジンの読みに見つからない（text を見直す）');
      const wav = Buffer.from(await (await api(`/synthesis?speaker=${styleId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(applyParams(query, l)) })).arrayBuffer());
      const wavPath = join(tmp, `${f.game}-${f.set}-${l.id}.wav`);
      writeFileSync(wavPath, wav);
      toMp3(wavPath, join(dir, file));
      lines.push({ id: l.id, text: l.text, voice: l.voice, style: l.style, gobi: l.gobi, ...(l.nobasu != null ? { nobasu: l.nobasu } : {}), file, seconds: wavSeconds(wav), key });
      made++;
    } catch (e) {
      keepPrev(e.message);
    }
  }
  // 依頼書から消えた行の音を消す
  const keep = new Set(lines.map((l) => l.file));
  for (const name of readdirSync(dir)) if (name.endsWith('.mp3') && !keep.has(name)) rmSync(join(dir, name));
  writeFileSync(mPath, JSON.stringify({ game: f.game, set: f.set, engine: engineVersion, request: f.rel, lines }, null, 2) + '\n');
  const used = usedByGame.get(f.game) || [];
  usedByGame.set(f.game, used.concat(lines.map((l) => l.voice)));
  summary.push(`- ${f.rel}：${lines.length} 行`);
}

for (const [game, names] of usedByGame) {
  if (!names.length || only.length) continue;
  mkdirSync(join(root, 'out', game), { recursive: true });
  const c = buildCredits(game, names, voices);
  writeFileSync(join(root, 'out', game, 'CREDITS.md'), c.md);
  writeFileSync(join(root, 'out', game, 'credits.json'), JSON.stringify(c.json, null, 2) + '\n');
}

// 依頼書がなくなったセットの out は消す
const reqSets = new Set(listRequestFiles(root).map((f) => `${f.game}/${f.set}`));
const outRoot = join(root, 'out');
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
if (isDir(outRoot) && !only.length) {
  for (const game of readdirSync(outRoot)) {
    const gdir = join(outRoot, game);
    if (!isDir(gdir)) continue;
    for (const set of readdirSync(gdir)) {
      if (!isDir(join(gdir, set))) continue;
      if (!reqSets.has(`${game}/${set}`)) rmSync(join(gdir, set), { recursive: true, force: true });
    }
    if (!usedByGame.has(game)) rmSync(gdir, { recursive: true, force: true });
  }
}

const skipMsg = skipped.length ? `\n\n### 作れなかった（${skipped.length}）\n${skipped.map((x) => `- ${x}`).join('\n')}` : '';
const yen = Math.round(lyriaUsd * 155);
const msg = `VOICEVOX ${engineVersion || '（使わなかった）'}：作った ${made}（うち Gemini ${geminiMade} 本・Lyria ${lyriaMade} 本 約 $${lyriaUsd.toFixed(2)}＝約${yen}円）・そのまま ${kept}\n${summary.join('\n')}${skipMsg}`;
console.log(msg);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `## 声を作った\n\n${msg}\n`, { flag: 'a' });
// 作れなかった行があれば、out を main に入れたあとで Actions を赤にする（make.yml の「作れなかった行」）
if (skipped.length) writeFileSync(process.env.KOE_SKIPPED || join(tmpdir(), 'koe-skipped.txt'), skipped.join('\n') + '\n');
