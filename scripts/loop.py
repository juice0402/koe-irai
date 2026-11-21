#!/usr/bin/env python3
# つなぎ目のないループ版を作る（Lyria の曲から・11/21 司令塔）
#   python3 scripts/loop.py <入力.mp3|.wav> <出力.mp3> [kbps]
# 曲の中で「ここから先」と「ここから先」が似ている2つの場所（ループの頭とおしり）をさがし、
# おしりを頭の手前につなぐ（拍のずれを 1/170 秒まで合わせ、0.05秒だけ重ねる）。
# 出だしの静かな所・おわりのフェードアウトは使わない。最後に JSON を1行出す（秒・似ている度合い）
import json
import subprocess
import sys

import numpy as np

SR = 44100
HOP = 1024          # 粗い目（約23ミリ秒）
NFFT = 8192          # 窓は長め（拍の位置が少しずれても似ていると分かる）
CTX = 1.5           # くらべる長さ（つなぐ所の前後それぞれ・秒）
XF = int(0.05 * SR) # 重ねる長さ


def decode(path):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'],
                       capture_output=True, check=True)
    return np.frombuffer(r.stdout, dtype=np.float32).reshape(-1, 2).copy()


def encode(x, path, kbps):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-i', '-',
                    '-c:a', 'libmp3lame', '-b:a', f'{kbps}k', path],
                   input=np.clip(x, -1, 1).astype(np.float32).tobytes(), check=True)


def stft_mag(mono, hop, nfft):
    n = 1 + (len(mono) - nfft) // hop
    if n < 1:
        return np.zeros((0, nfft // 2 + 1), np.float32)
    win = np.hanning(nfft).astype(np.float32)
    out = np.empty((n, nfft // 2 + 1), np.float32)
    for i in range(0, n, 256):  # 少しずつ（大きな曲でもメモリを食わない）
        j = min(n, i + 256)
        idx = (np.arange(i, j) * hop)[:, None] + np.arange(nfft)[None, :]
        out[i:j] = np.abs(np.fft.rfft(mono[idx] * win, axis=1))
    return out


def features(mono):
    mag = stft_mag(mono, HOP, NFFT)
    freqs = np.fft.rfftfreq(NFFT, 1 / SR)
    edges = np.geomspace(50, 12000, 49)
    bands = np.stack([mag[:, (freqs >= a) & (freqs < b)].sum(1) for a, b in zip(edges[:-1], edges[1:])], 1)
    rms = np.sqrt((mag ** 2).mean(1)) + 1e-9
    f = np.log1p(bands * 100)
    f = np.concatenate([f, 2 * np.log(rms)[:, None]], 1)
    f = (f - f.mean(0)) / (f.std(0) + 1e-6)
    f /= np.linalg.norm(f, axis=1, keepdims=True) + 1e-9
    return f, rms


def onset_env(mono, a, b, hop=256, nfft=1024):
    seg = mono[max(0, a):b]
    mag = stft_mag(seg, hop, nfft)
    if len(mag) < 2:
        return np.zeros(1)
    d = np.maximum(0, np.diff(np.log1p(mag * 100), axis=0)).sum(1)
    return d - d.mean()


def find_loop(x):
    mono = x.mean(1)
    f, rms = features(mono)
    n = len(f)
    if n < 40:
        raise SystemExit('曲が短すぎる')
    sm = np.convolve(rms, np.ones(22) / 22, mode='same')  # 1秒ならし
    peak = np.percentile(sm, 95)
    loud = np.where(sm >= peak * 10 ** (-30 / 20))[0]
    musical = np.where(sm >= peak * 10 ** (-12 / 20))[0]
    a0 = int(loud[0]) if len(loud) else 0
    end = int(musical[-1]) if len(musical) else n - 1  # フェードアウトの手前まで
    w = int(CTX * SR / HOP)
    first = max(a0 + w, int(XF / HOP) + w + 1)
    usable = end - first
    lmax = usable - w
    lmin = max(int(8 * SR / HOP), int(0.45 * (end - a0)))
    if lmin > lmax:
        lmin = max(w, lmax // 2)
    ssm = f @ f.T
    best = (-9.0, first, first + lmax)
    for lag in range(lmin, lmax + 1):
        d = np.diagonal(ssm, offset=lag)
        c = np.concatenate([[0], np.cumsum(d)])
        s = np.arange(first, end - lag - w + 1)
        if len(s) == 0:
            continue
        score = (c[s + w] - c[s - w]) / (2 * w) + 0.03 * lag / max(1, lmax)
        i = int(np.argmax(score))
        if score[i] > best[0]:
            best = (float(score[i]), int(s[i]), int(s[i] + lag))
    score, sf, ef = best
    s0 = sf * HOP + NFFT // 2
    e0 = ef * HOP + NFFT // 2
    # 拍のずれを合わせる（音の立ち上がりの形を前後3秒でくらべる・32 サンプル＝約0.7ミリ秒の目）
    h = 32
    span = min(3 * SR, s0 - HOP, len(x) - e0 - 2 * HOP)
    es = onset_env(mono, s0 - span, s0 + span, hop=h, nfft=512)
    ee = onset_env(mono, e0 - HOP - span, e0 + HOP + span, hop=h, nfft=512)
    best_d, best_c = 0, -1e18
    for k in range(0, 2 * HOP // h + 1):
        seg = ee[k:k + len(es)]
        if len(seg) != len(es):
            break
        cc = float(np.dot(es, seg))
        if cc > best_c:
            best_c, best_d = cc, k * h - HOP
    e1 = e0 + best_d
    # 波の形を合わせる（つなぐ直前の 2048 サンプルで ±48）
    ref = mono[s0 - 2048:s0]
    best_d, best_c = 0, -1e18
    for d in range(-48, 49):
        seg = mono[e1 + d - 2048:e1 + d]
        if len(seg) != len(ref):
            continue
        cc = float(np.dot(ref, seg))
        if cc > best_c:
            best_c, best_d = cc, d
    e2 = min(len(x), e1 + best_d)
    return s0, e2, score


def make_loop(x, s0, e2):
    out = x[s0:e2].copy()
    t = np.linspace(0, 1, XF, dtype=np.float32)[:, None]
    fin = 0.5 - 0.5 * np.cos(np.pi * t)
    out[-XF:] = x[e2 - XF:e2] * (1 - fin) + x[s0 - XF:s0] * fin
    return out


def seam_jump(loop):
    # つなぎ目（おしり → 頭）の音の段差を、ふつうの1サンプルの動きとくらべる（1 に近いほどなめらか）
    d = np.abs(np.diff(loop.mean(1)))
    jump = abs(float(loop[0].mean() - loop[-1].mean()))
    return round(jump / (float(np.percentile(d, 99)) + 1e-9), 3)


def main():
    if len(sys.argv) < 3:
        raise SystemExit('python3 scripts/loop.py <入力> <出力.mp3> [kbps]')
    kbps = int(sys.argv[3]) if len(sys.argv) > 3 else 96
    x = decode(sys.argv[1])
    s0, e2, score = find_loop(x)
    loop = make_loop(x, s0, e2)
    encode(loop, sys.argv[2], kbps)
    print(json.dumps({'start': round(s0 / SR, 3), 'end': round(e2 / SR, 3), 'seconds': round((e2 - s0) / SR, 3),
                      'samples': int(e2 - s0), 'score': round(score, 3), 'seam': seam_jump(loop),
                      'song_seconds': round(len(x) / SR, 3)}))


if __name__ == '__main__':
    main()
