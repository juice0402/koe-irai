#!/usr/bin/env python3
"""効果音の集を sfx/<集>/ に mp3 で取りこみ、sfx/catalog.json を作りなおす（2026-11-21 司令塔）

  python3 scripts/sfx_import.py <集> [--src <もとのフォルダ>]   # 集：下の SETS の名前（all でぜんぶ）

- もとの音は GitHub の写しから（--src がなければ、決まった版を git clone する）。ネットの配布元のページは作業の箱から届かない
- 変えるのは形だけ（頭の無音を切る・44.1kHz・ステレオは 128kbps／モノラルは 96kbps の mp3）。大きさはもとのまま
- 集を足すときは SETS に1つ足して、sfx/README.md の表にも1行足す（ライセンスがゲームに使えるものだけ・game-art-rule.md の「音」）
- 必要：python3・numpy は不要・ffmpeg・git
"""
import argparse, glob, json, os, re, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SFX = os.path.join(ROOT, 'sfx')
CAT = os.path.join(SFX, 'catalog.json')

def wyzowl(src):
    for x in json.load(open(os.path.join(src, 'sounds.json')))['sounds']:
        yield f"{x['category']}/{x['id']}", os.path.join(src, x['file']), x['description'], x.get('tags', [])

def kenney_interface(src):
    for p in sorted(glob.glob(os.path.join(src, 'addons', '*', '*.wav'))):
        yield 'interface/' + os.path.basename(p)[:-4], p, '', []

KENNEY_PACKS = {'UI sounds (50 sounds)': 'ui', 'RPG sounds (50 sounds)': 'rpg', 'Digital sounds (60 sounds)': 'digital',
                'Casino sounds (50 sounds)': 'casino', 'Jingle sounds (85 sounds)': 'jingles'}
def kenney_bundle(src):
    base = os.path.join(src, 'Audio (295 files)')
    for d, sub in KENNEY_PACKS.items():
        for p in sorted(glob.glob(os.path.join(base, d, '**', '*.ogg'), recursive=True)):
            n = os.path.basename(p)[:-4]
            if sub == 'casino' and re.match(r'(dice|die)', n): continue   # さいころは入れない（運のしくみに見えないように）
            yield f'{sub}/{n}', p, '', []

def oculus(src):
    base = os.path.join(src, 'corpora', 'oculus-audio-pack')
    info, cats = {}, {}   # 目録は _01 だけのことがある → 分類は名前の頭（MUSCStngr など）でも引く
    for f in glob.glob(os.path.join(base, 'index', '*.json')):
        for x in json.load(open(f)).get('sounds', []):
            u = x.get('ucs') or {}
            cat = re.sub(r'[^a-z0-9]+', '-', u.get('category', 'misc').lower()).strip('-')
            info[x['id']] = (cat, x.get('summary', ''))
            if u.get('cat_id'): cats[u['cat_id']] = cat
    for p in sorted(glob.glob(os.path.join(base, 'ogg', '*.ogg'))):
        n = os.path.basename(p)[:-4]
        if '_LOOP_' in n: continue   # 長い環境音のループは入れない（必要になったら足す）
        cat, desc = info.get(n) or info.get(re.sub(r'_\d+$', '_01', n)) or (cats.get(n.split('_')[0], 'misc'), '')
        yield f'{cat}/{n}', p, re.sub(r'^Use for:\s*', '', desc), []

SETS = {
    'wyzowl': dict(dir='wyzowl', fn=wyzowl, repo='https://github.com/wyzowl/sfx-kit', commit='92780e7ab0cdfb557497a988089c47f46e8c7412',
                   license='CC0-1.0', license_file='LICENSE', credit=None, title='Wyzowl SFX Kit（320音）', page='https://huggingface.co/datasets/wyzowl/sfx-kit'),
    'kenney-interface': dict(dir='kenney', fn=kenney_interface, repo='https://github.com/Calinou/kenney-interface-sounds', commit='4596a49eaf5a533948d49a47467f606bcdea70ff',
                   license='CC0-1.0', license_file='LICENSE.txt', credit=None, title='Kenney Interface Sounds（100音）', page='https://kenney.nl/assets/interface-sounds'),
    'kenney': dict(dir='kenney', fn=kenney_bundle, repo='https://github.com/ismetcabbar9-oss/kenney-audio-assets', commit='b7729283e47d38f203d85560cfda5b2c1fd6fc7e',
                   license='CC0-1.0', license_file='LICENSE.md', credit=None, title='Kenney UI・RPG・Digital・Casino・Music Jingles',
                   page='https://kenney.nl/assets/category:Audio'),
    'oculus': dict(dir='oculus', fn=oculus, repo='https://github.com/facebookincubator/Meta-open-sound', commit='514c926efecdb3c7812bf00eedf8e5c8d61dd681',
                   license='CC-BY-4.0', license_file='corpora/oculus-audio-pack/LICENSE', title='Oculus Audio Pack 01（ループ以外）',
                   page='https://developers.meta.com/vr/downloads/package/oculus-audio-pack-1/',
                   credit='"Oculus Audio Pack 01" by Oculus VR, LLC (https://developers.meta.com/vr/downloads/package/oculus-audio-pack-1/), licensed under CC BY 4.0'),
}

