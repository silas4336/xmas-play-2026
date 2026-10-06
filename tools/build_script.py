#!/usr/bin/env python3
"""把劇本文字檔轉成 data/script.json。

用法：
  soffice --headless --convert-to 'txt:Text (encoded):UTF8' 劇本.doc   # 先把 .doc 轉成 txt
  python3 tools/build_script.py 劇本.txt                              # 預設 tools/script_source.txt
"""
import json, re, sys, hashlib, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'tools' / 'script_source.txt'
lines = src.read_text(encoding='utf-8-sig').split('\n')

# 角色：id、顯示名、別名、分類
ROLES = [
    ('kefan', '可凡', ['可凡', '林凡', '林可凡'], 'main'),
    ('ruoxin', '若心', ['若心'], 'main'),
    ('aiwei', '艾薇', ['艾薇'], 'main'),
    ('baiqian', '白茜', ['白茜'], 'main'),
    ('tianyue', '天岳', ['天岳'], 'main'),
    ('mengzhen', '夢真', ['夢真'], 'main'),
    ('panpan', '盼盼', ['盼盼'], 'dance'),
    ('miaomiao', '妙妙', ['妙妙'], 'dance'),
    ('beibei', '蓓蓓', ['蓓蓓'], 'dance'),
    ('anni', '安妮', ['安妮', '錢安妮'], 'main'),
    ('daphne', 'Daphne', ['Daphne'], 'main'),
    ('songtao', '宋濤', ['宋濤'], 'main'),
    ('xiaobang', '蕭邦', ['蕭邦'], 'main'),
    ('qi', '齊牧師', ['齊牧師', '齊牧'], 'main'),
    ('shimu', '師母', ['師母'], 'main'),
    ('qin', '秦牧師', ['秦牧師', '秦牧'], 'main'),
    ('guanlun', '冠綸', ['冠綸', '鍾冠綸', '周冠綸'], 'main'),
    ('zhongkai', '仲凱', ['仲凱'], 'minor'),
    ('son', '兒子', ['兒子'], 'minor'),
    ('daughterinlaw', '媳婦', ['媳婦'], 'minor'),
    ('reporter', '記者', ['記者'], 'minor'),
    ('passerby', '路人甲', ['路人甲'], 'minor'),
    ('kids', '孩子們', ['高中的孩子', '大學的孩子', '研究所的孩子', '工作的孩子', '有女朋友的孩子'], 'minor'),
    ('video', '影片', ['影片'], 'minor'),
]
DESC = {  # 角色簡介（取自劇本人物表）
    'kefan': '六十歲，與若心、艾薇為同學閨密。直爽、幹練，保險業主管，半退休。',
    'ruoxin': '六十歲，與可凡、艾薇為同學閨密。優雅、柔和、內斂，家庭主婦。',
    'aiwei': '六十歲，與可凡、若心為同學閨密。醫生，冷靜、理性。',
    'baiqian': '四十歲，美麗、時尚、高雅，機要秘書。',
    'tianyue': '四十八歲，氣宇軒昂，科技公司總裁。',
    'mengzhen': '二十歲，機靈古怪，小網紅。',
    'panpan': '十五歲，少女舞團成員（柯盼盼＋小舞團）。',
    'miaomiao': '少女舞團成員。',
    'beibei': '少女舞團成員。',
    'anni': '五十歲，時尚、精明、犀利。',
    'daphne': '神秘的年輕女孩，戴口罩，孤傲、沉默。',
    'songtao': '五十歲，公司瀕於破產的老闆。',
    'xiaobang': '三十五歲，討債公司的老大。',
    'qi': '七十五歲，智慧慈祥的老牧師（與師母同為一組角色）。',
    'shimu': '齊牧師的師母。',
    'qin': '牧師。',
    'guanlun': '三十六歲，皇后號公司的法律顧問。',
    'zhongkai': '艾薇的先生（以訊息形式出現）。',
}
alias = {}
for rid, name, al, _ in ROLES:
    for a in al:
        alias[a] = rid
alias.update({'可凡三人': ['kefan', 'ruoxin', 'aiwei']})
names = sorted(alias, key=len, reverse=True)
NAME_RE = '|'.join(re.escape(n) for n in names)
# 發話者：一或多個名字（以，、分隔），可帶（動作）再接冒號
SPEAK = re.compile(rf'^((?:{NAME_RE})(?:[，,、](?:{NAME_RE}))*)\s*(?:[（(]([^）)]*)[）)])?\s*[：:]\s*(.*)$')

def ids(label):
    out = []
    for part in re.split(r'[，,、]', label):
        v = alias[part.strip()]
        out += v if isinstance(v, list) else [v]
    return out

def fnv(s):
    h = 2166136261
    for c in s.encode():
        h = ((h ^ c) * 16777619) & 0xFFFFFFFF
    return format(h, '08x')[:6]

OPEN, CLOSE = '［[', '］]'
def depth_delta(s):
    return sum(s.count(c) for c in OPEN) - sum(s.count(c) for c in CLOSE)

