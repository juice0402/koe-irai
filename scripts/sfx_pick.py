#!/usr/bin/env python3
"""えらんだ効果音を、ゲームに入れる形にそろえて sfx/picks/<記号>/ に出す（2026-11-21 司令塔）

  python3 scripts/sfx_pick.py <記号>        # sfx/picks/<記号>.json を読んで sfx/picks/<記号>/<name>.mp3 を作りなおす

picks の json：{"note": "...", "sounds": [{"name": "tap", "sfx": "wyzowl/foley/foley-wood-touch", "level": -21.3, "rate": 0.85}, ...]}
- name：ゲームでの名前（ファイル名になる）。sfx：sfx/catalog.json の id（sfx/<id>.mp3）
- level：大きさのめやす（50ミリ秒ごとの RMS のいちばん大きい所・dB）。前の音と同じにすると入れかえても大きさが変わらない。なければそのまま
- rate：高さと速さ（0.5〜2・ゲームの playbackRate と同じ）。なければ 1
- 必要：python3・numpy・ffmpeg
"""
import json, os, subprocess, sys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SFX = os.path.join(ROOT, 'sfx')
SR = 44100

def run(cmd): return subprocess.run(cmd, check=True, capture_output=True)

def level(p):
    x = np.frombuffer(run(['ffmpeg', '-v', 'error', '-i', p, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-']).stdout, dtype=np.float32)
    n = int(SR * 0.05)
    k = np.convolve(x * x, np.ones(n) / n, 'valid') if len(x) > n else np.array([np.mean(x * x)])
    return 10 * np.log10(max(k.max(), 1e-12)), 20 * np.log10(max(np.abs(x).max(), 1e-9))

def channels(p):
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'csv=p=0', p], capture_output=True, text=True)
    return int(r.stdout.strip() or 1)

def main(code):
    spec = json.load(open(os.path.join(SFX, 'picks', code + '.json')))
    out = os.path.join(SFX, 'picks', code)
    os.makedirs(out, exist_ok=True)
    keep = set()
    for s in spec['sounds']:
        src = os.path.join(SFX, s['sfx'] + '.mp3')
        if not os.path.exists(src): sys.exit(f"ない音：{s['sfx']}（sfx/catalog.json の id を書く）")
        rate = float(s.get('rate', 1))
        if not 0.5 <= rate <= 2: sys.exit(f"rate は 0.5〜2：{s['name']}")
        rms, pk = level(src)
        gain = 0.0 if s.get('level') is None else min(s['level'] - rms, -1.0 - pk)   # 割れないように山は -1dB まで
        af = [f'volume={gain:.2f}dB']
        if rate != 1: af = [f'asetrate={int(SR * rate)}', f'aresample={SR}'] + af
        st = channels(src) >= 2
        dst = os.path.join(out, s['name'] + '.mp3')
        run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-af', ','.join(af), '-ar', str(SR), '-ac', '2' if st else '1', '-b:a', '128k' if st else '96k', dst])
        keep.add(s['name'] + '.mp3')
        print(f"{s['name']:12s} ← {s['sfx']}  {gain:+.1f}dB" + (f'  rate {rate}' if rate != 1 else ''))
    for f in os.listdir(out):
        if f.endswith('.mp3') and f not in keep: os.remove(os.path.join(out, f))

if __name__ == '__main__':
    if len(sys.argv) != 2: sys.exit(__doc__)
    main(sys.argv[1])