def run(cmd, **kw): return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)

def fetch(s):
    d = tempfile.mkdtemp(prefix='sfx-')
    run(['git', 'clone', '-q', '--filter=blob:none', s['repo'], d])
    run(['git', '-C', d, 'checkout', '-q', s['commit']])
    return d

def probe(p):
    r = run(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels:format=duration', '-of', 'json', p])
    j = json.loads(r.stdout)
    return int(j['streams'][0]['channels']), float(j['format']['duration'])

def convert(src, out):
    ch, _ = probe(src)
    st = ch >= 2
    os.makedirs(os.path.dirname(out), exist_ok=True)
    for af in (['-af', 'silenceremove=start_periods=1:start_threshold=-60dB'], []):   # とても短い音は無音を切ると空になることがある → 切らずに作る
        run(['ffmpeg', '-v', 'error', '-y', '-i', src, *af, '-map_metadata', '-1',
             '-ar', '44100', '-ac', '2' if st else '1', '-b:a', '128k' if st else '96k', out])
        try:
            ch2, sec = probe(out)
            if sec >= 0.02: return ch2, round(sec, 2)
        except subprocess.CalledProcessError:
            pass
    raise RuntimeError(f'作れなかった：{src}')

def load_cat():
    if os.path.exists(CAT): return json.load(open(CAT))
    return {'sets': {}, 'sounds': []}

def save_cat(c):
    c['sounds'].sort(key=lambda x: x['id'])
    lines = ['{', '"note": "自動で作るファイル（scripts/sfx_import.py）・手で直さない。音は sfx/<id>.mp3",',
             '"sets": ' + json.dumps(c['sets'], ensure_ascii=False, sort_keys=True) + ',', '"sounds": [']
    lines += [json.dumps(x, ensure_ascii=False) + (',' if i < len(c['sounds']) - 1 else '') for i, x in enumerate(c['sounds'])]
    lines += [']', '}']
    open(CAT, 'w').write('\n'.join(lines) + '\n')

def do(name, src):
    s = SETS[name]
    tmp = None
    if not src: src = tmp = fetch(s)
    c = load_cat()
    c['sounds'] = [x for x in c['sounds'] if x['set'] != name]
    n = 0
    for rel, p, desc, tags in s['fn'](src):
        sid = f"{s['dir']}/{rel}"
        ch, sec = convert(p, os.path.join(SFX, sid + '.mp3'))
        e = {'id': sid, 'set': name, 'sec': sec, 'ch': ch}
        if desc: e['desc'] = desc
        if tags: e['tags'] = tags
        c['sounds'].append(e); n += 1
    lic = os.path.join(SFX, s['dir'], f'LICENSE-{name}.txt')
    shutil.copy(os.path.join(src, s['license_file']), lic)
    c['sets'][name] = {k: s[k] for k in ('title', 'license', 'credit', 'page', 'repo', 'commit')} | {'count': n, 'dir': s['dir']}
    save_cat(c)
    if tmp: shutil.rmtree(tmp, ignore_errors=True)
    print(f'{name}: {n} 音')

if __name__ == '__main__':
    a = argparse.ArgumentParser(); a.add_argument('set'); a.add_argument('--src')
    o = a.parse_args()
    names = list(SETS) if o.set == 'all' else [o.set]
    for nm in names:
        if nm not in SETS: sys.exit(f'集の名前がちがう：{nm}（{", ".join(SETS)}）')
        do(nm, None if o.set == 'all' else o.src)
