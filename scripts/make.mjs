// 依頼書から声を作る（Actions「声を作る」が VOICEVOX のエンジンを横で動かして呼ぶ）
// out/<game>/<set>/<id>.mp3・manifest.json と out/<game>/CREDITS.md・credits.json を作る。
// 同じ声・文・数字の行は作りなおさない（--all で全部作りなおす）。依頼書から消えた行の音は消す
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync, mkdtempSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { listRequestFiles, loadVoices, parseRequest, validateRequest, findStyleId, lineKey, applyParams, countChoon, choonMode, wavSeconds, buildCredits, readText } from './lib.mjs';

const root = process.cwd();
const ENGINE = process.env.VOICEVOX_URL || 'http://127.0.0.1:50021';
const all = process.argv.includes('--all');

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
const engineVersion = (await (await api('/version')).text()).replace(/"/g, '').trim();
const speakers = await (await api('/speakers')).json();
const tmp = mkdtempSync(join(tmpdir(), 'koe-'));
const usedByGame = new Map();
let made = 0, kept = 0;
const summary = [];
const skipped = []; // 作れなかった行・依頼書（ほかは作る。前の音があれば残す・11/19【okashi-hiru】「1行のまちがいで全部止まる」）

for (const f of listRequestFiles(root)) {
  const dir = join(root, 'out', f.game, f.set);
  const mPath = join(dir, 'manifest.json');
  const old = existsSync(mPath) ? JSON.parse(readFileSync(mPath, 'utf8')) : { lines: [] };
  let req;
  try {
    req = parseRequest(f.game, f.set, readText(f.path));
    const errs = validateRequest(req, voices);
    if (errs.length) throw new Error(errs.join('\n'));
  } catch (e) {
    // 依頼書ごと作れない：out はさわらない（前の音のまま・クレジットも前の声で）
    skipped.push(`${f.rel}：依頼書ごと飛ばした（前の音のまま）\n${e.message}`);
    if (old.lines.length) usedByGame.set(f.game, (usedByGame.get(f.game) || []).concat(old.lines.map((l) => l.voice)));
    continue;
  }
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
  if (!names.length) continue;
  mkdirSync(join(root, 'out', game), { recursive: true });
  const c = buildCredits(game, names, voices);
  writeFileSync(join(root, 'out', game, 'CREDITS.md'), c.md);
  writeFileSync(join(root, 'out', game, 'credits.json'), JSON.stringify(c.json, null, 2) + '\n');
}

// 依頼書がなくなったセットの out は消す
const reqSets = new Set(listRequestFiles(root).map((f) => `${f.game}/${f.set}`));
const outRoot = join(root, 'out');
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
if (isDir(outRoot)) {
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
const msg = `VOICEVOX ${engineVersion}：作った ${made}・そのまま ${kept}\n${summary.join('\n')}${skipMsg}`;
console.log(msg);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `## 声を作った\n\n${msg}\n`, { flag: 'a' });
// 作れなかった行があれば、out を main に入れたあとで Actions を赤にする（make.yml の「作れなかった行」）
if (skipped.length) writeFileSync(process.env.KOE_SKIPPED || join(tmpdir(), 'koe-skipped.txt'), skipped.join('\n') + '\n');
