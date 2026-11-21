# 地図（koe-irai）

## ファイルの役目
| ファイル | 役目 |
| --- | --- |
| scripts/make.mjs | 依頼書ぜんぶから out/ を作る（Actions「声を作る」）。VOICEVOX は使うときだけエンジンに聞く。`KOE_ONLY=<文字>` でその文字で始まる依頼書だけ（ためしの枝用・片づけとクレジットはしない） |
| scripts/lib.mjs | VOICEVOX の依頼書の読み取り・点検・語尾とのばす音・クレジット |
| scripts/gemini.mjs | engine: gemini（声）の点検・送る中身・呼び出し |
| scripts/lyria.mjs | engine: lyria（曲）の点検・鍵・送る中身・返事の取り出し・呼び出し（402・429・安全フィルター・作り終わりを待つ） |
| scripts/loop.py | 曲からつなぎ目のないループ版（python3 + numpy + ffmpeg）。最後に JSON を1行 |
| scripts/check.mjs | PR の点検（エンジンなし）。Lyria は新しく作る本数とお金のめやすも出す |
| scripts/policies.mjs | 声の約束のページを policies/ に取る |
| kept/ | とっておく曲（make.mjs はさわらない・README.md に出どころ） |
| sfx/README.md | 効果音の集の一覧・出どころ・クレジット・使い方 |
| scripts/sfx_import.py | 効果音の集を sfx/<集>/ に mp3 で取りこみ、sfx/catalog.json を作る（SETS に集ごとの写しの版・ライセンス） |
| scripts/sfx_pick.py | sfx/picks/<記号>.json のとおり、えらんだ音を前の音と同じ大きさ・高さにして sfx/picks/<記号>/ に出す |
| test/*.test.mjs | `node --test`（lyria.test.mjs は呼び出しをにせものの返事でためす） |
| .github/workflows/irai.yml | PR → 点検 → requests/ だけなら squash → make.yml を動かす |
| .github/workflows/make.yml | VOICEVOX を横で動かして make.mjs → out/ を main に push。作れない行があれば最後に赤 |

## make.mjs の中（行の目安）
- 1〜40：読みこみ・VOICEVOX を聞く engine()
- 47〜141：probeSeconds・toMp3Stereo・makeLoop・makeLyria（1本ずつ残す・1回12本まで）
- 142〜193：makeGemini
- 194〜264：VOICEVOX の行を作る
- 265〜：クレジット・いらなくなった out の片づけ・まとめ（Lyria のお金もここに出る）

## 自動で作るファイル（読まない・手で直さない）
- out/（mp3・wav・txt・manifest.json・CREDITS.md・credits.json）・package-lock.json・policies/
- sfx/catalog.json（grep で引く）・sfx/<集>/ の mp3 と LICENSE・sfx/picks/<記号>/ の mp3
