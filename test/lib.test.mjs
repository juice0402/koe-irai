import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadVoices, parseRequest, validateRequest, findStyleId, lineKey, applyParams, wavSeconds, buildCredits, PARAMS, shapeGobi } from '../scripts/lib.mjs';

const voices = loadVoices(`
voices:
  - name: 青山龍星
    ok: true
    terms: https://example.com/aoyama
    checked: 2026-11-17
  - name: 春日部つむぎ
    ok: false
`);

const req = (game, body) => parseRequest(game, 'set1', body);

test('声の一覧：credit がなければ VOICEVOX:名前', () => {
  assert.equal(voices[0].credit, 'VOICEVOX:青山龍星');
  assert.equal(voices[1].ok, false);
});

test('依頼書：行の値 → defaults → 決まりの値', () => {
  const r = req('card', `voice: 青山龍星\nstyle: 熱血\ndefaults: {speed: 1.2}\nlines:\n  - {id: a, text: ハッ！}\n  - {id: b, text: ヤア！, speed: 0.9, style: ノーマル}\n`);
  assert.equal(r.lines[0].speed, 1.2);
  assert.equal(r.lines[0].style, '熱血');
  assert.equal(r.lines[0].pitch, PARAMS.pitch.def);
  assert.equal(r.lines[1].speed, 0.9);
  assert.equal(r.lines[1].style, 'ノーマル');
});

test('点検：OK の声・正しい形なら通る', () => {
  const r = req('card', `voice: 青山龍星\nstyle: 熱血\nlines:\n  - {id: hah, text: ハッ！}\n`);
  assert.deepEqual(validateRequest(r, voices), []);
});

test('点検：約束を確かめていない声はゲームでは止まる・_test では通る', () => {
  const body = `voice: 春日部つむぎ\nstyle: ノーマル\nlines:\n  - {id: ei, text: えいっ！}\n`;
  assert.match(validateRequest(req('card', body), voices).join(), /約束を確かめていない/);
  assert.deepEqual(validateRequest(req('_test', body), voices), []);
});

test('点検：ない声・id の形・重なり・字数・数字の幅', () => {
  const r = req('card', `voice: 青山龍星\nstyle: 熱血\nlines:\n  - {id: A, text: ハッ}\n  - {id: x, text: ''}\n  - {id: x, text: あ, speed: 3}\n  - {id: y, text: あ, voice: だれか}\n`);
  const e = validateRequest(r, voices).join('\n');
  assert.match(e, /id は小文字/);
  assert.match(e, /text は 1〜60 字/);
  assert.match(e, /id が重なっている/);
  assert.match(e, /speed は 0.5〜2/);
  assert.match(e, /voices.yml にない/);
});

test('点検：ゲームの記号の形', () => {
  const r = parseRequest('Card Game', 'set1', `voice: 青山龍星\nstyle: 熱血\nlines:\n  - {id: a, text: ハッ}\n`);
  assert.match(validateRequest(r, voices).join(), /ゲームの記号/);
});

test('話者の番号をさがす', () => {
  const sp = [{ name: '青山龍星', styles: [{ name: 'ノーマル', id: 13 }, { name: '熱血', id: 81 }] }];
  assert.equal(findStyleId(sp, '青山龍星', '熱血'), 81);
  assert.equal(findStyleId(sp, '青山龍星', 'ない'), null);
  assert.equal(findStyleId(sp, 'だれか', 'ノーマル'), null);
});

test('鍵：同じなら同じ・数字が変われば変わる', () => {
  const l = req('card', `voice: 青山龍星\nstyle: 熱血\nlines:\n  - {id: a, text: ハッ}\n`).lines[0];
  const k1 = lineKey('0.24.1', 81, l);
  assert.equal(k1, lineKey('0.24.1', 81, { ...l }));
  assert.notEqual(k1, lineKey('0.24.1', 81, { ...l, speed: 1.3 }));
  assert.notEqual(k1, lineKey('0.25.0', 81, l));
});

