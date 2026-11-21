// 依頼書の点検（エンジンなし）。PR のたびに Actions が動かす。まちがいがあれば一覧を出して止まる
// Lyria の依頼書は、新しく作る本数と、かかるお金のめやすも出す（out の manifest.json とくらべる）
import { existsSync, readFileSync } from 'node:fs';
import { listRequestFiles, loadVoices, parseRequest, validateRequest, readText } from './lib.mjs';
import { isGemini, parseGemini, validateGemini } from './gemini.mjs';
import { isLyria, parseLyria, validateLyria, lyriaKey, LYRIA_MODELS } from './lyria.mjs';

const root = process.cwd();
const voices = loadVoices(readText(`${root}/voices.yml`));
const errs = [];
let newTakes = 0, usd = 0;
for (const f of listRequestFiles(root)) {
  try {
    const raw = readText(f.path);
    if (isLyria(raw)) {
      const req = parseLyria(f.game, f.set, raw);
      const e = validateLyria(req);
      errs.push(...e);
      if (e.length) continue;
      const mPath = `${root}/out/${f.game}/${f.set}/manifest.json`;
      const old = existsSync(mPath) ? JSON.parse(readFileSync(mPath, 'utf8')) : {};
      for (const s of req.songs) {
        const prev = (old.songs || []).find((x) => x.id === s.id && x.key === lyriaKey(s));
        const n = Math.max(0, s.takes - (prev ? prev.takes.length : 0));
        newTakes += n;
        usd += n * LYRIA_MODELS[s.model].usd;
      }
      continue;
    }
    errs.push(...(isGemini(raw) ? validateGemini(parseGemini(f.game, f.set, raw)) : validateRequest(parseRequest(f.game, f.set, raw), voices)));
  } catch (e) {
    errs.push(`${f.rel}：YAML として読めない（${e.message.split('\n')[0]}）`);
  }
}
if (errs.length) {
  console.log(`点検で止まった（${errs.length}）`);
  for (const e of errs) console.log(`- ${e}`);
  process.exit(1);
}
console.log('点検 OK');
if (newTakes) console.log(`Lyria：新しく作る曲 ${newTakes} 本・約 $${usd.toFixed(2)}（約${Math.round(usd * 155)}円・前払いの残高から）`);
