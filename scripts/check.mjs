// 依頼書の点検（エンジンなし）。PR のたびに Actions が動かす。まちがいがあれば一覧を出して止まる
import { listRequestFiles, loadVoices, parseRequest, validateRequest, readText } from './lib.mjs';

const root = process.cwd();
const voices = loadVoices(readText(`${root}/voices.yml`));
const errs = [];
for (const f of listRequestFiles(root)) {
  try {
    errs.push(...validateRequest(parseRequest(f.game, f.set, readText(f.path)), voices));
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
