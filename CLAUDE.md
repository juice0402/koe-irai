# koe-irai（声の依頼箱・公開）

全ゲームで使う「声」の共通のしくみ（2026-11-17 司令塔が作った）。ゲームのチャットが依頼書を出すと、GitHub の Actions が声を作る。掛け声などの短い声は VOICEVOX（無料の読み上げ）、自然な抑揚のセリフ・語りは Gemini（下の「Gemini の声」・11/20〜）。

## 頼み方（ゲームのチャット）
1. add_repo（juice0402/koe-irai・push）→ clone → ブランチ `koe/<記号>-<名前>`
2. `requests/<記号>/<名前>.yml` を書く（形は下・ためしは `requests/_test/`）→ push → gh api で PR（base main）
3. Actions「依頼の自動マージ」が点検して main に入れ、「声を作る」を動かす（数分）。止まったら PR にコメントが付く → 直して同じブランチに push
4. できたら `out/<記号>/<名前>/<id>.mp3` を自分のゲームの assets にコピー。`out/<記号>/CREDITS.md` の「音声合成：…」の1行を、ゲームのクレジット画面にそのまま書く。音の一覧（出どころ）にも「koe-irai・VOICEVOX:<声>」と書く
5. 声を直すときは依頼書を直して同じ手順（同じ id は上書き・消した id の音は消える）。out/ は手で直さない
6. 作れない行（ない声の種類・エンジンが読めない所）があっても、その行だけ飛ばしてほかは作る（前の音があれば残す）。飛ばした行は Actions「声を作る」の最後が赤になり、まとめに出る → 直して出しなおす

## 依頼書の形
```yaml
voice: 青山龍星        # 声の名前（voices.yml で ok: true の声だけ。_test はどれでも）
style: 熱血            # 声の種類（なければ「声を作る」が、ある種類の一覧を出して止まる）
defaults:              # なくてよい。行ごとにも書ける
  speed: 1.1           # 0.5〜2.0（はやさ）
  pitch: 0.0           # -0.15〜0.15（高さ）
  intonation: 1.4      # 0〜2（抑揚）
  volume: 1.0          # 0〜2
  pre: 0.05            # 0〜1.5（前の無音・秒）
  post: 0.1            # 0〜1.5（うしろの無音・秒）
  gobi: auto           # 語尾：auto＝おまかせ（書かなければこれ。ー・っで終わる→agaru、？→sagaru、ほか→taira）
                       #   sagaru＝VOICEVOX のまま（言い切りで下がる）・taira＝下げない・agaru＝少し上げる。合わない行だけ行ごとに書く
lines:
  - id: hah            # 小文字の英数字と - _（ファイル名になる）
    text: ハッ！        # 60字まで
  - id: ei
    text: えいっ！
    voice: 春日部つむぎ  # 行ごとに声を変えてもよい
    style: ノーマル
  - id: uun
    text: うーん         # のばす音は ー を1つだけ（重ねると短くまとめて読まれ、息の音になる。「……」も息の音になりやすい）
    nobasu: 1.0        # ー の音を何秒にするか（0.05〜3・行ごとだけ）。のびる長さは nobasu ÷ speed。息の音になっていたら声にもどす
                       #   んー は ん（ハミング）を1つにまとめてのばす。っ のあとや文の頭の ー はのばせない（点検で止まる）
                       #   春日部つむぎ・冥鳴ひまりは「う」が弱く息っぽい → うーん より んー（11/19 測った）
```

## Gemini の声（engine: gemini・11/20〜）
- Google の Gemini API の読み上げ（TTS）。指示どおりの感情・自然な抑揚で読む。鍵は GitHub の Secrets の `GEMINI_API_KEY`（チャット・依頼書・コードに書かない）
- 無料枠：送った文は Google が製品の改善に使い、人が読むこともある（公開してよい文だけ送る）。1日の回数に上限があり、使いきると「あしたまた作る」で止まる → 次の日に「声を作る」を手で動かす
- クレジットの義務なし。音の一覧（出どころ）には「koe-irai・Gemini TTS:<声>」と書く
- 同じ文でも毎回すこしちがう声になる → takes で何本か作って選ぶ。依頼書のその行を変えると作りなおされるので、選んだ音は先に自分の assets にコピーしておく
```yaml
engine: gemini
model: gemini-3.8-flash-tts    # なくてよい（軽いのは gemini-3.8-flash-lite-tts）
voice: Leda                    # 30の声（scripts/gemini.mjs の GEMINI_VOICES に日本語の説明つき）
                               #   女の子向き：Leda（若い）・Aoede（さわやか）・Zephyr（明るい）・Achernar（やわらか）・Kore（しっかり）
style: 元気な女の子、明るく弾むように   # 読み方の指示（日本語でよい・300字まで・行ごとにも書ける）
takes: 3                       # 1〜3（なければ1）。<id>.mp3・<id>_2.mp3・<id>_3.mp3
wav: true                      # なくてよい（.wav もほしいとき）
lines:
  - id: hello
    text: こんにちは！今日もがんばろうね！  # 1000字まで。読みまちがえる字はかなで書く。<laugh>・<sigh>・<short pause> も入れられる
  - {id: nare, text: むかしむかし、ある森に。, voice: Kore, style: 落ち着いた語り, takes: 1}
```

## 声（voices.yml）
- 声はキャラごとに約束（利用規約）がちがう。ゲームに使えるのは、司令塔が約束を確かめて `ok: true` にした声だけ
- 声の一覧と約束の文は Actions「声の一覧と約束を取る」で `policies/` に取る。新しい声を使いたいときは司令塔に頼む
- ゲームやアプリに入れる音は claude/game-art-rule.md の「音」のとおり（出どころを一覧に書く）

## しくみ（司令塔）
- scripts/lib.mjs（点検・鍵・クレジット）・gemini.mjs（Gemini の点検と呼び出し）・check.mjs（PR の点検）・make.mjs（声を作る）・policies.mjs（約束を取る）。テストは `node --test`
- Actions：irai.yml（PR → 点検 → requests/ だけなら squash でマージ → make.yml を動かす）・make.yml（VOICEVOX のエンジンを横で動かして out/ を作り main に push）・policies.yml（手で）
- エンジンは Docker の voicevox/voicevox_engine:cpu-latest。同じ声・文・数字・エンジンの版なら作りなおさない（make.yml を all=true で動かすと全部作りなおす）
- 公開リポジトリなので Actions は無料。鍵は GITHUB_TOKEN と Secrets の GEMINI_API_KEY（make.yml だけが使う。ほかのリポジトリからの PR は自動マージしない）