start = next(i for i, l in enumerate(lines) if l.startswith('主後2026年聖誕劇'))
acts, act, scene = [], None, None
depth, seen = 0, {}
CN = '一二三'

def new_scene(desc=''):
    global scene
    scene = {'id': f'a{act["n"]}s{len(act["scenes"])+1}', 'desc': desc, 'items': []}
    act['scenes'].append(scene)

def push(item):
    if scene is None:
        new_scene()
    scene['items'].append(item)

def add_line(who_label, who, dirn, text, spot):
    base = f'a{act["n"]}-{fnv(who_label + text)}'
    seen[base] = seen.get(base, 0) + 1
    lid = base if seen[base] == 1 else f'{base}-{seen[base]}'
    it = {'t': 'line', 'id': lid, 'who': who, 'label': who_label, 'text': text}
    if dirn: it['dir'] = dirn
    if spot: it['spot'] = True
    push(it)

for raw in lines[start:]:
    l = raw.strip().replace('　', ' ').strip()
    if not l:
        continue
    if l.startswith('主後2026年聖誕劇'):
        continue
    m = re.match(r'^第([一二三])幕$', l)
    if m:
        act = {'n': CN.index(m.group(1)) + 1, 'title': f'第{m.group(1)}幕', 'characters': [], 'scenes': []}
        acts.append(act); scene = None; depth = 0
        continue
    if re.match(r'^人[物數][一二三四五六七八九十]+[：:]', l):
        act['characters'].append(re.sub(r'^人[物數][一二三四五六七八九十]+[：:]\s*', '', l).strip())
        continue
    if l.startswith('場景'):
        desc = re.sub(r'^場景\s*[：:]?\s*', '', l).strip('［］[] ')
        new_scene(desc); depth = 0
        continue
    # 括號舞台指示區塊（可能跨行，中間夾著對話）
    if depth > 0 or l[0] in OPEN or re.match(r'^影片[：:][［\[]', l):
        spot = depth > 0
        d0 = depth
        if l[0] in OPEN and depth == 0:
            depth += depth_delta(l)
            txt = l.strip('［］[] ')
            if scene is not None and not scene['items'] and not scene['desc'] and depth == 0:
                scene['desc'] = txt   # 「場景：」下一行的描述
            else:
                push({'t': 'stage', 'text': txt})
            continue
        if l.startswith('影片'):
            depth += depth_delta(l)
            push({'t': 'line', 'id': f'a{act["n"]}-{fnv(l)}', 'who': ['video'], 'label': '影片',
                  'text': l.split('：', 1)[1].strip('［］[] '), 'spot': False})
            continue
        depth += depth_delta(l)
        body = l.rstrip('］]') if depth <= 0 else l
        mm = SPEAK.match(body)
        if mm:
            add_line(mm.group(1), ids(mm.group(1)), mm.group(2), mm.group(3).strip(), True)
        elif scene and scene['items']:
            last = scene['items'][-1]
            last['text'] = (last['text'] + '\n' + body.strip()).strip()
        depth = max(depth, 0)
        continue
    mm = SPEAK.match(l)
    if mm:
        label, dirn, text = mm.group(1), mm.group(2), mm.group(3).strip()
        # 台詞開頭的 （動作）或［動作］ 當作動作提示
        m2 = re.match(r'^[（(［\[]([^）)］\]]*)[）)］\]]\s*(.*)$', text)
        if m2 and not dirn:
            dirn, text = m2.group(1), m2.group(2)
        add_line(label, ids(label), dirn, text, False)
        continue
    if re.match(r'^[（(].*[）)]$', l):
        push({'t': 'stage', 'text': l.strip('（）()')})
        continue
    mm = re.match(r'^Daphne（([^）]*)）[：:]?\s*(.*)$', l)
    if scene and scene['items'] and scene['items'][-1]['t'] == 'line':
        scene['items'][-1]['text'] += '\n' + l   # 沒有角色名的續行
    else:
        push({'t': 'stage', 'text': l})

# 命名場景、統計
roles_out = []
cnt = {r[0]: {1: 0, 2: 0, 3: 0} for r in ROLES}
for a in acts:
    for i, s in enumerate(a['scenes'], 1):
        s['no'] = i
        for it in s['items']:
            if it['t'] == 'line':
                for w in it['who']:
                    cnt[w][a['n']] += 1
for rid, name, al, grp in ROLES:
    roles_out.append({'id': rid, 'name': name, 'group': grp, 'desc': DESC.get(rid, ''), 'lines': cnt[rid]})
out = {'acts': acts, 'roles': roles_out}
(ROOT / 'data').mkdir(exist_ok=True)
(ROOT / 'data' / 'script.json').write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
total = sum(1 for a in acts for s in a['scenes'] for i in s['items'] if i['t'] == 'line')
print(f'acts={len(acts)} scenes={sum(len(a["scenes"]) for a in acts)} lines={total}')
for r in roles_out: print(r['name'], r['lines'])
