# koe-irai（声の依頼箱・公開）

全ゲームで使う「声」の共通のしくみ（2026-11-17 司令塔が作った）。ゲームのチャットが依頼書を出すと、GitHub の Actions が VOICEVOX（無料の読み上げ）で掛け声などの短い声を作る。セリフの文は声にしない（テキストだけ）。

## 頼み方（ゲームのチャット）
1. add_repo（juice0402/koe-irai・push）→ clone → ブランチ `koe/<記号>-<名前>`
2. `requests/<記号>/<名前>.yml` を書く（形は下・ためしは `requests/_test/`）→ push → gh api で PR（base main）
3. Actions「依頼の自動マージ」が点検して main に入れ、「声を作る」を動かす（数分）。止まったら PR にコメントが付く → 直して同じブランチに push
4. できたら `out/<記号>/<名前>/<id>.mp3` を自分のゲームの assets にコピー。`out/<記号>/CREDITS.md` の「音声合成：…」の1行を、ゲームのクレジット画面にそのまま書く。音の一覧（出どころ）にも「koe-irai・VOICEVOX:<声>」と書く
5. 声を直すときは依頼書を直して同じ手順（同じ id は上書き・消した id の音は消える）。out/ は手で直さない

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
lines:
  - id: hah            # 小文字の英数字と - _（ファイル名になる）
    text: ハッ！        # 60字まで
  - id: ei
    text: えいっ！
    voice: 春日部つむぎ  # 行ごとに声を変えてもよい
    style: ノーマル
```

## 声（voices.yml）
- 声はキャラごとに約束（利用規約）がちがう。ゲームに使えるのは、司令塔が約束を確かめて `ok: true` にした声だけ
- 声の一覧と約束の文は Actions「声の一覧と約束を取る」で `policies/` に取る。新しい声を使いたいときは司令塔に頼む
- ゲームやアプリに入れる音は claude/game-art-rule.md の「音」のとおり（出どころを一覧に書く）

## しくみ（司令塔）
- scripts/lib.mjs（点検・鍵・クレジット）・check.mjs（PR の点検）・make.mjs（声を作る）・policies.mjs（約束を取る）。テストは `node --test`
- Actions：irai.yml（PR → 点検 → requests/ だけなら squash でマージ → make.yml を動かす）・make.yml（VOICEVOX のエンジンを横で動かして out/ を作り main に push）・policies.yml（手で）
- エンジンは Docker の voicevox/voicevox_engine:cpu-latest。同じ声・文・数字・エンジンの版なら作りなおさない（make.yml を all=true で動かすと全部作りなおす）
- 公開リポジトリなので Actions は無料。鍵は GITHUB_TOKEN だけ
