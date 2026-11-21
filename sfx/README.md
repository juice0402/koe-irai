# sfx（効果音の集・2026-11-21〜）

全ゲームで使える効果音を、ゲームに入れてよいライセンスの集から取りこんだ置き場。作るのではなく、えらんで使う（11/21 しょーくん「SEだけ対比してしょぼくなっちゃった」→ Lyria の BGM とつり合う音をさがすため）。

## 集
| フォルダ | 集 | 数 | ライセンス | クレジット |
| --- | --- | --: | --- | --- |
| sfx/wyzowl/<分類>/ | Wyzowl SFX Kit | 320 | CC0 | いらない |
| sfx/kenney/interface/ | Kenney Interface Sounds | 100 | CC0 | いらない |
| sfx/kenney/ui・rpg・digital・casino・jingles/ | Kenney UI Audio・RPG Audio・Digital Audio・Casino Audio・Music Jingles | 291 | CC0 | いらない |
| sfx/oculus/<分類>/ | Oculus Audio Pack 01（ループ以外） | 470 | CC BY 4.0 | **いる**（下の1行） |

- Wyzowl：動画やアプリ向けの音（キラキラ・ポップ・お金・ドアの鈴・通知・短いジングル〔logo-stings〕など）。配布元の README に「コードで音を作った・Claude を使って作り、Wyzowl が1つずつ聞いて出した」とある。配布元 https://huggingface.co/datasets/wyzowl/sfx-kit ・写し github.com/wyzowl/sfx-kit（92780e7）
- Kenney Interface Sounds：とても短いカチッという音が多い。配布元 https://kenney.nl/assets/interface-sounds ・写し github.com/Calinou/kenney-interface-sounds（4596a49）
- Kenney のほかの集：コイン・本・ドア・カード・ピコピコ・短いジングルなど。カジノの集のさいころの音は入れていない（運のしくみに見えないように）。配布元 https://kenney.nl/assets （作業の箱から届かないので、写し github.com/ismetcabbar9-oss/kenney-audio-assets〔b772928〕から取った。中身は Kenney の集のまま・CC0）
- Oculus：本物の楽器のジングル（musical/ の MUSCStngr_：Victory・LevelUp・Loss）・魔法っぽい UI の音（user-interface/）・足音・ドア・声など。長い環境音のループは入れていない。配布元 https://developers.meta.com/vr/downloads/package/oculus-audio-pack-1/ ・写し github.com/facebookincubator/Meta-open-sound（514c926）

Oculus の音を1つでも使ったゲームは、クレジット画面にこの1行をそのまま書く：
```
"Oculus Audio Pack 01" by Oculus VR, LLC (https://developers.meta.com/vr/downloads/package/oculus-audio-pack-1/), licensed under CC BY 4.0
```
ライセンスの文はそれぞれのフォルダの LICENSE-<集>.txt。

## 使い方（ゲームのチャット）
1. `sfx/catalog.json` でさがす（1行1音：id・集・秒・ch〔1＝モノラル・2＝ステレオ〕・desc〔英語の説明〕・tags）。音は `sfx/<id>.mp3`。Kenney は説明がないので名前で
2. いくつか候補をえらんで、いまの音とならべて聞くページを作り、しょーくんに聞いてもらう（見本：まぜまぜ https://claude.ai/artifact/Eeetm8pMx7XFv4vKPLsyQ4 ・BGM を流しながら・残響の切りかえつき）
3. 入れ方は2つ
   - そのまま：`sfx/<id>.mp3` を自分の assets にコピーして、大きさはゲームのコードで合わせる
   - そろえて：`sfx/picks/<記号>.json` に書いて `python3 scripts/sfx_pick.py <記号>` → `sfx/picks/<記号>/<name>.mp3`（前の音と同じ大きさ・高さを変えた形）。この PR は requests/ の外なので司令塔がマージする
4. 音の一覧（出どころ）に「koe-irai・sfx:<id>（集・ライセンス）」と書く。Oculus を使ったらクレジットに上の1行
5. Canva の音は使わない（claude/game-art-rule.md の「音」）

## 使っているゲーム
- okashi（まぜまぜおかし屋）：`sfx/picks/okashi.json`（効果音24・ジングル4・2026-11-21 しょーくんがえらんだ）。Oculus を使っている

## 集を足す（司令塔）
- `scripts/sfx_import.py` の SETS に1つ足す → `python3 scripts/sfx_import.py <集> --src <もとのフォルダ>`（--src がなければ決まった版を git clone）→ この表に1行
- 入れてよいのは、ゲームやアプリに使ってよいと書いてあるライセンスだけ（CC0・CC BY など）。「ロイヤリティーフリーでも素材のままの配布は禁止」の集は、公開のここに置けない
- `sfx/catalog.json`・`sfx/<集>/`・`sfx/picks/<記号>/` は自動で作るファイル（手で直さない・ふだんは読まない。catalog は grep で引く）
