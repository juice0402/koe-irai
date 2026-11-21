# kept（とっておく曲）

お金をかけて作った曲のうち、いまは使わないけれど、あとで使うかもしれない曲を残す場所（11/21 しょーくん「BもCもめちゃくちゃいい曲だから何かに使うかもしれない。せっかくお金かけて作ったんだし、どこかに保存しておいて」）。

- 「声を作る」（make.mjs）はここをさわらない。依頼書を変えても消えない
- 使うときは自分のゲームの assets にコピーし、音の一覧（出どころ）に、下の表の「出どころ」をそのまま書く
- どの曲も AI（Google の Lyria）で作った曲。「人が演奏した」と書かない。クレジットの義務なし

## okashi/lyria-2026-11-21（まぜまぜおかし屋のためし・30秒）
出どころ：koe-irai・Lyria:lyria-3-clip-preview（2026-11-21・prompt は requests/_test/lyria-okashi-hiru.yml と lyria-okashi-yoru.yml）

| ファイル | 曲 | ループ版 |
| --- | --- | --- |
| hiru-a.mp3 | 昼のお店 A：オルゴール・ピチカート・フルート・ピアノ（ヘ長調・100BPM）→ この方向で2分の曲を作った | hiru-a_loop.mp3 |
| hiru-b.mp3 | 昼のお店 B：ウクレレ・アコースティックギター・鉄琴・手拍子（ハ長調・96BPM） | hiru-b_loop.mp3 |
| hiru-c.mp3 | 昼のお店 C：かるいジャズ・ピアノ・ビブラフォン・ブラシのドラム（変ロ長調・108BPM） | hiru-c_loop.mp3 |
| yoru-a.mp3 | 夜のバトル A：四角い音のリード・ブラス・ストリングス（イ短調・150BPM）→ ほのかの2分の曲 | yoru-a_loop.mp3 |
| yoru-b.mp3 | 夜のバトル B：かわいいオーケストラ（ニ短調・140BPM）→ わかばの2分の曲 | yoru-b_loop.mp3 |
| yoru-c.mp3 | 夜のバトル C：エレクトロポップ（ホ短調・145BPM）→ みなもの2分の曲 | yoru-c_loop.mp3 |

2分の曲（lyria-3.5・8本）は out/_test/lyria-okashi-full/ にある（requests/_test/lyria-okashi-full.yml を変えると作りなおされて消えるので、変える前にここへコピーする）。