test('audio_query に数字を入れる', () => {
  const l = req('card', `voice: 青山龍星\nstyle: 熱血\nlines:\n  - {id: a, text: ハッ, speed: 1.3, pitch: -0.05}\n`).lines[0];
  const q = applyParams({ speedScale: 1, accent_phrases: [] }, l);
  assert.equal(q.speedScale, 1.3);
  assert.equal(q.pitchScale, -0.05);
  assert.equal(q.outputStereo, false);
  assert.deepEqual(q.accent_phrases, []);
});

test('WAV の長さ', () => {
  const rate = 24000, data = rate * 2; // 1秒（16bit・モノラル）
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data, 40);
  assert.equal(wavSeconds(b), 1);
  assert.equal(wavSeconds(Buffer.from('nope')), 0);
});

test('クレジット：使った声だけ・1行', () => {
  const c = buildCredits('card', ['青山龍星', '青山龍星'], voices);
  assert.equal(c.line, '音声合成：VOICEVOX:青山龍星');
  assert.match(c.md, /https:\/\/example.com\/aoyama/);
  assert.equal(c.json.voices.length, 1);
});

test('語尾：書かなければ sagaru・まちがった値は止まる・sagaru の鍵は前のまま', () => {
  const r = req('card', `voice: 青山龍星\nstyle: 熱血\ndefaults: {gobi: taira}\nlines:\n  - {id: a, text: ハッ}\n  - {id: b, text: ヤア, gobi: agaru}\n  - {id: c, text: ヤア, gobi: up}\n`);
  assert.equal(r.lines[0].gobi, 'taira');
  assert.equal(r.lines[1].gobi, 'agaru');
  assert.match(validateRequest(r, voices).join(), /gobi は sagaru・taira・agaru/);
  const l = req('card', `voice: 青山龍星\nstyle: 熱血\nlines:\n  - {id: a, text: ハッ}\n`).lines[0];
  assert.equal(l.gobi, 'sagaru');
  const { gobi, ...noGobi } = l;
  assert.equal(lineKey('0.24.1', 81, l), lineKey('0.24.1', 81, noGobi));
  assert.notEqual(lineKey('0.24.1', 81, l), lineKey('0.24.1', 81, { ...l, gobi: 'taira' }));
});

test('語尾：taira は下げすぎない・agaru は最後を上げる・無声の音と前の句はそのまま', () => {
  const m = (pitch) => ({ text: 'ア', vowel: pitch ? 'a' : 'cl', pitch });
  const phrases = [{ moras: [m(5.5), m(5.2)] }, { moras: [m(5.6), m(5.9), m(5.4), m(5.1), m(0)] }];
  assert.equal(shapeGobi(phrases, 'sagaru'), phrases);
  const t = shapeGobi(phrases, 'taira');
  assert.deepEqual(t[1].moras.map((x) => x.pitch), [5.6, 5.9, 5.82, 5.82, 0]);
  assert.deepEqual(t[0].moras.map((x) => x.pitch), [5.5, 5.2]);
  const a = shapeGobi(phrases, 'agaru');
  assert.deepEqual(a[1].moras.map((x) => +x.pitch.toFixed(2)), [5.6, 5.9, 5.82, 6.05, 0]);
  assert.equal(phrases[1].moras[3].pitch, 5.1); // 元は変えない
  const one = [{ moras: [m(5.5), m(0)] }];
  assert.deepEqual(shapeGobi(one, 'agaru')[0].moras.map((x) => x.pitch), [5.5, 0]); // 音が1つだけなら変えない
  const q = applyParams({ accent_phrases: phrases }, { ...req('card', `voice: 青山龍星\nstyle: 熱血\nlines:\n  - {id: a, text: ハッ, gobi: taira}\n`).lines[0] });
  assert.equal(q.accent_phrases[1].moras[3].pitch, 5.82);
});
