// エンジンに入っている声の一覧と、声ごとの約束（利用規約）の文を policies/ に書き出す
// （Actions「声の一覧と約束を取る」から。voices.yml の ok を決めるときに読む）
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ENGINE = process.env.VOICEVOX_URL || 'http://127.0.0.1:50021';
const get = async (p) => {
  const r = await fetch(ENGINE + p, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`${p}：${r.status}`);
  return r;
};

const dir = join(process.cwd(), 'policies');
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) if (f.endsWith('.md')) rmSync(join(dir, f));

const version = (await (await get('/version')).text()).replace(/"/g, '').trim();
const speakers = await (await get('/speakers')).json();
const list = [];
for (const s of speakers) {
  const info = await (await get(`/speaker_info?speaker_uuid=${s.speaker_uuid}`)).json();
  const file = `${s.name.replace(/[\\/:*?"<>|]/g, '_')}.md`;
  writeFileSync(join(dir, file), `# ${s.name} の約束（VOICEVOX ${version} のエンジンから取った文）\n\n${info.policy || '（文なし）'}\n`);
  list.push({ name: s.name, uuid: s.speaker_uuid, styles: s.styles.map((st) => ({ name: st.name, id: st.id })), policy: `policies/${file}` });
}
writeFileSync(join(dir, 'speakers.json'), JSON.stringify({ engine: version, speakers: list }, null, 2) + '\n');
console.log(`VOICEVOX ${version}：声 ${list.length}`);
