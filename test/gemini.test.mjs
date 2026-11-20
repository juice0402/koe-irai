import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGemini, parseGemini, validateGemini, geminiKey, takeNames, geminiBody, audioFromResponse, pcmToWav, synthGemini, GEMINI_MODEL_DEF } from '../scripts/gemini.mjs';
import { wavSeconds } from '../scripts/lib.mjs';

const doc = `engine: gemini\nvoice: Leda\nstyle: 元気な女の子、明るく弾む感じで\ntakes: 3\nlines:\n  - {id: hello, text: こんにちは！今日もがんばろうね！}\n  - {id: nare, text: むかしむかし、ある森に。, voice: Kore, style: 落ち着いた語り, takes: 1}\n`;

test('Gemini の依頼書：engine で見分け・行 → いちばん上 → 決まりの値', () => {
  assert.equal(isGemini(doc), true);
  assert.equal(isGemini('voice: 青山龍星\nlines: []\n'), false);
  assert.equal(isGemini(':::'), false);
  const r = parseGemini('_test', 'g1', doc);
  assert.equal(r.model, GEMINI_MODEL_DEF);
  assert.equal(r.wav, false);
  assert.deepEqual(r.lines.map((l) => [l.voice, l.takes]), [['Leda', 3], ['Kore', 1]]);
  assert.equal(r.lines[0].style, '元気な女の子、明るく弾む感じで');
  assert.deepEqual(validateGemini(r), []);
});

test('Gemini の点検：声の名前・本数・長さ・モデル', () => {
  const r = parseGemini('_test', 'g1', `engine: gemini\nmodel: gemini-2.0-tts\nlines:\n  - {id: a, text: あ, voice: ないよ}\n  - {id: a, text: '', voice: Kore, takes: 4}\n`);
  const e = validateGemini(r).join('\n');
  assert.match(e, /model は gemini-3.8-flash-tts・gemini-3.8-flash-lite-tts/);
  assert.match(e, /voice「ないよ」は Gemini の声にない/);
  assert.match(e, /id が重なっている/);
  assert.match(e, /text は 1〜1000 字/);
  assert.match(e, /takes は 1〜3/);
});

test('Gemini：鍵とファイル名', () => {
  const r = parseGemini('_test', 'g1', doc);
  assert.equal(geminiKey(r, r.lines[0]), geminiKey(r, { ...r.lines[0] }));
  assert.notEqual(geminiKey(r, r.lines[0]), geminiKey(r, { ...r.lines[0], style: 'ささやき' }));
  assert.deepEqual(takeNames('hello', 3), ['hello.mp3', 'hello_2.mp3', 'hello_3.mp3']);
  assert.deepEqual(takeNames('hello', 1, 'wav'), ['hello.wav']);
});

test('Gemini：送る中身（今の形と前の形）', () => {
  const l = { text: 'やったー！', voice: 'Leda', style: '元気に' };
  const n = geminiBody(l);
  assert.equal(n.contents[0].parts[0].speech_metadata.style, '元気に');
  assert.equal(n.generationConfig.speechConfig.voiceConfig.voice, 'Leda');
  assert.deepEqual(n.generationConfig.responseModalities, ['AUDIO']);
  const o = geminiBody(l, 'old');
  assert.equal(o.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Leda');
  assert.match(o.contents[0].parts[0].text, /元気に読み上げてください：やったー！$/);
  assert.equal(geminiBody({ text: 'a', voice: 'Kore', style: '' }).contents[0].parts[0].speech_metadata, undefined);
});

const pcm = Buffer.alloc(24000 * 2); // 1秒
const wav = pcmToWav(pcm, 24000);
const okRes = (data, mimeType) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType, data: data.toString('base64') } }] } }] }) });
const ngRes = (status, body) => ({ ok: false, status, text: async () => body });

test('Gemini：返事から WAV（頭あり・頭なし）', () => {
  assert.equal(wavSeconds(audioFromResponse({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }] } }] })), 1);
  const w = audioFromResponse({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }] });
  assert.equal(w.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wavSeconds(w), 1);
  assert.throws(() => audioFromResponse({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }), /音がない（SAFETY）/);
});

test('Gemini：呼び方（鍵なし・前の形へ・少し待つ・使いきった）', async () => {
  const line = { text: 'やったー！', voice: 'Leda', style: '元気に' };
  await assert.rejects(synthGemini({ apiKey: '', model: GEMINI_MODEL_DEF, line }), /鍵.*がない/);
  // 今の形が 400 → 前の形で通る
  const seen = [];
  const f1 = async (url, o) => { seen.push(JSON.parse(o.body)); return seen.length === 1 ? ngRes(400, 'Invalid JSON payload received. Unknown name "speech_metadata"') : okRes(wav, 'audio/wav'); };
  const a = await synthGemini({ apiKey: 'k', model: GEMINI_MODEL_DEF, line, fetchImpl: f1 });
  assert.equal(wavSeconds(a), 1);
  assert.ok(seen[1].generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig);
  // 1分の回数 → 待ってもう一度
  let n = 0; const waits = [];
  const f2 = async () => (++n === 1 ? ngRes(429, 'Quota exceeded for metric: requests per minute') : okRes(wav, 'audio/wav'));
  await synthGemini({ apiKey: 'k', model: GEMINI_MODEL_DEF, line, fetchImpl: f2, wait: async (ms) => waits.push(ms) });
  assert.deepEqual(waits, [20000]);
  // 1日の回数 → 止める
  const f3 = async () => ngRes(429, 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 100 PerDay');
  await assert.rejects(synthGemini({ apiKey: 'k', model: GEMINI_MODEL_DEF, line, fetchImpl: f3, wait: async () => {} }), /使いきった/);
  const f4 = async () => ngRes(400, 'API key not valid. Please pass a valid API key.');
  await assert.rejects(synthGemini({ apiKey: 'k', model: GEMINI_MODEL_DEF, line, fetchImpl: f4 }), /鍵がちがう/);
});
