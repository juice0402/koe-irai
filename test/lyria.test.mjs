import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLyria, parseLyria, validateLyria, lyriaKey, songBases, costUsd, lyriaBody, pickLyria, audioExt, prettyText, synthLyria, LYRIA_MODEL_DEF } from '../scripts/lyria.mjs';

const doc = `engine: lyria\nmodel: lyria-3-clip-preview\nprompt: Cozy music box, 100 BPM. Instrumental only, no vocals.\ntakes: 3\nsongs:\n  - {id: hiru-a}\n  - {id: hiru-full, model: lyria-3.5, takes: 2, loop: false, prompt: A longer cozy piece.}\n`;

test('Lyria の依頼書：engine で見分け・曲 → いちばん上 → 決まりの値', () => {
  assert.equal(isLyria(doc), true);
  assert.equal(isLyria('engine: gemini\nlines: []\n'), false);
  assert.equal(isLyria(':::'), false);
  const r = parseLyria('_test', 'l1', doc);
  assert.deepEqual(r.songs.map((s) => [s.id, s.model, s.takes, s.loop]), [['hiru-a', 'lyria-3-clip-preview', 3, true], ['hiru-full', 'lyria-3.5', 2, false]]);
  assert.equal(r.songs[0].prompt, 'Cozy music box, 100 BPM. Instrumental only, no vocals.');
  assert.deepEqual(validateLyria(r), []);
  assert.equal(parseLyria('_test', 'l2', 'engine: lyria\nprompt: x\nsongs: [{id: a}]\n').songs[0].model, LYRIA_MODEL_DEF);
  assert.equal(costUsd(r.songs), 0.28); // 0.04×3 ＋ 0.08×2
});

test('Lyria の点検：モデル・本数・文・id・wav', () => {
  const r = parseLyria('_test', 'l1', `engine: lyria\nsongs:\n  - {id: A, model: lyria-9}\n  - {id: b, prompt: x, takes: 4}\n  - {id: b, prompt: x, model: lyria-3.5, takes: 3}\n  - {id: c, prompt: x, wav: true}\n`);
  const e = validateLyria(r).join('\n');
  assert.match(e, /id は小文字の英数字/);
  assert.match(e, /model は lyria-3-clip-preview・lyria-3.5/);
  assert.match(e, /prompt は 1〜2000 字/);
  assert.match(e, /takes は 1〜3/);
  assert.match(e, /takes は 1〜2/);
  assert.match(e, /id が重なっている/);
  assert.match(e, /wav は lyria-3.5 だけ/);
  assert.match(validateLyria(parseLyria('_test', 'x', 'engine: lyria\n')).join(''), /songs がない/);
});

test('Lyria：鍵は本数とループで変わらない（足した本だけ作る）・ファイル名', () => {
  const [a, b] = parseLyria('_test', 'l1', doc).songs;
  assert.equal(lyriaKey(a), lyriaKey({ ...a, takes: 1, loop: false }));
  assert.notEqual(lyriaKey(a), lyriaKey({ ...a, prompt: a.prompt + '!' }));
  assert.notEqual(lyriaKey(b), lyriaKey({ ...b, wav: true }));
  assert.deepEqual(songBases('hiru', 3), ['hiru', 'hiru_2', 'hiru_3']);
});

test('Lyria：送る中身（3.5 は response_format）', () => {
  assert.deepEqual(lyriaBody({ model: 'lyria-3-clip-preview', prompt: 'p' }), { model: 'lyria-3-clip-preview', input: 'p' });
  assert.deepEqual(lyriaBody({ model: 'lyria-3.5', prompt: 'p' }).response_format, { type: 'audio' });
  assert.deepEqual(lyriaBody({ model: 'lyria-3.5', prompt: 'p', wav: true }).response_format, { type: 'audio', mime_type: 'audio/wav' });
});

const mp3 = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 1, 2, 3]);
const okJson = { id: 'i1', status: 'completed', steps: [{ type: 'user_input', content: [{ type: 'text', text: 'p' }] }, { type: 'model_output', content: [{ type: 'text', text: '{"sections":[{"name":"intro"}]}' }, { type: 'audio', data: mp3.toString('base64') }] }] };

test('Lyria：返事から音と構成の文を取り出す', () => {
  const g = pickLyria(okJson);
  assert.deepEqual(g.audio, mp3);
  assert.equal(g.ext, 'mp3');
  assert.match(g.text, /sections/);
  assert.match(prettyText(g.text), /\n {2}"sections"/);
  assert.equal(pickLyria({ outputs: [{ type: 'audio', data: mp3.toString('base64') }] }).ext, 'mp3');
  assert.equal(audioExt(Buffer.from('RIFF....WAVE')), 'wav');
  assert.match(pickLyria({ status: 'failed', error: { message: 'Blocked by safety filters' } }).why, /安全フィルター/);
  assert.match(pickLyria({ status: 'completed', steps: [] }).why, /返事に音がない/);
});

const res = (status, body) => ({ ok: status === 200, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

test('Lyria の呼び出し：ヘッダ・402 は残高切れ・429 は待ってやり直し・安全フィルター', async () => {
  let seen;
  const g = await synthLyria({ apiKey: 'k', song: { model: 'lyria-3.5', prompt: 'p' }, fetchImpl: async (u, o) => { seen = o; return res(200, okJson); } });
  assert.equal(g.ext, 'mp3');
  assert.equal(seen.headers['x-goog-api-key'], 'k');
  assert.equal(seen.headers['Api-Revision'], '2026-05-20');
  assert.equal(JSON.parse(seen.body).model, 'lyria-3.5');
  await assert.rejects(synthLyria({ apiKey: 'k', song: { model: 'lyria-3-clip-preview', prompt: 'p' }, fetchImpl: async () => res(402, 'Payment required') }), /残高切れ/);
  await assert.rejects(synthLyria({ apiKey: '', song: {} }), /鍵/);
  let n = 0;
  const g2 = await synthLyria({ apiKey: 'k', song: { model: 'lyria-3-clip-preview', prompt: 'p' }, wait: async () => {}, fetchImpl: async () => (++n < 2 ? res(429, 'rate limit per minute') : res(200, okJson)) });
  assert.equal(n, 2);
  assert.equal(g2.ext, 'mp3');
  await assert.rejects(synthLyria({ apiKey: 'k', song: { model: 'lyria-3-clip-preview', prompt: 'p' }, fetchImpl: async () => res(400, 'Request blocked by safety filters') }), /安全フィルター/);
  await assert.rejects(synthLyria({ apiKey: 'k', song: { model: 'lyria-3-clip-preview', prompt: 'p' }, fetchImpl: async () => res(200, { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Content blocked: policy' }] }] }) }), /安全フィルター/);
});

test('Lyria の呼び出し：まだ作っている返事なら、作り終わるまで待つ', async () => {
  const urls = [];
  let n = 0;
  const g = await synthLyria({
    apiKey: 'k', song: { model: 'lyria-3.5', prompt: 'p' }, wait: async () => {},
    fetchImpl: async (u) => { urls.push(u); n++; return res(200, n < 3 ? { id: 'abc', status: 'in_progress' } : okJson); },
  });
  assert.equal(g.ext, 'mp3');
  assert.match(urls[1], /\/interactions\/abc$/);
});
